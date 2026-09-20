import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { promises as fsPromises } from 'fs';
import os from 'os';
import path from 'path';
import AdmZip from 'adm-zip';
import { CarReader, CarWriter } from '@ipld/car';
import { CID } from 'multiformats/cid';
import { handleUpload } from '../../../src/commands/upload.js';
import { CarOutputService } from '../../../src/services/car-output.service.js';
import { ZipExtractorService } from '../../../src/services/zip-extractor.service.js';
import { PinataDirectoryUploadService } from '../../../src/services/pinata-directory-upload.service.js';
import { SimpleProgress } from '../../../src/utils/simple-progress.js';

const send = vi.fn();

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class {
    send = send;
  },
  PutObjectCommand: class {
    constructor(readonly input: Record<string, unknown>) {}
  },
  HeadObjectCommand: class {
    constructor(readonly input: Record<string, unknown>) {}
  },
}));

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

type Command = {
  constructor: { name: string };
  input: { Body?: AsyncIterable<Uint8Array> };
};

/** Like the SDK: a PUT drains its body before resolving; a HEAD answers `reply`. */
const head = (reply: object) => async (command: Command) =>
  command.constructor.name === 'HeadObjectCommand'
    ? reply
    : Array.fromAsync(command.input.Body!).then(() => ({}));

const property =
  'baguqeeraefi3cy4z3j2xvnuta73mktlysxlkqsflbtrpwxsvvxfwbqs6qyra';

describe('upload with a .car input', () => {
  let tmp: string;
  let car: string;
  let root: string;
  let bytes: Uint8Array;
  const fetchMock = vi.fn();

  beforeEach(async () => {
    tmp = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'upload-car-'));
    car = path.join(tmp, 'county.car');
    const service = new CarOutputService(car);
    await service.open();
    await service.property(property, { schema: property });
    root = (await service.close()).root;
    const reader = await CarReader.fromBytes(await fsPromises.readFile(car));
    bytes = (await reader.get((await reader.getRoots())[0]))!.bytes;

    send.mockReset();
    send.mockImplementation(head({ Metadata: { cid: root } }));
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await fsPromises.rm(tmp, { recursive: true, force: true });
  });

  const options = () => ({
    input: car,
    bucket: 'scratch',
    key: 'cli-upload-test/county.car',
    filebaseAccessKey: 'ak',
    filebaseSecretKey: 'sk',
    silent: true,
    timeout: 30,
  });

  it('puts with import=car, checks the head cid, polls the gateway, verifies the digest and reports the root', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 504 })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset),
      });

    const result = await handleUpload(options());

    const commands = send.mock.calls.map((call) => call[0]);
    expect(commands.map((c) => c.constructor.name)).toEqual([
      'PutObjectCommand',
      'HeadObjectCommand',
    ]);
    expect(commands[0].input).toMatchObject({
      Bucket: 'scratch',
      Key: 'cli-upload-test/county.car',
      Metadata: { import: 'car' },
    });
    expect(commands[1].input).toMatchObject({
      Bucket: 'scratch',
      Key: 'cli-upload-test/county.car',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenLastCalledWith(
      `https://ipfs.filebase.io/ipfs/${root}?format=raw`,
      { signal: expect.any(AbortSignal) }
    );
    expect(result).toMatchObject({
      success: true,
      cid: root,
      objectCid: root,
      root,
      gatewayUrl: `https://ipfs.filebase.io/ipfs/${root}`,
    });
  });

  it('fails when the head cid differs from the car root', async () => {
    send.mockImplementation(head({ Metadata: { cid: property } }));

    const result = await handleUpload(options());

    expect(result).toMatchObject({ success: false });
    expect(result.error).toContain(`object CID ${property}`);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails when the gateway bytes do not hash to the root', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: async () =>
        new TextEncoder().encode('{"tampered":1}').buffer,
    });

    const result = await handleUpload(options());

    expect(result).toMatchObject({ success: false });
    expect(result.error).toContain('not the root');
  });

  it('names the missing filebase settings', async () => {
    const result = await handleUpload({ input: car, silent: true });

    expect(result.error).toContain('bucket, access key, secret key');
    expect(send).not.toHaveBeenCalled();
  });

  it('waits for the head cid to appear', async () => {
    send
      .mockImplementationOnce(head({}))
      .mockImplementationOnce(head({}))
      .mockImplementationOnce(head({ Metadata: { cid: root } }));
    fetchMock.mockResolvedValue({
      ok: true,
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset),
    });

    const result = await handleUpload(options());

    expect(send).toHaveBeenCalledTimes(3);
    expect(result).toMatchObject({ success: true, objectCid: root });
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
    expect(send).not.toHaveBeenCalled();
  });

  it('times out naming the last error', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNRESET'));

    const result = await handleUpload({ ...options(), timeout: 0.001 });

    expect(result.error).toMatch(/Timed out waiting for .*: ECONNRESET/);
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
    expect(send).not.toHaveBeenCalled();
    expect(result).toMatchObject({ success: true, cid: 'Qm1' });
  });
});
