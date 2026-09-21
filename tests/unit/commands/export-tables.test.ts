import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fsPromises } from 'fs';
import os from 'os';
import path from 'path';
import { zstdDecompressSync } from 'zlib';
import { CarReader } from '@ipld/car';
import * as dagJSON from '@ipld/dag-json';
import { CID } from 'multiformats/cid';
import { importer } from 'ipfs-unixfs-importer';
import { MemoryBlockstore } from 'blockstore-core/memory';
import { parquetMetadata, parquetReadObjects } from 'hyparquet';
import {
  ExportTablesCommandOptions,
  handleExportTables,
} from '../../../src/commands/export-tables.js';
import { handleUpload } from '../../../src/commands/upload.js';
import {
  buildCountyCar,
  GROUP,
  OTHER_PROPERTY,
  PROPERTY,
  schemaCacheService,
  text,
  Tweaks,
} from '../../helpers/county-car.js';

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
  codec: string;
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
    codecs: metadata.row_groups.flatMap((group) =>
      group.columns.map((column) => column.meta_data?.codec)
    ),
    rows: await parquetReadObjects({
      file: buffer,
      compressors: { ZSTD: (input) => zstdDecompressSync(input) },
    }),
  };
}

/** Every fixture directory made in a test; removed after it. */
const made: string[] = [];

/** A fresh temp directory with a county CAR and an export runner bound to it. */
async function fixture(tweaks: Tweaks = {}) {
  const tmp = await fsPromises.mkdtemp(
    path.join(path.resolve(os.tmpdir()), 'export-tables-')
  );
  made.push(tmp);
  const car = path.join(tmp, 'county.car');
  const built = await buildCountyCar(car, tweaks);
  const run = (
    output: string,
    partSize?: string,
    extra: Partial<ExportTablesCommandOptions> = {}
  ) =>
    handleExportTables(
      { input: car, output, partSize, silent: true, cwd: tmp, ...extra },
      { schemaCacheService }
    );
  return { tmp, car, run, ...built };
}

