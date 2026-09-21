import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fsPromises } from 'fs';
import os from 'os';
import path from 'path';
import { CarReader, CarWriter } from '@ipld/car';
import * as dagJSON from '@ipld/dag-json';
import * as raw from 'multiformats/codecs/raw';
import { CID } from 'multiformats/cid';
import { sha256 } from 'multiformats/hashes/sha2';
import { importer } from 'ipfs-unixfs-importer';
import { MemoryBlockstore } from 'blockstore-core/memory';
import { parquetMetadata, parquetReadObjects } from 'hyparquet';
import { handleExportTables } from '../../../src/commands/export-tables.js';
import { handleUpload } from '../../../src/commands/upload.js';
import { SchemaCacheService } from '../../../src/services/schema-cache.service.js';

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

async function text(value: string): Promise<CID> {
  return CID.create(
    1,
    raw.code,
    await sha256.digest(new TextEncoder().encode(value))
  );
}

const GROUP = (await text('county data group schema')).toString();
const LINK = (await text('property_to_address schema')).toString();
const PROPERTY = (await text('property class schema')).toString();
const ADDRESS = (await text('address class schema')).toString();

const SCHEMAS: Record<string, object> = {
  [GROUP]: {
    type: 'object',
    title: 'County',
    properties: {
      label: { type: 'string' },
      relationships: {
        type: 'object',
        properties: {
          property_has_address: {
            type: ['array', 'null'],
            items: { type: 'string', cid: LINK },
          },
        },
      },
    },
  },
  [LINK]: {
    type: 'object',
    title: 'property_to_address',
    properties: {
      from: { type: 'string', cid: PROPERTY },
      to: { type: 'string', cid: ADDRESS },
    },
  },
  [PROPERTY]: {
    type: 'object',
    title: 'property',
    properties: {
      parcel_identifier: { type: 'string' },
      units: { type: ['integer', 'null'] },
      area: { type: 'number' },
      historic: { type: 'boolean' },
      source_http_request: { type: 'object' },
      request_identifier: { type: 'string' },
    },
  },
  [ADDRESS]: {
    type: 'object',
    title: 'Address',
    properties: {
      city: { type: 'string' },
      request_identifier: { type: 'string' },
    },
  },
};

const schemaCacheService = {
  get: async (cid: string) => SCHEMAS[cid],
} as unknown as SchemaCacheService;

