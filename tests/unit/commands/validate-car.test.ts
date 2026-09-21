import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fsPromises } from 'fs';
import os from 'os';
import path from 'path';
import {
  handleValidate,
  ValidateServiceOverrides,
} from '../../../src/commands/validate.js';
import { JsonValidatorService } from '../../../src/services/json-validator.service.js';
import { CarSummary } from '../../../src/services/car-validator.service.js';
import { fetchFromIpfs } from '../../../src/utils/schema-fetcher.js';
import {
  buildCountyCar as build,
  GROUP,
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
      blocks: 10,
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
    await expect(
      fsPromises.access(path.join(tmp, 'submit_warnings.csv'))
    ).rejects.toThrow();
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
    const [row] = await rows();
    expect(row[2]).toBe(blocks[7].cid.toString());
    expect(row[4]).toContain(nowhere.toString());
  });

  it('reports a block unreachable from the root as an orphan', async () => {
    const { blocks } = await build(car, { extra: true });
    const summary = (await run()) as CarSummary;
    expect(summary.blocks).toBe(11);
    expect(summary.errors).toMatchObject({ graph: 0, orphans: 1 });
    expect((await rows()).map((row) => row[2])).toEqual([
      blocks[10].cid.toString(),
    ]);
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