describe('export-tables <county.car>', () => {
  afterEach(async () => {
    vi.unstubAllGlobals();
    await Promise.all(
      made
        .splice(0)
        .map((dir) => fsPromises.rm(dir, { recursive: true, force: true }))
    );
  });

  it('writes one table per class, relationship type and the index, rooted at a CountyTables block with UnixFS part links', async () => {
    const { tmp, run, root, entities } = await fixture();
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
      codec: 'zstd',
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
    expect(new Set(property.codecs)).toEqual(new Set(['ZSTD']));
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
    const { tmp, run } = await fixture();
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
    const { tmp, run } = await fixture();
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

  it('fails before writing a row when two class schemas share a title with other columns', async () => {
    const { tmp, run } = await fixture({ twin: true });

    await expect(run(path.join(tmp, 'tables'))).rejects.toThrow(
      `table property has two schemas in this car: ${PROPERTY} and ${OTHER_PROPERTY}`
    );
  });

  it('writes a new Atlas page keyed by the non-seed data group with the county root, schema and tables root', async () => {
    const { tmp, run, root } = await fixture({ seed: true });
    const page = path.join(tmp, 'counties', 'FL', 'lee.json');
    const result = await run(path.join(tmp, 'tables'), undefined, {
      atlasPage: page,
      county: 'lee',
      state: 'FL',
      fips: '12071',
    });

    expect(result.atlas).toEqual({ page, group: 'county' });
    const expected = {
      county: 'lee',
      state: 'FL',
      fips: '12071',
      groups: {
        county: {
          cid: root.toString(),
          schema: GROUP,
          tables: result.root,
        },
      },
    };
    expect(await fsPromises.readFile(page, 'utf-8')).toBe(
      `${JSON.stringify(expected, null, 2)}\n`
    );
  });

  it('updates an existing Atlas page, keeping its other groups with keys sorted', async () => {
    const { tmp, run, root } = await fixture();
    const page = path.join(tmp, 'lee.json');
    const zoning = {
      cid: 'bafyzoning',
      schema: 'bafyschema',
      tables: 'bafytables',
    };
    await fsPromises.writeFile(
      page,
      JSON.stringify({
        county: 'lee',
        state: 'FL',
        fips: '12071',
        groups: { zoning },
      })
    );
    const result = await run(path.join(tmp, 'tables'), undefined, {
      atlasPage: page,
      fips: '12071',
    });

    const written = JSON.parse(await fsPromises.readFile(page, 'utf-8'));
    expect(Object.keys(written.groups)).toEqual(['county', 'zoning']);
    expect(written).toEqual({
      county: 'lee',
      state: 'FL',
      fips: '12071',
      groups: {
        county: { cid: root.toString(), schema: GROUP, tables: result.root },
        zoning,
      },
    });
  });

  it('fails when the county metadata does not match the Atlas page, or is missing for a new one', async () => {
    const { tmp, run } = await fixture();
    const page = path.join(tmp, 'lee.json');
    await fsPromises.writeFile(
      page,
      JSON.stringify({ county: 'lee', state: 'FL', fips: '12071', groups: {} })
    );
    await expect(
      run(path.join(tmp, 'tables'), undefined, {
        atlasPage: page,
        county: 'collier',
      })
    ).rejects.toThrow('--county collier does not match county "lee"');
    await expect(
      run(path.join(tmp, 'tables'), undefined, {
        atlasPage: path.join(tmp, 'new.json'),
        county: 'collier',
        state: 'FL',
      })
    ).rejects.toThrow('--fips is required to create');
    await expect(fsPromises.stat(path.join(tmp, 'new.json'))).rejects.toThrow();
  });

  it('fails an Atlas page for an archive with two non-seed data groups before writing a row', async () => {
    const { tmp, run } = await fixture({ twin: true, seed: true });
    const out = path.join(tmp, 'tables');
    await expect(
      run(out, undefined, {
        atlasPage: path.join(tmp, 'lee.json'),
        county: 'lee',
        state: 'FL',
        fips: '12071',
      })
    ).rejects.toThrow(
      'archive carries 2 data groups; Atlas registers one group per archive'
    );
    await expect(fsPromises.readdir(out)).resolves.toEqual([]);
  });

  it('exports an index with zero properties as a valid empty tables.car', async () => {
    const { tmp, run, root } = await fixture({ empty: true });
    const out = path.join(tmp, 'none');

    const result = await run(out);

    expect(result).toMatchObject({ countyRoot: root.toString(), parts: 0 });
    const { index } = await tablesRoot(out);
    expect(index).toMatchObject({ label: 'CountyTables', tables: {} });
    expect(index.county_root.toString()).toBe(root.toString());
  });

  it('upload <dir> adds every part, imports tables.car and reads the root and one part back', async () => {
    const { tmp, run, root } = await fixture();
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
      'http://127.0.0.1:5001/api/v0/add?pin=true&cid-version=1&raw-leaves=true&chunker=size-262144'
    );
    expect(adds[0][1]?.headers).toEqual({ Authorization: 'Bearer t' });
    expect((adds[0][1]?.body as FormData).get('file')).toBeInstanceOf(Blob);
    expect(fetchMock.mock.calls.map(([url]) => url)).toContain(
      `http://127.0.0.1:8080/ipfs/${result.root}/tables/${Object.keys(index.tables)[0]}/parts/0/cid`
    );

    const other = (await text('someone else')).cid;
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

  it('upload <dir> measures the whole part when the range probe has no Content-Range total, and rejects a part whose size differs from the index before any add', async () => {
    const { tmp, run } = await fixture();
    const out = path.join(tmp, 'tables');
    const result = await run(out);
    const { root: tables, index } = await tablesRoot(out);
    const head = (await CarReader.fromBytes(
      await fsPromises.readFile(path.join(out, 'tables.car'))
    ).then((reader) => reader.get(tables)))!.bytes;
    const [name, first] = Object.entries(index.tables)[0];
    const part = await fsPromises.readFile(
      path.join(out, name, 'part-00000.parquet')
    );
    const expected = Object.values(index.tables).map((table) => table.parts[0]);
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/api/v0/add')) {
        const next = expected.shift()!;
        return {
          ok: true,
          status: 200,
          text: async () => `{"Hash":"${next.cid}"}\n`,
        };
      }
      if (url.includes('/api/v0/dag/import')) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            `{"Root":{"Cid":{"/":"${tables}"},"PinErrorMsg":""}}\n`,
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
      // The probe answers 200 with one byte and no Content-Range; the plain fetch answers the file.
      const probe = (init?.headers as Record<string, string>)?.Range;
      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        body: { cancel: async () => undefined },
        arrayBuffer: async () =>
          probe
            ? new Uint8Array([part[0]]).buffer
            : part.buffer.slice(
                part.byteOffset,
                part.byteOffset + part.byteLength
              ),
      };
    });
    vi.stubGlobal('fetch', fetchMock);

    const uploaded = await handleUpload({
      input: out,
      api: 'http://127.0.0.1:5001',
      silent: true,
      timeout: 30,
    });

    expect(uploaded).toMatchObject({ success: true, root: result.root });
    const reads = fetchMock.mock.calls.filter(([url]) =>
      url.includes(`/tables/${name}/parts/0/cid`)
    );
    expect(reads.map(([, init]) => init?.headers)).toEqual([
      { Range: 'bytes=0-0' },
      undefined,
    ]);

    await fsPromises.appendFile(
      path.join(out, name, 'part-00000.parquet'),
      'x'
    );
    fetchMock.mockClear();
    const failed = await handleUpload({
      input: out,
      api: 'http://127.0.0.1:5001',
      silent: true,
      timeout: 30,
    });
    expect(failed.error).toContain(`is ${first.parts[0].bytes + 1} bytes but`);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
