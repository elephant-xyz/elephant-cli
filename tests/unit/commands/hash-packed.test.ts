import { describe, it, expect } from 'vitest';
import { promises as fsPromises } from 'fs';
import path from 'path';
import {
  EXPECTED,
  hash,
  scratch,
  Vector,
  VECTORS,
  zipped,
} from '../../helpers/packed.js';

const fresh = await scratch('hash-packed-');

describe('hash --packed', () => {
  it.each<Vector>(['vector-1', 'vector-2'])(
    'writes the County group of %s as the one reference block',
    async (vector) => {
      const expected = EXPECTED[vector];
      const golden = await fsPromises.readFile(
        path.join(VECTORS, vector, 'packed.json')
      );
      expect(golden.length).toBe(expected.bytes);

      const out = await hash(
        path.join(VECTORS, vector, 'property'),
        await fresh(),
        true
      );

      expect(out.data).toEqual({
        'seed.json': EXPECTED.property,
        'county.json': expected.packed,
      });
      const zip = zipped(out.outputZip);
      expect(zip.size).toBe(expected.zip.packed);
      expect(zip.get(`${EXPECTED.property}/${expected.packed}.json`)).toEqual(
        golden
      );
      expect(out.blocks.size).toBe(expected.car.packed);
      expect(Buffer.from(out.blocks.get(expected.packed)!)).toEqual(golden);
    }
  );

  it.each<Vector>(['vector-1', 'vector-2'])(
    'leaves %s linked without the option',
    async (vector) => {
      const expected = EXPECTED[vector];
      const out = await hash(
        path.join(VECTORS, vector, 'property'),
        await fresh(),
        false
      );
      expect(out.data).toEqual({
        'seed.json': EXPECTED.property,
        'county.json': expected.linked,
      });
      expect(zipped(out.outputZip).size).toBe(expected.zip.linked);
      expect(out.blocks.size).toBe(expected.car.linked);
    }
  );

  /** Vector 2 with some files replaced, hashed linked and packed. */
  const both = async (files: Record<string, unknown>) => {
    const tmp = await fresh();
    const input = path.join(tmp, 'property');
    await fsPromises.cp(path.join(VECTORS, 'vector-2', 'property'), input, {
      recursive: true,
    });
    for (const [name, value] of Object.entries(files)) {
      await fsPromises.writeFile(path.join(input, name), JSON.stringify(value));
    }
    return {
      linked: await hash(input, path.join(tmp, 'linked'), false),
      packed: await hash(input, path.join(tmp, 'packed'), true),
    };
  };

  it.each([
    [
      'an entity contains a link',
      {
        'tax_2023.json': { tax_year: 2023, bill: { '/': './parcel.json' } },
      },
    ],
    [
      'the packed block would be over 1 MiB',
      { 'tax_2023.json': { tax_year: 2023, note: 'x'.repeat(1 << 20) } },
    ],
  ])(
    'writes a group linked, as without the option, when %s',
    async (_name, files) => {
      const { linked, packed } = await both(files);
      expect(packed.data).toEqual(linked.data);
      expect(packed.data['county.json']).not.toBe(EXPECTED['vector-2'].linked);
      expect(zipped(packed.outputZip)).toEqual(zipped(linked.outputZip));
      expect(await fsPromises.readFile(packed.outputCar)).toEqual(
        await fsPromises.readFile(linked.outputCar)
      );
    }
  );

  it('keeps Seed linked with every block it links to', async () => {
    const { linked, packed } = await both({});
    const before = zipped(linked.outputZip);
    const after = zipped(packed.outputZip);
    expect(packed.data['seed.json']).toBe(linked.data['seed.json']);
    // Gone: County's root, 3 relationship blocks, and property and 2 tax entities.
    expect([...before.keys()].filter((name) => !after.has(name))).toHaveLength(
      7
    );
    // Kept as they were: the Seed root, its relationship, and address and parcel.
    const kept = [...after].filter(([name]) => before.has(name));
    expect(kept).toHaveLength(4);
    for (const [name, bytes] of kept) {
      expect(before.get(name)).toEqual(bytes);
    }
  });

  it('packs every property of a directory input', async () => {
    const tmp = await fresh();
    const input = path.join(tmp, 'county');
    for (const vector of ['vector-1', 'vector-2']) {
      await fsPromises.cp(
        path.join(VECTORS, vector, 'property'),
        path.join(input, vector),
        { recursive: true }
      );
    }
    const out = await hash(input, path.join(tmp, 'out'), true);
    const csv = await fsPromises.readFile(out.outputCsv, 'utf-8');
    expect(
      csv
        .trim()
        .split('\n')
        .slice(1)
        .map((line) => line.split(',')[2])
    ).toEqual([
      EXPECTED.property,
      EXPECTED['vector-1'].packed,
      EXPECTED.property,
      EXPECTED['vector-2'].packed,
    ]);
    for (const vector of ['vector-1', 'vector-2'] as const) {
      const zip = zipped(path.join(out.outputZip, `${vector}.zip`));
      expect(zip.size).toBe(EXPECTED[vector].zip.packed);
      expect(
        zip.has(`${EXPECTED.property}/${EXPECTED[vector].packed}.json`)
      ).toBe(true);
    }
    // 4 blocks under the shared Seed, 2 packed roots, 1 shard, 1 index
    expect(out.blocks.size).toBe(8);
  });
});
