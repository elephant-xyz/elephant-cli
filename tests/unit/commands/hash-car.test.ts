import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fsPromises } from 'fs';
import os from 'os';
import path from 'path';
import AdmZip from 'adm-zip';
import { CarReader } from '@ipld/car';
import * as dagJSON from '@ipld/dag-json';
import { CID } from 'multiformats/cid';
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

async function writeJson(dir: string, files: Record<string, unknown>) {
  await fsPromises.mkdir(dir, { recursive: true });
  for (const [name, data] of Object.entries(files)) {
    await fsPromises.writeFile(path.join(dir, name), JSON.stringify(data));
  }
}

function writeProperty(dir: string, suffix: string) {
  return writeJson(dir, {
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
  });
}

function zipEntries(zipPath: string): Map<string, Buffer> {
  return new Map(
    new AdmZip(zipPath)
      .getEntries()
      .filter((entry) => entry.entryName.endsWith('.json'))
      .map((entry) => [
        path.basename(entry.entryName, '.json'),
        entry.getData(),
      ])
  );
}

async function csvRows(csvPath: string) {
  const text = await fsPromises.readFile(csvPath, 'utf-8');
  return text
    .trim()
    .split('\n')
    .slice(1)
    .map((line) => {
      const [propertyCid, dataGroupCid, dataCid] = line.split(',');
      return { propertyCid, dataGroupCid, dataCid };
    });
}

interface Shard {
  properties: { property_cid: CID; data_groups: Record<string, CID> }[];
}

async function readCar(carPath: string) {
  const reader = await CarReader.fromBytes(await fsPromises.readFile(carPath));
  const roots = await reader.getRoots();
  const decode = async <T>(cid: CID): Promise<T> =>
    dagJSON.decode((await reader.get(cid))!.bytes);
  const index = await decode<{
    label: string;
    version: number;
    properties: number;
    shards: CID[];
  }>(roots[0]);
  const shards = await Promise.all(
    index.shards.map((cid) => decode<Shard>(cid))
  );
  const blocks = new Map<string, Uint8Array>();
  for await (const block of reader.blocks()) {
    blocks.set(block.cid.toString(), block.bytes);
  }
  return { roots: roots.map(String), index, shards, blocks };
}

describe('hash --output-car', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'hash-car-'));
  });

  afterEach(async () => {
    await fsPromises.rm(tmp, { recursive: true, force: true });
  });

  it('writes one property as blocks under a county index root', async () => {
    const input = path.join(tmp, 'property');
    await writeProperty(input, 'a');
    const outputZip = path.join(tmp, 'hashed.zip');
    const outputCsv = path.join(tmp, 'hash.csv');
    const outputCar = path.join(tmp, 'out', 'property.car');

    const root = await handleHash(
      { input, outputZip, outputCsv, outputCar, silent: true, cwd: tmp },
      overrides
    );

    const car = await readCar(outputCar);
    expect(car.roots).toEqual([root]);
    expect(car.index).toMatchObject({
      label: 'CountyIndex',
      version: 1,
      properties: 1,
    });
    expect(car.shards).toHaveLength(1);
    const rows = await csvRows(outputCsv);
    expect(rows).toHaveLength(2);
    expect(car.shards[0].properties).toHaveLength(1);
    expect(car.shards[0].properties[0].property_cid.toString()).toBe(
      rows[0].propertyCid
    );
    const groups = car.shards[0].properties[0].data_groups;
    for (const row of rows) {
      expect(groups[row.dataGroupCid].toString()).toBe(row.dataCid);
    }
    const entries = zipEntries(outputZip);
    expect(entries.size).toBe(4);
    // 4 json blocks + 1 shard + 1 index
    expect(car.blocks.size).toBe(6);
    for (const [cid, bytes] of entries) {
      expect(Buffer.from(car.blocks.get(cid)!)).toEqual(bytes);
    }
  });

  it('finalizes a batch car listing only the properties that succeeded', async () => {
    const input = path.join(tmp, 'county');
    await writeProperty(path.join(input, 'one'), 'one');
    await writeProperty(path.join(input, 'two'), 'two');
    // No seed and no --property-cid: this property throws
    await writeJson(path.join(input, 'bad'), {
      'county.json': { label: 'County', relationships: {} },
    });
    const outputZip = path.join(tmp, 'hashed');
    const outputCsv = path.join(tmp, 'hash.csv');
    const outputCar = path.join(tmp, 'county.car');

    await expect(
      handleHash(
        { input, outputZip, outputCsv, outputCar, silent: true, cwd: tmp },
        overrides
      )
    ).rejects.toThrow('1 of 3 properties failed: bad');

    const car = await readCar(outputCar);
    expect(car.roots).toHaveLength(1);
    expect(car.index.properties).toBe(2);
    const listed = car.shards
      .flatMap((shard) => shard.properties)
      .map((property) => property.property_cid.toString())
      .sort();
    const rows = await csvRows(outputCsv);
    expect(listed).toEqual(
      [...new Set(rows.map((row) => row.propertyCid))].sort()
    );
    expect(await fsPromises.readdir(tmp)).not.toContain('county.car.tmp');
  });

  it('rejects instead of hanging when the car path is unwritable', async () => {
    const input = path.join(tmp, 'property');
    await writeProperty(input, 'a');
    await fsPromises.writeFile(path.join(tmp, 'blocker'), '');

    await expect(
      handleHash(
        {
          input,
          outputZip: path.join(tmp, 'hashed.zip'),
          outputCsv: path.join(tmp, 'hash.csv'),
          outputCar: path.join(tmp, 'blocker', 'county.car'),
          silent: true,
          cwd: tmp,
        },
        overrides
      )
    ).rejects.toThrow(/ENOTDIR|EEXIST/);
  }, 10000);
});
