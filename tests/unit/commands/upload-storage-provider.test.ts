import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { promises as fsPromises } from 'fs';
import path from 'path';
import os from 'os';
import AdmZip from 'adm-zip';
import {
  handleUpload,
  createStorageProvider,
  UploadCommandOptions,
} from '../../../src/commands/upload.js';
import { ZipExtractorService } from '../../../src/services/zip-extractor.service.js';
import { PinataDirectoryUploadService } from '../../../src/services/pinata-directory-upload.service.js';
import { S3CompatibleStorageProvider } from '../../../src/services/s3-compatible-storage.service.js';
import { SimpleProgress } from '../../../src/utils/simple-progress.js';
import type { StorageProvider } from '../../../src/services/storage-provider.interface.js';

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

describe('createStorageProvider', () => {
  it('creates PinataDirectoryUploadService when storage is "pinata"', () => {
    const options: UploadCommandOptions = {
      input: 'test.zip',
      storage: 'pinata',
      pinataJwt: 'test-jwt',
    };
    const provider = createStorageProvider(options);
    expect(provider).toBeInstanceOf(PinataDirectoryUploadService);
  });

  it('throws when storage is "pinata" but no JWT provided', () => {
    const options: UploadCommandOptions = {
      input: 'test.zip',
      storage: 'pinata',
    };
    expect(() => createStorageProvider(options)).toThrow(
      'Pinata JWT is required'
    );
  });

  it('creates S3CompatibleStorageProvider when storage is "s3"', () => {
    const options: UploadCommandOptions = {
      input: 'test.zip',
      storage: 's3',
      s3AccessKeyId: 'key',
      s3SecretAccessKey: 'secret',
      s3Bucket: 'bucket',
    };
    const provider = createStorageProvider(options);
    expect(provider).toBeInstanceOf(S3CompatibleStorageProvider);
  });

  it('infers S3 provider from credentials when storage flag is omitted', () => {
    const options: UploadCommandOptions = {
      input: 'test.zip',
      s3AccessKeyId: 'key',
      s3SecretAccessKey: 'secret',
      s3Bucket: 'bucket',
    };
    const provider = createStorageProvider(options);
    expect(provider).toBeInstanceOf(S3CompatibleStorageProvider);
  });

  it('infers Pinata provider when only pinataJwt is present (backward compat for oracle-node)', () => {
    // oracle-node upload-worker calls upload({ pinataJwt }) without --storage or S3 creds.
    // Must route to Pinata, not throw.
    const options: UploadCommandOptions = {
      input: 'test.zip',
      pinataJwt: 'test-jwt',
    };
    const provider = createStorageProvider(options);
    expect(provider).toBeInstanceOf(PinataDirectoryUploadService);
  });

  it('throws when S3 credentials are missing and storage is explicitly "s3"', () => {
    const options: UploadCommandOptions = {
      input: 'test.zip',
      storage: 's3',
    };
    expect(() => createStorageProvider(options)).toThrow(
      'S3 credentials are required'
    );
  });

  it('throws when neither Pinata JWT nor S3 credentials are provided', () => {
    const options: UploadCommandOptions = { input: 'test.zip' };
    expect(() => createStorageProvider(options)).toThrow(
      'Storage credentials are required'
    );
  });

  it('reads S3 credentials from environment variables', () => {
    const original = {
      S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID,
      S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY,
      S3_BUCKET: process.env.S3_BUCKET,
    };

    process.env.S3_ACCESS_KEY_ID = 'env-key';
    process.env.S3_SECRET_ACCESS_KEY = 'env-secret';
    process.env.S3_BUCKET = 'env-bucket';

    const options: UploadCommandOptions = { input: 'test.zip', storage: 's3' };
    const provider = createStorageProvider(options);
    expect(provider).toBeInstanceOf(S3CompatibleStorageProvider);

    process.env.S3_ACCESS_KEY_ID = original.S3_ACCESS_KEY_ID;
    process.env.S3_SECRET_ACCESS_KEY = original.S3_SECRET_ACCESS_KEY;
    process.env.S3_BUCKET = original.S3_BUCKET;
  });
});

