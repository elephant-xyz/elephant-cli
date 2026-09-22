import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fsPromises } from 'fs';
import os from 'os';
import path from 'path';
import AdmZip from 'adm-zip';
import {
  handleHash,
  HashServiceOverrides,
} from '../../../src/commands/hash.js';
import { SEED_DATAGROUP_SCHEMA_CID } from '../../../src/config/constants.js';

const COUNTY_CID = 'bafkreicountyschemacidfortestsonlyxxxxxxxxxxxxxxxxxxxxxxxx';

vi.mock('../../../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    success: vi.fn(),
    technical: vi.fn(),
  },
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

// Bundles produced before fact sheets were removed still carry fact_sheet.json,
// *_has_fact_sheet links and the rendered HTML next to the data.
const BUNDLE: Record<string, string> = {
  [`${SEED_DATAGROUP_SCHEMA_CID}.json`]: JSON.stringify({
    label: 'Seed',
    relationships: {
      address_has_parcel: { '/': './address_has_parcel.json' },
    },
  }),
  'address.json': JSON.stringify({ unnormalized_address: '1 Main St' }),
  'parcel.json': JSON.stringify({ parcel_identifier: '1' }),
  'address_has_parcel.json': JSON.stringify({
    from: { '/': './address.json' },
    to: { '/': './parcel.json' },
  }),
  [`${COUNTY_CID}.json`]: JSON.stringify({
    label: 'County',
    relationships: {
      address_has_fact_sheet: [
        { '/': './relationship_address_to_fact_sheet.json' },
      ],
    },
  }),
  'relationship_address_to_fact_sheet.json': JSON.stringify({
    from: { '/': './address.json' },
    to: { '/': './fact_sheet.json' },
  }),
  'fact_sheet.json': JSON.stringify({
    ipfs_url: './index.html',
    full_generation_command: null,
  }),
  'index.html': '<html></html>',
};

describe('hash on a bundle that still contains a fact sheet', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'hash-fact-sheet-'));
    await fsPromises.mkdir(path.join(tmp, 'property'));
    for (const [name, content] of Object.entries(BUNDLE)) {
      await fsPromises.writeFile(path.join(tmp, 'property', name), content);
    }
  });

  afterEach(async () => {
    await fsPromises.rm(tmp, { recursive: true, force: true });
  });

  it('hashes fact_sheet.json as an ordinary JSON block and leaves ipfs_url alone', async () => {
    const outputZip = path.join(tmp, 'hashed.zip');
    await handleHash(
      {
        input: path.join(tmp, 'property'),
        outputZip,
        outputCsv: path.join(tmp, 'hash.csv'),
        silent: true,
        cwd: tmp,
      },
      overrides
    );

    const blocks = new AdmZip(outputZip)
      .getEntries()
      .map((entry) => [entry.entryName, entry.getData().toString('utf-8')]);
    const sheet = blocks.find(([, body]) => body.includes('index.html'));
    expect(JSON.parse(sheet?.[1] ?? '{}')).toEqual({
      full_generation_command: null,
      ipfs_url: './index.html',
    });
    expect(blocks.every(([name]) => name.endsWith('.json'))).toBe(true);
    expect(
      await fsPromises.readFile(path.join(tmp, 'submit_errors.csv'), 'utf-8')
    ).not.toMatch(/\n.+/);
  });
});