/** Two properties; each links one property entity to one address entity. */
async function build(file: string): Promise<{ root: CID; entities: CID[] }> {
  const blocks: Block[] = [];
  const entries: { property_cid: CID; data_groups: Record<string, CID> }[] = [];
  const entities: CID[] = [];
  for (const [index, suffix] of ['a', 'b'].entries()) {
    const property = await json({
      parcel_identifier: `parcel-${suffix}`,
      units: index === 0 ? 3 : null,
      area: 12.5 + index,
      historic: index === 1,
      source_http_request: { method: 'GET', url: `https://x/${suffix}` },
      request_identifier: `req-${suffix}`,
    });
    const address = await json({
      city: `City ${suffix}`,
      request_identifier: `req-${suffix}`,
    });
    const link = await json({ from: property.cid, to: address.cid });
    const root = await json({
      label: 'County',
      relationships: { property_has_address: [link.cid] },
    });
    blocks.push(root, link, property, address);
    entities.push(property.cid, address.cid);
    entries.push({
      property_cid: root.cid,
      data_groups: { [GROUP]: root.cid },
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
  return { root: index.cid, entities };
}

async function unixfs(file: string): Promise<string> {
  const store = new MemoryBlockstore();
  const content = await fsPromises.readFile(file);
  for await (const entry of importer([{ content }], store, {
    cidVersion: 1,
    rawLeaves: true,
  })) {
    return entry.cid.toString();
  }
  throw new Error('no cid');
}

interface Tables {
  label: string;
  version: number;
  county_root: CID;
  part_size_bytes: number;
  tables: Record<
    string,
    { rows: number; parts: { cid: CID; rows: number; bytes: number }[] }
  >;
}

async function tablesRoot(dir: string): Promise<{ root: CID; index: Tables }> {
  const reader = await CarReader.fromBytes(
    await fsPromises.readFile(path.join(dir, 'tables.car'))
  );
  const [root] = await reader.getRoots();
  return {
    root,
    index: dagJSON.decode((await reader.get(root))!.bytes) as Tables,
  };
}

async function part(dir: string, table: string, index = 0) {
  const file = path.join(
    dir,
    table,
    `part-${String(index).padStart(5, '0')}.parquet`
  );
  const bytes = await fsPromises.readFile(file);
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  );
  const metadata = parquetMetadata(buffer);
  return {
    file,
    bytes,
    columns: metadata.schema.slice(1).map((element) => element.name),
    meta: Object.fromEntries(
      (metadata.key_value_metadata ?? []).map((item) => [item.key, item.value])
    ),
    rows: await parquetReadObjects({ file: buffer }),
  };
}

describe('export-tables <county.car>', () => {
  let tmp: string;
  let car: string;
  let root: CID;
  let entities: CID[];

  const run = (output: string, partSize?: string) =>
    handleExportTables(
      { input: car, output, partSize, silent: true, cwd: tmp },
      { schemaCacheService }
    );

  beforeEach(async () => {
    tmp = await fsPromises.mkdtemp(
      path.join(path.resolve(os.tmpdir()), 'export-tables-')
    );
    car = path.join(tmp, 'county.car');
    ({ root, entities } = await build(car));
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await fsPromises.rm(tmp, { recursive: true, force: true });
  });

  it('writes one table per class, relationship type and the index, rooted at a CountyTables block with UnixFS part links', async () => {
    const out = path.join(tmp, 'tables');
    const result = await run(out);

    expect(result).toMatchObject({
      countyRoot: root.toString(),
      partSizeBytes: 1 << 30,
      parts: 4,
      tables: {
        properties: { rows: 2, parts: 1 },
        property_has_address: { rows: 2, parts: 1 },
        property: { rows: 2, parts: 1 },
        address: { rows: 2, parts: 1 },
      },
    });
    const { root: tables, index } = await tablesRoot(out);
    expect(tables.toString()).toBe(result.root);
    expect(index).toMatchObject({
      label: 'CountyTables',
      version: 1,
      part_size_bytes: 1 << 30,
    });
    expect(index.county_root.toString()).toBe(root.toString());
    for (const [name, table] of Object.entries(index.tables)) {
      const file = path.join(out, name, 'part-00000.parquet');
      expect(table.parts[0].cid.toString()).toBe(await unixfs(file));
      expect(table.parts[0].bytes).toBe((await fsPromises.stat(file)).size);
      expect(table.parts[0].rows).toBe(2);
    }

    const property = await part(out, 'property');
    expect(property.columns).toEqual([
      'parcel_identifier',
      'units',
      'area',
      'historic',
      'source_http_request',
      'request_identifier',
      'cid',
      'property_cid',
      'data_group_cid',
    ]);
    expect(property.rows[0]).toMatchObject({
      parcel_identifier: 'parcel-a',
      units: 3n,
      area: 12.5,
      historic: false,
      source_http_request: '{"method":"GET","url":"https://x/a"}',
      request_identifier: 'req-a',
      cid: entities[0].toString(),
      data_group_cid: GROUP,
    });
    expect(property.rows[1]).toMatchObject({ units: null, historic: true });
    expect(property.meta).toEqual({
      'elephant.county_root': root.toString(),
      'elephant.manifest_url': 'https://lexicon.elephant.xyz/api/manifest',
      'elephant.part_size_bytes': String(1 << 30),
      'elephant.table': 'property',
      'elephant.part': '0',
    });

    const address = await part(out, 'address');
    expect(address.columns).toEqual([
      'city',
      'request_identifier',
      'cid',
      'property_cid',
      'data_group_cid',
    ]);
    expect(address.rows.map((row) => row.cid)).toEqual([
      entities[1].toString(),
      entities[3].toString(),
    ]);

    const link = await part(out, 'property_has_address');
    expect(link.columns).toEqual([
      'relationship_cid',
      'from_cid',
      'to_cid',
      'property_cid',
      'data_group_cid',
    ]);
    expect(link.rows[0]).toMatchObject({
      from_cid: entities[0].toString(),
      to_cid: entities[1].toString(),
    });

    const properties = await part(out, 'properties');
    expect(properties.columns).toEqual(['property_cid', GROUP]);
    expect(properties.rows[0].property_cid).toBe(properties.rows[0][GROUP]);
  });

  it('yields byte-identical parts and the same root when run twice', async () => {
    const first = await run(path.join(tmp, 'one'));
    const second = await run(path.join(tmp, 'two'));

    expect(second.root).toBe(first.root);
    for (const name of Object.keys(first.tables)) {
      const a = await part(path.join(tmp, 'one'), name);
      const b = await part(path.join(tmp, 'two'), name);
      expect(Buffer.compare(a.bytes, b.bytes)).toBe(0);
    }
  });

  it('splits a table into parts when the cap is small', async () => {
    const out = path.join(tmp, 'small');
    const result = await run(out, '300');

    expect(result.tables.property).toEqual({ rows: 2, parts: 2 });
    const { index } = await tablesRoot(out);
    expect(index.part_size_bytes).toBe(300);
    expect(index.tables.property.parts.map((item) => item.rows)).toEqual([
      1, 1,
    ]);
    expect((await part(out, 'property', 1)).rows).toHaveLength(1);
    expect((await part(out, 'property', 1)).meta['elephant.part']).toBe('1');
  });

  it('upload <dir> adds every part, imports tables.car and reads the root and one part back', async () => {
    const out = path.join(tmp, 'tables');
    const result = await run(out);
    const { root: tables, index } = await tablesRoot(out);
    const head = (await CarReader.fromBytes(
      await fsPromises.readFile(path.join(out, 'tables.car'))
    ).then((reader) => reader.get(tables)))!.bytes;
    const expected = Object.values(index.tables).map((table) => table.parts[0]);
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/api/v0/add')) {
        const next = expected.shift()!;
        return {
          ok: true,
          status: 200,
          text: async () =>
            `{"Name":"part-00000.parquet","Hash":"${next.cid}","Size":"${next.bytes}"}\n`,
        };
      }
      if (url.includes('/api/v0/dag/import')) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            `{"Root":{"Cid":{"/":"${tables}"},"PinErrorMsg":""}}\n{"Stats":{"BlockCount":1}}\n`,
        };
      }
      if (url.endsWith('?format=raw')) {
        return {
          ok: true,
          arrayBuffer: async () =>
            head.buffer.slice(
              head.byteOffset,
              head.byteOffset + head.byteLength
            ),
        };
      }
      expect(init?.headers).toEqual({ Range: 'bytes=0-0' });
      const first = Object.values(index.tables)[0].parts[0];
      return {
        ok: true,
        status: 206,
        headers: new Headers({ 'content-range': `bytes 0-0/${first.bytes}` }),
        body: { cancel: async () => undefined },
      };
    });
    vi.stubGlobal('fetch', fetchMock);

    const uploaded = await handleUpload({
      input: out,
      api: 'http://127.0.0.1:5001',
      token: 't',
      silent: true,
      timeout: 30,
    });

    expect(uploaded).toMatchObject({
      success: true,
      cid: result.root,
      root: result.root,
      countyRoot: root.toString(),
      parts: 4,
      gatewayUrl: `http://127.0.0.1:8080/ipfs/${result.root}`,
    });
    const adds = fetchMock.mock.calls.filter(([url]) =>
      url.includes('/api/v0/add')
    );
    expect(adds).toHaveLength(4);
    expect(adds[0][0]).toBe(
      'http://127.0.0.1:5001/api/v0/add?pin=true&cid-version=1&raw-leaves=true'
    );
    expect(adds[0][1]?.headers).toEqual({ Authorization: 'Bearer t' });
    expect((adds[0][1]?.body as FormData).get('file')).toBeInstanceOf(Blob);
    expect(fetchMock.mock.calls.map(([url]) => url)).toContain(
      `http://127.0.0.1:8080/ipfs/${result.root}/tables/${Object.keys(index.tables)[0]}/parts/0/cid`
    );

    const other = await text('someone else');
    fetchMock.mockImplementationOnce(async () => ({
      ok: true,
      status: 200,
      text: async () => `{"Hash":"${other}"}\n`,
    }));
    const failed = await handleUpload({
      input: out,
      api: 'http://127.0.0.1:5001',
      silent: true,
      timeout: 30,
    });
    expect(failed.error).toContain(`add returned ${other}`);
    expect(failed.error).toContain('but the index records');
  });
});
