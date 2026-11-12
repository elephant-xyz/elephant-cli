import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fsPromises } from 'fs';
import os from 'os';
import path from 'path';
import {
  handleValidate,
  ValidateServiceOverrides,
} from '../../../src/commands/validate.js';
import { JsonValidatorService } from '../../../src/services/json-validator.service.js';
import { CarOutputService } from '../../../src/services/car-output.service.js';
import { CarSummary } from '../../../src/services/car-validator.service.js';
import { fetchFromIpfs } from '../../../src/utils/schema-fetcher.js';
import { logger } from '../../../src/utils/logger.js';
import {
  buildCountyCar as build,
  GROUP,
  SEED,
  schemaCacheService,
} from '../../helpers/county-car.js';

vi.mock('../../../src/utils/schema-fetcher.js', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../../../src/utils/schema-fetcher.js')
  >()),
  fetchFromIpfs: vi.fn(),
}));

const overrides: ValidateServiceOverrides = {
  schemaCacheService,
  jsonValidatorService: new JsonValidatorService('', schemaCacheService),
};

describe('validate <county.car>', () => {
  let tmp: string;
  let car: string;
  let csv: string;

  // `megabytes` is the memory budget for held blocks, as `--car-memory` sets it.
  const run = (megabytes?: number) =>
    handleValidate(
      {
        input: car,
        outputCsv: csv,
        silent: true,
        cwd: tmp,
        carMemory: megabytes,
      },
      overrides
    ).catch((error: { summary: CarSummary }) => error.summary);

  const rows = async () =>
    (await fsPromises.readFile(csv, 'utf-8'))
      .trim()
      .split('\n')
      .slice(1)
      .map((line) => line.split(','));

  // Whether the run fell back to an index of the whole file, which it warns about.
  const warn = vi.spyOn(logger, 'warn');
  const indexed = () =>
    warn.mock.calls.some(([message]) =>
      String(message).includes('indexing the whole file')
    );

  beforeEach(async () => {
    warn.mockClear();
    tmp = await fsPromises.mkdtemp(
      path.join(path.resolve(os.tmpdir()), 'validate-car-')
    );
    car = path.join(tmp, 'county.car');
    csv = path.join(tmp, 'errors.csv');
  });

  afterEach(async () => {
    await fsPromises.rm(tmp, { recursive: true, force: true });
  });

  const clean: CarSummary = {
    blocks: 10,
    properties: 2,
    groups: 2,
    lookups: 0,
    spilled: 0,
    errors: {
      integrity: 0,
      root: 0,
      index: 0,
      graph: 0,
      lexicon: 0,
      orphans: 0,
    },
  };

  it('passes a well-formed county car with the right counts', async () => {
    await build(car);
    expect(await run()).toEqual(clean);
    expect(await rows()).toEqual([]);
    await expect(
      fsPromises.access(path.join(tmp, 'submit_warnings.csv'))
    ).rejects.toThrow();
  });

  it('checks a file written by hash --output-car without looking any block up by CID', async () => {
    const { blocks } = await build(path.join(tmp, 'source.car'));
    const writer = new CarOutputService(car, 1);
    await writer.open();
    for (const start of [0, 4]) {
      for (const block of blocks.slice(start, start + 4)) {
        await writer.put(block.cid, block.bytes);
      }
      await writer.property(blocks[start].cid, { [GROUP]: blocks[start].cid });
    }
    await writer.close();
    expect(await run()).toEqual({ ...clean, blocks: 11 });
    expect(indexed()).toBe(false);
  });

  it('counts every property when the index has several shards', async () => {
    await build(car, { split: true });
    expect(await run()).toEqual({ ...clean, blocks: 11 });
    expect(await rows()).toEqual([]);
  });

  it('follows a link into a block stored under another shard', async () => {
    await build(car, { shared: true });
    // one block, property a's address, is looked up from property b's shard
    expect(await run()).toEqual({ ...clean, lookups: 1 });
    expect(await rows()).toEqual([]);
  });

  it('does not call a spare copy of a linked block an orphan', async () => {
    await build(car, { spare: true });
    expect(await run()).toEqual({ ...clean, blocks: 12 });
    expect(await rows()).toEqual([]);
  });

  it('does not call a block an orphan when a later shard links to it', async () => {
    await build(car, { late: true });
    expect(await run()).toEqual({ ...clean, blocks: 11, lookups: 1 });
    expect(await rows()).toEqual([]);
  });

  it('gives the same findings when the blocks are stored root first', async () => {
    await build(car, { reversed: true });
    // every block but the shard is stored after the shard that links to it,
    // and each of those 9 is looked up by CID once
    expect(await run()).toEqual({ ...clean, lookups: 9 });
    expect(indexed()).toBe(true);
    const { blocks } = await build(car, { reversed: true, bad: true });
    expect(await run()).toEqual({
      ...clean,
      lookups: 9,
      errors: { ...clean.errors, lexicon: 1 },
    });
    expect((await rows()).map((row) => row[0])).toEqual([
      blocks[4].cid.toString(),
    ]);
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
      blocks[2].cid.toString(),
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
    // a missing block must not cost an index of the whole file
    expect(indexed()).toBe(false);
    const [row] = await rows();
    expect(row[2]).toBe(blocks[7].cid.toString());
    expect(row[4]).toContain(nowhere.toString());
  });

  it('reports a block unreachable from the root as an orphan', async () => {
    const { blocks } = await build(car, { extra: true });
    const summary = (await run()) as CarSummary;
    expect(summary.blocks).toBe(11);
    expect(summary.errors).toMatchObject({ graph: 0, orphans: 1 });
    // one stray block must not send the whole file down the slow path
    expect(indexed()).toBe(false);
    expect((await rows()).map((row) => row[2])).toEqual([
      blocks[10].cid.toString(),
    ]);
  });

  it('reports every other block as an orphan when the index lists no shards', async () => {
    await build(car, { unlisted: true });
    expect(await run()).toEqual({
      ...clean,
      properties: 0,
      groups: 0,
      errors: { ...clean.errors, index: 1, orphans: 9 },
    });
  });

  it('gives the same findings when it may hold no block bytes in memory', async () => {
    await build(car);
    // the 9 blocks up to the shard are read back from the file, none by CID
    expect(await run(0)).toEqual({ ...clean, spilled: 9 });
    expect(indexed()).toBe(false);
    await build(car, { bad: true, extra: true });
    expect(await run(0)).toEqual({
      ...clean,
      blocks: 11,
      spilled: 9,
      errors: { ...clean.errors, lexicon: 1, orphans: 1 },
    });
  });

  it('charges a block written twice under one shard to the memory budget once', async () => {
    const { blocks } = await build(car, { doubled: true });
    // room for each of the 9 different blocks up to the shard, and no more
    const bytes = [...blocks.slice(0, 4), ...blocks.slice(5, 10)].reduce(
      (sum, block) => sum + block.bytes.length,
      0
    );
    expect(await run(bytes / 2 ** 20)).toEqual({ ...clean, blocks: 11 });
    expect(await rows()).toEqual([]);
  });

  it('reports a missing data group under index even when an earlier block links to it', async () => {
    const { blocks, nowhere } = await build(car, { claimed: true });
    expect(await run()).toEqual({
      ...clean,
      blocks: 11,
      errors: { ...clean.errors, index: 1, lexicon: 1 },
    });
    const found = (await rows()).find((row) => row[3] === 'index');
    // the row names the shard, the property and the data group, not the earlier block
    expect(found?.slice(0, 3)).toEqual([
      blocks[5].cid.toString(),
      SEED,
      blocks[9].cid.toString(),
    ]);
    expect(found?.[4]).toContain(nowhere.toString());
  });

  it('reads a shard once for each time the index lists it', async () => {
    const { root } = await build(car, { twice: true });
    expect(await run()).toEqual({
      ...clean,
      properties: 4,
      groups: 4,
      errors: { ...clean.errors, index: 1 },
    });
    expect((await rows()).map((row) => [row[2], row[4]])).toEqual([
      [root.toString(), 'index declares 2 properties but shards hold 4'],
    ]);
  });

  it('reports a listed shard that is not in the car', async () => {
    const { root } = await build(car, { gone: true });
    expect(await run()).toEqual({
      ...clean,
      properties: 1,
      groups: 1,
      errors: { ...clean.errors, index: 2, orphans: 4 },
    });
    const found = (await rows()).filter((row) => row[3] === 'index');
    expect(found.map((row) => row[2])).toEqual([
      root.toString(),
      root.toString(),
    ]);
    expect(found[0][4]).toContain('is not in the car');
    expect(indexed()).toBe(false);
    expect(found[1][4]).toBe('index declares 2 properties but shards hold 1');
  });

  it('fails lexicon on a pointer missing from the car without touching ipfs', async () => {
    const { blocks, nowhere } = await build(car, { lost: true });
    const summary = (await run()) as CarSummary;
    expect(summary.errors).toMatchObject({ graph: 1, lexicon: 1, orphans: 3 });
    const row = (await rows()).find((fields) => fields[3] === 'root');
    expect(row?.[0]).toBe(blocks[4].cid.toString());
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

  it('reports a data-group root that fails its schema', async () => {
    const { blocks } = await build(car, { bad: true });
    const summary = (await run()) as CarSummary;
    expect(summary.groups).toBe(2);
    expect(summary.errors).toMatchObject({ lexicon: 1, graph: 0, orphans: 0 });
    const [row] = await rows();
    expect(row[0]).toBe(blocks[4].cid.toString());
    expect(row[1]).toBe(GROUP);
    expect(row[3]).toContain('parcel_identifier');
  });
});
