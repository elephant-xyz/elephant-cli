import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fsPromises } from 'fs';
import os from 'os';
import path from 'path';
import AdmZip from 'adm-zip';
import {
  handleHash,
  HashServiceOverrides,
} from '../../../src/commands/hash.js';
import { SEED_DATAGROUP_SCHEMA_CID } from '../../../src/config/constants.js';
import { CidCalculatorService } from '../../../src/services/cid-calculator.service.js';

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

// A real PNG signature followed by bytes that are not valid UTF-8.
const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0xfe, 0x00, 0x01,
]);

const BASE: Record<string, string | Buffer> = {
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
};

const county = (relationships: Record<string, unknown>) =>
  JSON.stringify({ label: 'County', relationships });

describe('hash with linked media files', () => {
  let tmp: string;

  const run = async (bundle: Record<string, string | Buffer>) => {
    for (const [name, content] of Object.entries(bundle)) {
      await fsPromises.writeFile(path.join(tmp, 'property', name), content);
    }
    const outputZip = path.join(tmp, 'hashed.zip');
    const outputCsv = path.join(tmp, 'hash.csv');
    await handleHash(
      {
        input: path.join(tmp, 'property'),
        outputZip,
        outputCsv,
        silent: true,
        cwd: tmp,
      },
      overrides
    );
    const blocks = new AdmZip(outputZip)
      .getEntries()
      .map((entry) => [entry.entryName, entry.getData()] as const);
    return {
      blocks,
      text: blocks
        .filter(([name]) => name.endsWith('.json'))
        .map(([, body]) => body.toString('utf-8')),
      csv: await fsPromises.readFile(outputCsv, 'utf-8'),
      errors: await fsPromises.readFile(
        path.join(tmp, 'submit_errors.csv'),
        'utf-8'
      ),
    };
  };

  beforeEach(async () => {
    tmp = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'hash-media-'));
    await fsPromises.mkdir(path.join(tmp, 'property'));
  });

  afterEach(async () => {
    await fsPromises.rm(tmp, { recursive: true, force: true });
  });

  it('stamps an ipfs_url image with the raw CID of its bytes and emits no json block for it', async () => {
    const out = await run({
      ...BASE,
      [`${COUNTY_CID}.json`]: county({
        property_has_photo: { '/': './photo_link.json' },
      }),
      'photo_link.json': JSON.stringify({ ipfs_url: './photo.png' }),
      'photo.png': PNG,
    });
    const raw = await new CidCalculatorService().calculateCidV1ForRawData(PNG);
    expect(out.errors).not.toMatch(/\n.+/);
    expect(out.text).toContain(JSON.stringify({ ipfs_url: `ipfs://${raw}` }));
    // seed, address, parcel, address_has_parcel, county, photo_link
    expect(out.text).toHaveLength(6);
    expect(
      out.blocks.find(([name]) => name.endsWith('/photo.png'))?.[1]
    ).toEqual(PNG);
  });

  it('rejects a pointer link to an html file', async () => {
    const out = await run({
      ...BASE,
      [`${COUNTY_CID}.json`]: county({
        property_has_page: { '/': './page.json' },
      }),
      'page.json': JSON.stringify({ page: { '/': './index.html' } }),
      'index.html': '<html></html>',
    });
    expect(out.errors).toContain(
      'cannot link ./index.html: only JSON and image files can be linked'
    );
    expect(out.blocks.every(([name]) => name.endsWith('.json'))).toBe(true);
    expect(out.text.some((body) => body.includes('<html>'))).toBe(false);
  });

  it('leaves a string ipfs_url to an html file as-is', async () => {
    const out = await run({
      ...BASE,
      [`${COUNTY_CID}.json`]: county({
        property_has_page: { '/': './page.json' },
      }),
      'page.json': JSON.stringify({ ipfs_url: './index.html' }),
      'index.html': '<html></html>',
    });
    expect(out.errors).not.toMatch(/\n.+/);
    expect(out.text).toContain(JSON.stringify({ ipfs_url: './index.html' }));
    expect(out.blocks.every(([name]) => name.endsWith('.json'))).toBe(true);
  });

  it('writes hash-results.csv as propertyCid,dataGroupCid,dataCid,filePath,uploadedAt', async () => {
    const out = await run(BASE);
    const lines = out.csv.split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe(
      'propertyCid,dataGroupCid,dataCid,filePath,uploadedAt'
    );
    const [propertyCid, dataGroupCid, dataCid, filePath, uploadedAt, ...rest] =
      lines[1].split(',');
    expect(rest).toEqual([]);
    expect(uploadedAt).toBe('');
    expect(dataGroupCid).toBe(SEED_DATAGROUP_SCHEMA_CID);
    expect(filePath).toBe(`${SEED_DATAGROUP_SCHEMA_CID}.json`);
    expect(propertyCid).toBe(dataCid);
    expect(out.blocks.map(([name]) => name)).toContain(
      `${propertyCid}/${dataCid}.json`
    );
  });
});
