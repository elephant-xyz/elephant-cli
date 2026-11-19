import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fsPromises } from 'fs';
import os from 'os';
import path from 'path';
import { IPFSFetcherService } from '../../../src/services/ipfs-fetcher.service.js';
import { schemaManifestUrl } from '../../../src/config/constants.js';
import { COUNTY, EXPECTED, hash, VECTORS } from '../../helpers/packed.js';

const GATEWAY = 'https://gateway.test/ipfs';

describe('fetch-data with a packed data group', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await fsPromises.mkdtemp(
      path.join(path.resolve(os.tmpdir()), 'fetch-packed-')
    );
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await fsPromises.rm(tmp, { recursive: true, force: true });
  });

  /** Serve the linked and the packed blocks of vector 2 (optionally changed) and a manifest. */
  const serve = async (
    manifest: object,
    change: (packed: string) => string = (packed) => packed
  ) => {
    const source = path.join(VECTORS, 'vector-2', 'property');
    const linked = await hash(source, path.join(tmp, 'linked'), false);
    const packed = await hash(source, path.join(tmp, 'packed'), true);
    const blocks = new Map([...linked.blocks, ...packed.blocks]);
    const requested: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      const cid = url.slice(GATEWAY.length + 1);
      requested.push(cid);
      const bytes = blocks.get(cid);
      const text =
        url === schemaManifestUrl()
          ? JSON.stringify(manifest)
          : bytes && change(Buffer.from(bytes).toString());
      return text === undefined
        ? new Response('not found', { status: 404 })
        : new Response(text);
    });
    return requested;
  };

  /** Fetch `cid` and return every file written for it: name -> content. */
  const fetched = async (cid: string) => {
    const dir = await new IPFSFetcherService(GATEWAY).fetchData(
      cid,
      path.join(tmp, 'data')
    );
    expect(path.basename(dir)).toBe(cid);
    const files: Record<string, string> = {};
    for (const name of await fsPromises.readdir(dir)) {
      files[name] = await fsPromises.readFile(path.join(dir, name), 'utf-8');
    }
    return files;
  };

  it.each([
    ['is in the manifest', { County: { ipfsCid: COUNTY, type: 'dataGroup' } }],
    ['is not in the manifest', {}],
  ])(
    'writes the files the linked form writes when the label %s',
    async (_name, manifest) => {
      const requested = await serve(manifest);
      const linked = await fetched(EXPECTED['vector-2'].linked);
      // root, 3 relationships, property, address and 2 tax entities
      expect(Object.keys(linked)).toHaveLength(8);
      requested.length = 0;

      expect(await fetched(EXPECTED['vector-2'].packed)).toEqual(linked);
      // One request for the manifest and one for the packed block: nothing else is on the network.
      expect(requested.filter((cid) => cid.startsWith('bagu'))).toEqual([
        EXPECTED['vector-2'].packed,
      ]);
    }
  );

  it('refuses a packed block whose entity key is not the CID of its value', async () => {
    await serve({}, (packed) =>
      packed.replace('"tax_year":2023', '"tax_year":1999')
    );
    await expect(fetched(EXPECTED['vector-2'].packed)).rejects.toThrow(
      'Failed to fetch initial CID'
    );
  });
});
