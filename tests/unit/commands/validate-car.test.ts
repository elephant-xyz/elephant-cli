import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fsPromises } from 'fs';
import os from 'os';
import path from 'path';
import { CarWriter } from '@ipld/car';
import * as dagJSON from '@ipld/dag-json';
import * as raw from 'multiformats/codecs/raw';
import { CID } from 'multiformats/cid';
import { sha256 } from 'multiformats/hashes/sha2';
import {
  handleValidate,
  ValidateServiceOverrides,
} from '../../../src/commands/validate.js';
import { JsonValidatorService } from '../../../src/services/json-validator.service.js';
import { SchemaCacheService } from '../../../src/services/schema-cache.service.js';
import { CarSummary } from '../../../src/services/car-validator.service.js';
import { fetchFromIpfs } from '../../../src/utils/schema-fetcher.js';

vi.mock('../../../src/utils/schema-fetcher.js', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../../../src/utils/schema-fetcher.js')
  >()),
  fetchFromIpfs: vi.fn(),
}));

interface Block {
  cid: CID;
  bytes: Uint8Array;
}

async function json(value: unknown): Promise<Block> {
  const bytes = dagJSON.encode(value);
  return {
    cid: CID.create(1, dagJSON.code, await sha256.digest(bytes)),
    bytes,
  };
}

async function text(value: string): Promise<Block> {
  const bytes = new TextEncoder().encode(value);
  return { cid: CID.create(1, raw.code, await sha256.digest(bytes)), bytes };
}

const SEED_SCHEMA = (await text('seed schema')).cid.toString();
const PARCEL_SCHEMA = (await text('parcel schema')).cid.toString();

const SCHEMAS: Record<string, object> = {
  [SEED_SCHEMA]: {
    type: 'object',
    properties: {
      label: { type: 'string' },
      relationships: {
        type: 'object',
        properties: { parcel: { type: 'string', cid: PARCEL_SCHEMA } },
      },
    },
  },
  [PARCEL_SCHEMA]: {
    type: 'object',
    properties: { parcel_identifier: { type: 'string' } },
    required: ['parcel_identifier'],
  },
};

const schemaCacheService = {
  get: async (cid: string) => SCHEMAS[cid],
} as unknown as SchemaCacheService;

const overrides: ValidateServiceOverrides = {
  schemaCacheService,
  jsonValidatorService: new JsonValidatorService('', schemaCacheService),
};

interface Tweaks {
  bad?: boolean;
  dangling?: boolean;
  lost?: boolean;
  extra?: boolean;
}

/** Two properties (seed -> parcel -> raw note), one shard, one index. */
async function build(file: string, tweaks: Tweaks = {}) {
  const blocks: Block[] = [];
  const entries: { property_cid: CID; data_groups: Record<string, CID> }[] = [];
  const nowhere = (await text('nowhere')).cid;
  for (const suffix of ['a', 'b']) {
    const note = await text(`note for ${suffix}`);
    const parcel = await json({
      parcel_identifier: tweaks.bad && suffix === 'b' ? 7 : `parcel-${suffix}`,
      note: note.cid,
      ...(tweaks.dangling && suffix === 'b' ? { extra: nowhere } : {}),
    });
    const seed = await json({
      label: 'Seed',
      relationships: {
        parcel: tweaks.lost && suffix === 'b' ? nowhere : parcel.cid,
      },
    });
    blocks.push(seed, parcel, note);
    entries.push({
      property_cid: seed.cid,
      data_groups: { [SEED_SCHEMA]: seed.cid },
    });
  }
  const shard = await json({ properties: entries });
  const index = await json({
    label: 'CountyIndex',
    version: 1,
    properties: entries.length,
    shards: [shard.cid],
  });
  blocks.push(shard, index);
  if (tweaks.extra) {
    blocks.push(await text('unreachable'));
  }
  const channel = CarWriter.create([index.cid]);
  const chunks: Uint8Array[] = [];
  const drained = (async () => {
    for await (const chunk of channel.out) {
      chunks.push(chunk);
    }
  })();
  for (const block of blocks) {
    await channel.writer.put(block);
  }
  await channel.writer.close();
  await drained;
  await fsPromises.writeFile(file, Buffer.concat(chunks));
  return { blocks, nowhere };
}