describe('handleUpload with storageProvider override', () => {
  let tempDir: string;
  let mockZipPath: string;

  beforeEach(async () => {
    tempDir = await fsPromises.mkdtemp(
      path.join(os.tmpdir(), 'upload-provider-test-')
    );

    const extracted = path.join(tempDir, 'extracted');
    const propDir = path.join(extracted, 'bafybeiabc123');
    await fsPromises.mkdir(propDir, { recursive: true });
    await fsPromises.writeFile(
      path.join(propDir, 'file1.json'),
      JSON.stringify({ label: 'Test 1' })
    );

    mockZipPath = path.join(tempDir, 'test.zip');
    const zip = new AdmZip();
    zip.addLocalFolder(extracted);
    zip.writeZip(mockZipPath);
  });

  afterEach(async () => {
    await fsPromises.rm(tempDir, { recursive: true, force: true });
  });

  const makeProgress = () =>
    ({
      start: vi.fn(),
      stop: vi.fn(),
      increment: vi.fn(),
      getMetrics: vi.fn().mockReturnValue({
        processed: 1,
        errors: 0,
        skipped: 0,
        total: 1,
      }),
    }) as unknown as SimpleProgress;

  const makeExtractor = (extracted: string) =>
    ({
      isZipFile: vi.fn().mockResolvedValue(true),
      extractZip: vi.fn().mockResolvedValue(extracted),
      getTempRootDir: vi.fn().mockReturnValue(tempDir),
      cleanup: vi.fn().mockResolvedValue(undefined),
    }) as unknown as ZipExtractorService;

  it('uses storageProvider override instead of pinataDirectoryUploadService', async () => {
    const extracted = path.join(tempDir, 'sp-extracted');
    const propDir = path.join(extracted, 'bafybeitest');
    await fsPromises.mkdir(propDir, { recursive: true });
    await fsPromises.writeFile(
      path.join(propDir, 'file.json'),
      JSON.stringify({})
    );

    const mockProvider: StorageProvider = {
      uploadDirectory: vi.fn().mockResolvedValue({
        success: true,
        cid: 'bafybeifromS3',
      }),
    };

    const result = await handleUpload(
      { input: mockZipPath, storage: 's3', silent: true },
      {
        zipExtractorService: makeExtractor(extracted),
        storageProvider: mockProvider,
        progressTracker: makeProgress(),
      }
    );

    expect(mockProvider.uploadDirectory).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ success: true, cid: 'bafybeifromS3' });
  });

  it('pinataDirectoryUploadService override is still honoured for backward-compat', async () => {
    const extracted = path.join(tempDir, 'compat-extracted');
    const propDir = path.join(extracted, 'bafybeicompat');
    await fsPromises.mkdir(propDir, { recursive: true });
    await fsPromises.writeFile(
      path.join(propDir, 'file.json'),
      JSON.stringify({})
    );

    const mockPinata = {
      uploadDirectory: vi.fn().mockResolvedValue({
        success: true,
        cid: 'bafybeipinatacompat',
      }),
    } as unknown as PinataDirectoryUploadService;

    const result = await handleUpload(
      { input: mockZipPath, pinataJwt: 'jwt', silent: true },
      {
        zipExtractorService: makeExtractor(extracted),
        pinataDirectoryUploadService: mockPinata,
        progressTracker: makeProgress(),
      }
    );

    expect(mockPinata.uploadDirectory).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ success: true, cid: 'bafybeipinatacompat' });
  });

  it('storageProvider override takes precedence over pinataDirectoryUploadService', async () => {
    const extracted = path.join(tempDir, 'precedence-extracted');
    const propDir = path.join(extracted, 'bafybeiprec');
    await fsPromises.mkdir(propDir, { recursive: true });
    await fsPromises.writeFile(
      path.join(propDir, 'file.json'),
      JSON.stringify({})
    );

    const mockProvider: StorageProvider = {
      uploadDirectory: vi.fn().mockResolvedValue({
        success: true,
        cid: 'bafybeifromS3-wins',
      }),
    };

    const mockPinata = {
      uploadDirectory: vi.fn().mockResolvedValue({
        success: true,
        cid: 'bafybeipinata-loses',
      }),
    } as unknown as PinataDirectoryUploadService;

    const result = await handleUpload(
      { input: mockZipPath, pinataJwt: 'jwt', silent: true },
      {
        zipExtractorService: makeExtractor(extracted),
        storageProvider: mockProvider,
        pinataDirectoryUploadService: mockPinata,
        progressTracker: makeProgress(),
      }
    );

    expect(mockProvider.uploadDirectory).toHaveBeenCalledTimes(1);
    expect(mockPinata.uploadDirectory).not.toHaveBeenCalled();
    expect(result).toEqual({ success: true, cid: 'bafybeifromS3-wins' });
  });
});
