import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fsPromises } from 'fs';
import os from 'os';
import path from 'path';
import AdmZip from 'adm-zip';
import { CarReader } from '@ipld/car';
import {
  handleHash,
  HashServiceOverrides,
} from '../../../src/commands/hash.js';
import { SEED_DATAGROUP_SCHEMA_CID } from '../../../src/config/constants.js';

const COUNTY_CID = 'bafkreicountyschemacidfortestsonlyxxxxxxxxxxxxxxxxxxxxxxxx';

const overrides = {
  schemaCacheService: { get: async () => ({}) },
  schemaManifestService: {
    loadSchemaManifest: async () => ({}),
    getDataGroupCidByLabel: (label: string) =>
      ({ Seed: SEED_DATAGROUP_SCHEMA_CID, County: COUNTY_CID })[label] ?? null,
    getAllDataGroups: () => [],
  },
} as unknown as HashServiceOverrides;

async function writeProperty(dir: string, suffix: string) {
  await fsPromises.mkdir(dir, { recursive: true });
  const files: Record<string, unknown> = {
    'seed.json': {
      label: 'Seed',
      relationships: { parcel: { '/': './parcel.json' } },
    },
    'parcel.json': { parcel_identifier: `parcel-${suffix}` },
    'county.json': {
      label: 'County',
      relationships: { link: { '/': './shared.json' } },
    },
    'shared.json': { shared: 'identical across properties' },
  };
  for (const [name, data] of Object.entries(files)) {
    await fsPromises.writeFile(path.join(dir, name), JSON.stringify(data));
  }
}

function zipJsonNames(zipPath: string): string[] {
  return new AdmZip(zipPath)
    .getEntries()
    .filter((entry) => entry.entryName.endsWith('.json'))
    .map((entry) => path.basename(entry.entryName, '.json'));
}

async function csvDataCids(csvPath: string): Promise<string[]> {
  const text = await fsPromises.readFile(csvPath, 'utf-8');
  return text
    .trim()
    .split('\n')
    .slice(1)
    .map((line) => line.split(',')[2]);
}

async function readCar(carPath: string) {
  const reader = await CarReader.fromBytes(await fsPromises.readFile(carPath));
  const roots = (await reader.getRoots()).map((cid) => cid.toString());
  const blocks = new Map<string, Uint8Array>();
  for await (const block of reader.blocks()) {
    blocks.set(block.cid.toString(), block.bytes);
  }
  return { roots, blocks };
}

describe('hash --output-car', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'hash-car-'));
  });

  afterEach(async () => {
    await fsPromises.rm(tmp, { recursive: true, force: true });
  });

  it('writes every json block of one property with data-group roots', async () => {
    const input = path.join(tmp, 'property');
    await writeProperty(input, 'a');
    const outputZip = path.join(tmp, 'hashed.zip');
    const outputCsv = path.join(tmp, 'hash.csv');
    const outputCar = path.join(tmp, 'out', 'property.car');

    await handleHash(
      { input, outputZip, outputCsv, outputCar, silent: true, cwd: tmp },
      overrides
    );

    const car = await readCar(outputCar);
    const names = zipJsonNames(outputZip);
    expect(names).toHaveLength(4);
    expect([...car.blocks.keys()].sort()).toEqual([...names].sort());
    expect(car.roots).toEqual(await csvDataCids(outputCsv));
    expect(car.roots).toHaveLength(2);
    for (const entry of new AdmZip(outputZip).getEntries()) {
      const cid = path.basename(entry.entryName, '.json');
      expect(Buffer.from(car.blocks.get(cid)!)).toEqual(entry.getData());
    }
    await expect(fsPromises.stat(`${outputCar}.tmp`)).rejects.toThrow();
  });

  it('collects a directory of properties into one deduplicated car', async () => {
    const input = path.join(tmp, 'county');
    await writeProperty(path.join(input, 'one'), 'one');
    await writeProperty(path.join(input, 'two'), 'two');
    const outputZip = path.join(tmp, 'hashed');
    const outputCsv = path.join(tmp, 'hash.csv');
    const outputCar = path.join(tmp, 'county.car');

    await handleHash(
      { input, outputZip, outputCsv, outputCar, silent: true, cwd: tmp },
      overrides
    );

    const car = await readCar(outputCar);
    const names = new Set([
      ...zipJsonNames(path.join(outputZip, 'one.zip')),
      ...zipJsonNames(path.join(outputZip, 'two.zip')),
    ]);
    // county.json and shared.json are byte-identical in both properties
    expect(names.size).toBe(6);
    expect(new Set(car.blocks.keys())).toEqual(names);
    expect(car.roots).toEqual(await csvDataCids(outputCsv));
    expect(car.roots).toHaveLength(4);
  });
});