describe('validate <county.car>', () => {
  let tmp: string;
  let car: string;
  let csv: string;

  const run = () =>
    handleValidate(
      { input: car, outputCsv: csv, silent: true, cwd: tmp },
      overrides
    ).catch((error: { summary: CarSummary }) => error.summary);

  const rows = async () =>
    (await fsPromises.readFile(csv, 'utf-8'))
      .trim()
      .split('\n')
      .slice(1)
      .map((line) => line.split(','));

  beforeEach(async () => {
    tmp = await fsPromises.mkdtemp(
      path.join(path.resolve(os.tmpdir()), 'validate-car-')
    );
    car = path.join(tmp, 'county.car');
    csv = path.join(tmp, 'errors.csv');
  });

  afterEach(async () => {
    await fsPromises.rm(tmp, { recursive: true, force: true });
  });

  it('passes a well-formed county car with the right counts', async () => {
    await build(car);
    expect(await run()).toEqual({
      blocks: 8,
      properties: 2,
      groups: 2,
      errors: {
        integrity: 0,
        root: 0,
        index: 0,
        graph: 0,
        lexicon: 0,
        orphans: 0,
      },
    });
    expect(await rows()).toEqual([]);
  });

  it('reports a block whose bytes were altered', async () => {
    const { blocks } = await build(car);
    const bytes = await fsPromises.readFile(car);
    const at = bytes.indexOf('parcel-a');
    bytes[at + 'parcel-'.length] = 'z'.charCodeAt(0);
    await fsPromises.writeFile(car, bytes);
    const summary = (await run()) as CarSummary;
    expect(summary.errors).toMatchObject({
      integrity: 1,
      graph: 0,
      orphans: 0,
    });
    expect((await rows()).map((row) => row[2])).toEqual([
      blocks[1].cid.toString(),
    ]);
  });

  it('reports a link that does not resolve inside the car', async () => {
    const { blocks, nowhere } = await build(car, { dangling: true });
    const summary = (await run()) as CarSummary;
    expect(summary.errors).toMatchObject({
      integrity: 0,
      graph: 1,
      lexicon: 0,
    });
    const [row] = await rows();
    expect(row[2]).toBe(blocks[4].cid.toString());
    expect(row[4]).toContain(nowhere.toString());
  });

  it('reports a block unreachable from the root as an orphan', async () => {
    const { blocks } = await build(car, { extra: true });
    const summary = (await run()) as CarSummary;
    expect(summary.blocks).toBe(9);
    expect(summary.errors).toMatchObject({ graph: 0, orphans: 1 });
    expect((await rows()).map((row) => row[2])).toEqual([
      blocks[8].cid.toString(),
    ]);
  });

  it('fails lexicon on a pointer missing from the car without touching ipfs', async () => {
    const { blocks, nowhere } = await build(car, { lost: true });
    const summary = (await run()) as CarSummary;
    expect(summary.errors).toMatchObject({ graph: 1, lexicon: 1, orphans: 2 });
    const row = (await rows()).find((fields) => fields[3] === 'root');
    expect(row?.[0]).toBe(blocks[3].cid.toString());
    expect(row?.[4]).toContain(`block ${nowhere} is not in the car`);
    expect(fetchFromIpfs).not.toHaveBeenCalled();
  });

  it('rejects a path that is not a readable file', async () => {
    car = path.join(tmp, 'missing.car');
    await expect(
      handleValidate(
        { input: car, outputCsv: csv, silent: true, cwd: tmp },
        overrides
      )
    ).rejects.toThrow('is not a readable file');
    await expect(fsPromises.access(csv)).rejects.toThrow();
  });

  it('leaves no warnings file beside the error csv', async () => {
    await build(car);
    await run();
    await expect(
      fsPromises.access(path.join(tmp, 'submit_warnings.csv'))
    ).rejects.toThrow();
  });

  it('reports a data-group root that fails its schema', async () => {
    const { blocks } = await build(car, { bad: true });
    const summary = (await run()) as CarSummary;
    expect(summary.groups).toBe(2);
    expect(summary.errors).toMatchObject({ lexicon: 1, graph: 0, orphans: 0 });
    const [row] = await rows();
    expect(row[0]).toBe(blocks[3].cid.toString());
    expect(row[1]).toBe(SEED_SCHEMA);
    expect(row[3]).toContain('parcel_identifier');
  });
});
