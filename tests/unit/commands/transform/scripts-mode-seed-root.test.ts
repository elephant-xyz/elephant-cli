import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fsPromises } from 'fs';
import os from 'os';
import path from 'path';
import AdmZip from 'adm-zip';
import { CID } from 'multiformats/cid';
import { handleTransform } from '../../../../src/commands/transform/index.js';
import {
  handleHash,
  HashServiceOverrides,
} from '../../../../src/commands/hash.js';
import { SEED_DATAGROUP_SCHEMA_CID } from '../../../../src/config/constants.js';

const COUNTY_CID = 'bafkreicountyschemacidfortestsonlyxxxxxxxxxxxxxxxxxxxxxxxx';

vi.mock('../../../../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    success: vi.fn(),
    technical: vi.fn(),
  },
}));
vi.mock('../../../../src/utils/schema-fetcher.js', async () => {
  const constants = await import('../../../../src/config/constants.js');
  return {
    fetchSchemaManifest: async () => ({
      Seed: { ipfsCid: constants.SEED_DATAGROUP_SCHEMA_CID, type: 'dataGroup' },
    }),
  };
});
vi.mock(
  '../../../../src/services/schema-manifest.service.js',
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import('../../../../src/services/schema-manifest.service.js')
      >();
    return {
      SchemaManifestService: class extends actual.SchemaManifestService {
        async loadSchemaManifest() {
          return {};
        }
        getDataGroupCidByLabel(label: string) {
          return label === 'County' ? COUNTY_CID : null;
        }
        getAllDataGroups() {
          return [];
        }
      },
    };
  }
);
// The fixture scripts use built-ins only; the linker relies on import.meta.resolve, which Vitest lacks.
vi.mock('../../../../src/utils/node-modules.js', () => ({
  linkNodeModulesIntoTemp: () => {},
}));

const overrides = {
  schemaCacheService: { get: async () => ({}) },
  schemaManifestService: {
    loadSchemaManifest: async () => ({}),
    getDataGroupCidByLabel: (label: string) =>
      ({ Seed: SEED_DATAGROUP_SCHEMA_CID, County: COUNTY_CID })[label] ?? null,
    getAllDataGroups: () => [],
  },
} as unknown as HashServiceOverrides;

/** Scripts that read the seed entities the way county scripts do and write property, address and parcel. */
const EXTRACTOR = `
const fs = process.getBuiltinModule('fs');
const seed = JSON.parse(fs.readFileSync('property_seed.json', 'utf-8'));
const address = JSON.parse(fs.readFileSync('unnormalized_address.json', 'utf-8'));
fs.mkdirSync('data', { recursive: true });
fs.writeFileSync('data/property.json', JSON.stringify({ parcel_identifier: seed.parcel_id }));
fs.writeFileSync('data/address.json', JSON.stringify({ unnormalized_address: address.full_address, county_name: address.county_jurisdiction }));
fs.writeFileSync('data/parcel.json', JSON.stringify({ parcel_identifier: seed.parcel_id }));
`;

function zip(file: string, entries: Record<string, string>) {
  const archive = new AdmZip();
  for (const [name, content] of Object.entries(entries)) {
    archive.addFile(name, Buffer.from(content));
  }
  archive.writeZip(file);
}

function entries(file: string): Map<string, string> {
  return new Map(
    new AdmZip(file)
      .getEntries()
      .map((entry) => [entry.entryName, entry.getData().toString('utf-8')])
  );
}

describe('transform --scripts-zip with seed entities in the input', () => {
  let tmp: string;

  beforeEach(async () => {
    // npm test sets a relative TMPDIR; the scripts run in a child process whose cwd is the workspace, so it must be absolute.
    vi.stubEnv('TMPDIR', path.resolve(os.tmpdir()));
    tmp = await fsPromises.mkdtemp(
      path.join(os.tmpdir(), 'transform-seed-root-')
    );
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await fsPromises.rm(tmp, { recursive: true, force: true });
  });

  it('emits the Seed data-group root beside the scripts output so hash derives the property CID', async () => {
    const inputZip = path.join(tmp, 'input.zip');
    const scriptsZip = path.join(tmp, 'scripts.zip');
    const outputZip = path.join(tmp, 'transformed.zip');
    const request = {
      method: 'GET',
      url: 'https://county.example/detail',
      multiValueQueryString: { id: ['1'] },
    };
    zip(inputZip, {
      'input.html': '<html><body>parcel 1</body></html>',
      'property_seed.json': JSON.stringify({
        parcel_id: '1',
        source_http_request: request,
        request_identifier: '1',
      }),
      'unnormalized_address.json': JSON.stringify({
        full_address: '1 Main St, Town FL 30000',
        county_jurisdiction: 'Test',
        source_http_request: request,
        request_identifier: '1',
      }),
    });
    zip(scriptsZip, {
      'ownerMapping.js': '',
      'structureMapping.js': '',
      'layoutMapping.js': '',
      'utilityMapping.js': '',
      'data_extractor.js': EXTRACTOR,
    });

    await handleTransform({
      inputZip,
      scriptsZip,
      outputZip,
      silent: true,
      cwd: tmp,
    });

    const output = entries(outputZip);
    expect(
      JSON.parse(output.get(`data/${SEED_DATAGROUP_SCHEMA_CID}.json`)!)
    ).toEqual({
      label: 'Seed',
      relationships: {
        address_has_parcel: { '/': './address_has_parcel.json' },
      },
    });
    expect(JSON.parse(output.get('data/address_has_parcel.json')!)).toEqual({
      from: { '/': './address.json' },
      to: { '/': './parcel.json' },
    });
    // The scripts' address entity is kept; only request metadata is added.
    expect(JSON.parse(output.get('data/address.json')!)).toEqual({
      unnormalized_address: '1 Main St, Town FL 30000',
      county_name: 'Test',
      source_http_request: request,
      request_identifier: '1',
    });
    expect(output.has(`data/${COUNTY_CID}.json`)).toBe(true);

    const outputCsv = path.join(tmp, 'hash.csv');
    await handleHash(
      {
        input: outputZip,
        outputZip: path.join(tmp, 'hashed.zip'),
        outputCsv,
        silent: true,
        cwd: tmp,
      },
      overrides
    );
    const rows = (await fsPromises.readFile(outputCsv, 'utf-8'))
      .trim()
      .split('\n')
      .slice(1)
      .map((line) => line.split(','));
    const seed = rows.find((row) => row[1] === SEED_DATAGROUP_SCHEMA_CID);
    expect(CID.parse(seed?.[0] ?? '').toString()).toBe(seed?.[0]);
    expect(seed?.[0]).toBe(seed?.[2]);
    expect(rows.map((row) => row[0])).toEqual(rows.map(() => seed?.[0]));
  });
});
