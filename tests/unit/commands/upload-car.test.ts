import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { promises as fsPromises } from 'fs';
import os from 'os';
import path from 'path';
import AdmZip from 'adm-zip';
import { CarReader, CarWriter } from '@ipld/car';
import { CID } from 'multiformats/cid';
import { sha256 } from 'multiformats/hashes/sha2';
import { handleUpload } from '../../../src/commands/upload.js';
import { CarOutputService } from '../../../src/services/car-output.service.js';
import { ZipExtractorService } from '../../../src/services/zip-extractor.service.js';
import { PinataDirectoryUploadService } from '../../../src/services/pinata-directory-upload.service.js';
import { SimpleProgress } from '../../../src/utils/simple-progress.js';

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

const property =
  'baguqeeraefi3cy4z3j2xvnuta73mktlysxlkqsflbtrpwxsvvxfwbqs6qyra';

const ndjson = (root: string, pinError = '') =>
  `{"Root":{"Cid":{"/":"${root}"},"PinErrorMsg":"${pinError}"}}\n{"Stats":{"BlockCount":2,"BlockBytesCount":300}}\n`;

describe('upload with a .car input', () => {
  let tmp: string;
  let car: string;
  let root: string;
  let bytes: Uint8Array;
  const fetchMock = vi.fn();

  /** `dag/import` answers `imported`; the gateway answers `served` in order. */
  const serve = (imported: object, ...served: object[]) =>
    fetchMock.mockImplementation(async (url: string) =>
      url.includes('/api/v0/dag/import')
        ? imported
        : (served.shift() ?? {
            ok: true,
            arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset),
          })
    );

  beforeEach(async () => {
    tmp = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'upload-car-'));
    car = path.join(tmp, 'county.car');
    const service = new CarOutputService(car);
    await service.open();
    await service.property(property, { schema: property });
    root = (await service.close()).root;
    const reader = await CarReader.fromBytes(await fsPromises.readFile(car));
    bytes = (await reader.get((await reader.getRoots())[0]))!.bytes;

    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    serve({ ok: true, status: 200, text: async () => ndjson(root) });
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    await fsPromises.rm(tmp, { recursive: true, force: true });
  });

  const options = () => ({
    input: car,
    api: 'https://rpc.filebase.io/',
    token: 'secret-token',
    silent: true,
    timeout: 30,
  });

  it('posts the car to dag/import, polls the gateway, verifies the digest and reports root and blocks', async () => {
    serve(
      { ok: true, status: 200, text: async () => ndjson(root) },
      { ok: false, status: 504 }
    );

    const result = await handleUpload(options());

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      'https://rpc.filebase.io/api/v0/dag/import?pin-roots=true&stats=true'
    );
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ Authorization: 'Bearer secret-token' });
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).get('file')).toBeInstanceOf(Blob);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock).toHaveBeenLastCalledWith(
      `https://ipfs.filebase.io/ipfs/${root}?format=raw`,
      { signal: expect.any(AbortSignal) }
    );
    expect(result).toMatchObject({
      success: true,
      cid: root,
      api: 'https://rpc.filebase.io',
      root,
      blocks: 2,
      gatewayUrl: `https://ipfs.filebase.io/ipfs/${root}`,
    });
  });

  it('fails when the imported root differs from the car root', async () => {
    serve({ ok: true, status: 200, text: async () => ndjson(property) });

    const result = await handleUpload(options());

    expect(result.error).toContain(`reported root ${property}`);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('fails when pinning the root failed', async () => {
    serve({
      ok: true,
      status: 200,
      text: async () => ndjson(root, 'pin failed'),
    });

    const result = await handleUpload(options());

    expect(result.error).toContain(`Pinning ${root} failed: pin failed`);
  });

  it('composes the filebase token from the env when --token is absent', async () => {
    vi.stubEnv('FILEBASE_ACCESS_KEY', 'ak');
    vi.stubEnv('FILEBASE_SECRET_KEY', 'sk');
    vi.stubEnv('FILEBASE_BUCKET', 'bucket');

    const result = await handleUpload({ ...options(), token: undefined });

    expect(fetchMock.mock.calls[0][1].headers).toEqual({
      Authorization: `Bearer ${Buffer.from('ak:sk:bucket').toString('base64')}`,
    });
    expect(result.success).toBe(true);
  });

  it('fails when the gateway bytes do not hash to the root', async () => {
    serve(
      { ok: true, status: 200, text: async () => ndjson(root) },
      {
        ok: true,
        arrayBuffer: async () => new TextEncoder().encode('x').buffer,
      }
    );

    const result = await handleUpload(options());

    expect(result.error).toContain('not the root');
  });

  it('verifies a cidv0 root against the gateway bytes', async () => {
    const block = new TextEncoder().encode('\x0a\x02\x08\x01');
    const cid = CID.createV0(await sha256.digest(block));
    const { writer, out } = CarWriter.create([cid]);
    const done = Array.fromAsync(out);
    await writer.put({ cid, bytes: block });
    await writer.close();
    await fsPromises.writeFile(car, Buffer.concat(await done));
    serve(
      { ok: true, status: 200, text: async () => ndjson(cid.toString()) },
      { ok: true, arrayBuffer: async () => block.buffer }
    );

    const result = await handleUpload(options());

    expect(result).toMatchObject({ success: true, root: cid.toString() });
  });

  it('reports the raw body when dag/import does not answer ndjson', async () => {
    serve({ ok: true, status: 200, text: async () => '<html>nope</html>' });

    const result = await handleUpload(options());

    expect(result.error).toContain('expected one; response: <html>nope</html>');
  });

  it('rejects an --api without a scheme and a --timeout that is not seconds', async () => {
    expect(
      (await handleUpload({ ...options(), api: 'rpc.filebase.io' })).error
    ).toBe('--api must be a URL with a scheme, got rpc.filebase.io');
    expect(
      (await handleUpload({ ...options(), timeout: '5m' })).error
    ).toContain('got 5m');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([0, 2])('rejects a car with %i roots', async (count) => {
    const cid = CID.parse(property);
    const { writer, out } = CarWriter.create(Array(count).fill(cid));
    const done = Array.fromAsync(out);
    await writer.put({ cid, bytes: new Uint8Array([1]) });
    await writer.close();
    await fsPromises.writeFile(car, Buffer.concat(await done));

    const result = await handleUpload(options());

    expect(result.error).toContain(
      `Expected one root in ${car}, found ${count}`
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('still sends a zip input to pinata', async () => {
    const dir = path.join(tmp, 'bafybeiabc123');
    await fsPromises.mkdir(dir);
    await fsPromises.writeFile(
      path.join(dir, 'bafkreihash1.json'),
      JSON.stringify({ label: 'Test', relationships: [] })
    );
    const zip = path.join(tmp, 'hashed.zip');
    const archive = new AdmZip();
    archive.addLocalFolder(dir, 'bafybeiabc123');
    archive.writeZip(zip);
    const pinata = {
      uploadDirectory: vi.fn().mockResolvedValue({ success: true, cid: 'Qm1' }),
    } as unknown as PinataDirectoryUploadService;

    const result = await handleUpload(
      { input: zip, pinataJwt: 'jwt', silent: true },
      {
        zipExtractorService: new ZipExtractorService(),
        pinataDirectoryUploadService: pinata,
        progressTracker: {
          start: vi.fn(),
          stop: vi.fn(),
          increment: vi.fn(),
        } as unknown as SimpleProgress,
      }
    );

    expect(pinata.uploadDirectory).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({ success: true, cid: 'Qm1' });
  });
});
