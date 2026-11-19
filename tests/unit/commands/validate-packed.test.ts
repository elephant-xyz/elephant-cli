import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fsPromises } from 'fs';
import os from 'os';
import path from 'path';
import AdmZip from 'adm-zip';
import { CID } from 'multiformats/cid';
import { handleValidate } from '../../../src/commands/validate.js';
import { CarSummary } from '../../../src/services/car-validator.service.js';
import { CarOutputService } from '../../../src/services/car-output.service.js';
import { CidCalculatorService } from '../../../src/services/cid-calculator.service.js';
import { fetchFromIpfs } from '../../../src/utils/schema-fetcher.js';
import { json } from '../../helpers/county-car.js';
import {
  COUNTY,
  EXPECTED,
  hash,
  services,
  VECTORS,
} from '../../helpers/packed.js';

vi.mock('../../../src/utils/schema-fetcher.js', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../../../src/utils/schema-fetcher.js')
  >()),
  fetchFromIpfs: vi.fn(),
}));

const SOURCE = path.join(VECTORS, 'vector-2');
const PROPERTY =
  'baguqeera2vep6rq3g4gdjfxkn65fx6g3ztgqoszjbezh5afdikupr23oqzha';
/** A CID no entity of the vectors has. */
const ABSENT = EXPECTED.property;

type Packed = {
  entities: Record<string, Record<string, unknown>>;
  relationships: Record<string, { from: unknown; to: unknown }[]>;
};

/** Each packed-specific finding: a hand-made change to vector 2's packed root, and its message as the CSV quotes it. */
const CORRUPTIONS: [string, (packed: Packed) => Promise<unknown>, string][] = [
  [
    'entities that is not an object',
    async (packed) => ({ ...packed, entities: [] }),
    '""entities"" is not an object',
  ],
  [
    'an entity key that is not the CID of its value',
    async (packed) => {
      packed.entities[PROPERTY].number_of_units = 2;
      return packed;
    },
    `entity key ${PROPERTY} is not the CID of its value`,
  ],
  [
    'a from that is not a key of entities',
    async (packed) => {
      packed.relationships.property_has_tax[0].from = ABSENT;
      return packed;
    },
    `from ""${ABSENT}"" is not a key of ""entities""`,
  ],
  [
    'an entity no relationship references',
    async (packed) => {
      const extra = { request_identifier: 'unreferenced' };
      packed.entities[(await json(extra)).cid.toString()] = extra;
      return packed;
    },
    'is referenced by no relationship',
  ],
];

describe('validate with packed data groups', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await fsPromises.mkdtemp(
      path.join(path.resolve(os.tmpdir()), 'validate-packed-')
    );
  });

  afterEach(async () => {
    expect(fetchFromIpfs).not.toHaveBeenCalled();
    await fsPromises.rm(tmp, { recursive: true, force: true });
  });

  /** Validate `input`; resolves to whether it passed, the CAR summary and the error rows without timestamps. */
  const validate = async (input: string, strict = false) => {
    const cwd = await fsPromises.mkdtemp(path.join(tmp, 'run-'));
    const csv = path.join(cwd, 'errors.csv');
    const outcome = await handleValidate(
      { input, outputCsv: csv, silent: true, cwd },
      services(strict)
    ).then(
      (summary) => ({ passed: true, summary }),
      (error: { summary?: CarSummary }) => ({
        passed: false,
        summary: error.summary,
      })
    );
    const text = await fsPromises.readFile(csv, 'utf-8');
    return {
      ...outcome,
      rows: text
        .trim()
        .split('\n')
        .slice(1)
        .map((line) => line.replace(/,[^,]*$/, ''))
        .sort(),
    };
  };

  /** Vector 2 as a property directory whose County group is one packed root. */
  const packedDirectory = async (root?: unknown) => {
    const dir = path.join(
      await fsPromises.mkdtemp(path.join(tmp, 'packed-')),
      'property'
    );
    await fsPromises.mkdir(dir);
    for (const name of [
      'seed.json',
      'relationship_address_has_parcel.json',
      'address.json',
      'parcel.json',
    ]) {
      await fsPromises.copyFile(
        path.join(SOURCE, 'property', name),
        path.join(dir, name)
      );
    }
    await fsPromises.writeFile(
      path.join(dir, 'county.json'),
      root === undefined
        ? await fsPromises.readFile(path.join(SOURCE, 'packed.json'))
        : JSON.stringify(root)
    );
    return dir;
  };

  const linkedDirectory = async () => {
    const dir = path.join(
      await fsPromises.mkdtemp(path.join(tmp, 'linked-')),
      'property'
    );
    await fsPromises.cp(path.join(SOURCE, 'property'), dir, {
      recursive: true,
    });
    // The linked form of a packed root is the hashed root, whose link arrays
    // are sorted by CID: 2023 before 2024. The source file lists 2024 first.
    const county = path.join(dir, 'county.json');
    const root = JSON.parse(await fsPromises.readFile(county, 'utf-8'));
    root.relationships.property_has_tax.reverse();
    await fsPromises.writeFile(county, JSON.stringify(root));
    return dir;
  };

  const zip = (dir: string) => {
    const file = `${dir}.zip`;
    const archive = new AdmZip();
    archive.addLocalFolder(dir);
    archive.writeZip(file);
    return file;
  };

  /** A county CAR holding one property whose County group is `root`. */
  const packedCar = async (root: unknown, text = JSON.stringify(root)) => {
    const file = path.join(
      await fsPromises.mkdtemp(path.join(tmp, 'car-')),
      'county.car'
    );
    const cid = CID.parse(
      await new CidCalculatorService().calculateCidFromCanonicalJson(text)
    );
    const car = new CarOutputService(file);
    await car.open();
    await car.put(cid, Buffer.from(text));
    await car.property(cid, { [COUNTY]: cid });
    await car.close();
    return file;
  };

  const corrupt = async (change: (packed: Packed) => Promise<unknown>) =>
    change(
      JSON.parse(
        await fsPromises.readFile(path.join(SOURCE, 'packed.json'), 'utf-8')
      )
    );

  /** Rows with the columns that name the container (file path or block CID) blanked. */
  const portable = (rows: string[], ...names: string[]) =>
    rows
      .map((row) =>
        names.reduce((line, name) => line.replaceAll(name, ''), row)
      )
      .sort();

  it('passes a property directory and a property ZIP with a packed root', async () => {
    const dir = await packedDirectory();
    expect(await validate(dir)).toMatchObject({ passed: true, rows: [] });
    expect(await validate(zip(dir))).toMatchObject({ passed: true, rows: [] });
  });

  it('reports the same lexicon rows for a packed root as for the linked files', async () => {
    const linked = await linkedDirectory();
    const packed = await packedDirectory();
    const expected = await validate(linked, true);
    expect(expected.passed).toBe(false);
    expect(expected.rows.join('\n')).toContain(
      '/relationships/property_has_tax/0/to/tax_year'
    );
    const actual = await validate(packed, true);
    expect(actual.passed).toBe(false);
    expect(portable(actual.rows, path.dirname(packed))).toEqual(
      portable(expected.rows, path.dirname(linked))
    );
    const zipped = await validate(zip(packed), true);
    expect(zipped.passed).toBe(false);
    expect(zipped.rows.map((row) => row.split(',').slice(3))).toEqual(
      actual.rows.map((row) => row.split(',').slice(3))
    );
  });

  it('passes a county CAR with packed roots', async () => {
    const out = await hash(path.join(SOURCE, 'property'), tmp, true);
    const result = await validate(out.outputCar);
    expect(result.rows).toEqual([]);
    expect(result).toMatchObject({
      passed: true,
      summary: {
        blocks: EXPECTED['vector-2'].car.packed,
        properties: 1,
        groups: 2,
        errors: { graph: 0, lexicon: 0, orphans: 0 },
      },
    });
  });

  it('reports the same rows for a packed county CAR as for the linked one', async () => {
    const source = path.join(SOURCE, 'property');
    const linked = await hash(source, path.join(tmp, 'linked'), false);
    const packed = await hash(source, path.join(tmp, 'packed'), true);
    const expected = await validate(linked.outputCar, true);
    expect(expected.summary?.errors.lexicon).toBeGreaterThan(0);
    expect(expected.rows.join('\n')).toContain(
      '/relationships/property_has_tax/0/to/tax_year'
    );
    const actual = await validate(packed.outputCar, true);
    expect(actual.passed).toBe(false);
    expect(actual.summary?.errors).toEqual(expected.summary?.errors);
    expect(actual.summary?.groups).toBe(expected.summary?.groups);
    // Only the block column differs: it names the data-group root in each CAR.
    expect(portable(actual.rows, EXPECTED['vector-2'].packed)).toEqual(
      portable(expected.rows, EXPECTED['vector-2'].linked)
    );
    expect(actual.rows.join('\n')).toContain(EXPECTED['vector-2'].packed);
  });

  it('names the packed data group, not a CAR, when a pointer is not among its entities', async () => {
    const [, change] = CORRUPTIONS[2];
    const result = await validate(await packedDirectory(await corrupt(change)));
    expect(result.rows.join('\n')).toContain(
      `block ${ABSENT} is not in the packed data group`
    );
    expect(result.rows.join('\n')).not.toContain('is not in the car');
  });

  it('reports a packed root that cannot be unpacked and goes on with the CAR', async () => {
    const text = (
      await fsPromises.readFile(path.join(SOURCE, 'packed.json'), 'utf-8')
    ).replace('"tax_year":2023', '"tax_year":1e999');
    const result = await validate(await packedCar(undefined, text));
    expect(result.summary).toMatchObject({
      properties: 1,
      errors: { lexicon: 1, orphans: 0 },
    });
    expect(result.rows.join('\n')).toContain('cannot be unpacked');
  });

  describe.each(CORRUPTIONS)('%s', (_name, change, message) => {
    it('fails a property directory and a property ZIP', async () => {
      const dir = await packedDirectory(await corrupt(change));
      for (const input of [dir, zip(dir)]) {
        const result = await validate(input);
        expect(result.passed).toBe(false);
        expect(result.rows.join('\n')).toContain(message);
      }
    });

    it('fails a county CAR', async () => {
      const result = await validate(await packedCar(await corrupt(change)));
      expect(result.passed).toBe(false);
      expect(result.summary?.errors.lexicon).toBeGreaterThan(0);
      expect(result.rows.join('\n')).toContain(message);
    });
  });
});
