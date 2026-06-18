import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { promises as fsPromises } from 'fs';
import path from 'path';
import os from 'os';

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

const mockSend = vi.fn();

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn().mockImplementation(() => ({ send: mockSend })),
  PutObjectCommand: vi.fn().mockImplementation((input) => input),
}));

import { S3Client } from '@aws-sdk/client-s3';
import {
  S3CompatibleStorageProvider,
  FILEBASE_ENDPOINT,
} from '../../../src/services/s3-compatible-storage.service.js';

const baseConfig = {
  accessKeyId: 'test-key',
  secretAccessKey: 'test-secret',
  bucket: 'test-bucket',
};

describe('S3CompatibleStorageProvider', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fsPromises.mkdtemp(
      path.join(os.tmpdir(), 's3-storage-test-')
    );
    mockSend.mockClear();
  });

  afterEach(async () => {
    await fsPromises.rm(tempDir, { recursive: true, force: true });
  });

  describe('constructor', () => {
    it('initializes with valid config', () => {
      expect(() => new S3CompatibleStorageProvider(baseConfig)).not.toThrow();
    });

    it('throws if accessKeyId is missing', () => {
      expect(
        () =>
          new S3CompatibleStorageProvider({
            ...baseConfig,
            accessKeyId: '',
          })
      ).toThrow('S3 accessKeyId is required.');
    });

    it('throws if secretAccessKey is missing', () => {
      expect(
        () =>
          new S3CompatibleStorageProvider({
            ...baseConfig,
            secretAccessKey: '',
          })
      ).toThrow('S3 secretAccessKey is required.');
    });

    it('throws if bucket is missing', () => {
      expect(
        () =>
          new S3CompatibleStorageProvider({
            ...baseConfig,
            bucket: '',
          })
      ).toThrow('S3 bucket name is required.');
    });

    it('uses Filebase endpoint by default', () => {
      vi.mocked(S3Client).mockClear();
      new S3CompatibleStorageProvider(baseConfig);
      expect(vi.mocked(S3Client)).toHaveBeenCalledWith(
        expect.objectContaining({ endpoint: FILEBASE_ENDPOINT })
      );
    });

    it('uses custom endpoint when provided', () => {
      vi.mocked(S3Client).mockClear();
      new S3CompatibleStorageProvider({
        ...baseConfig,
        endpoint: 'https://custom.s3.example.com',
      });
      expect(vi.mocked(S3Client)).toHaveBeenCalledWith(
        expect.objectContaining({
          endpoint: 'https://custom.s3.example.com',
        })
      );
    });
  });

  describe('uploadDirectory', () => {
    it('returns error if directory does not exist', async () => {
      const provider = new S3CompatibleStorageProvider(baseConfig);
      const result = await provider.uploadDirectory(
        path.join(tempDir, 'nonexistent')
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Directory not found');
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('returns error if directory is empty', async () => {
      const emptyDir = path.join(tempDir, 'empty');
      await fsPromises.mkdir(emptyDir, { recursive: true });

      const provider = new S3CompatibleStorageProvider(baseConfig);
      const result = await provider.uploadDirectory(emptyDir);

      expect(result.success).toBe(false);
      expect(result.error).toContain('No files found in directory');
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('uploads all files and returns CID from response header', async () => {
      const dir = path.join(tempDir, 'upload-dir');
      await fsPromises.mkdir(dir, { recursive: true });
      await fsPromises.writeFile(
        path.join(dir, 'file1.json'),
        JSON.stringify({ a: 1 })
      );
      await fsPromises.writeFile(
        path.join(dir, 'file2.json'),
        JSON.stringify({ b: 2 })
      );

      mockSend.mockResolvedValue({ 'x-amz-meta-cid': 'bafybeimockcid123' });

      const provider = new S3CompatibleStorageProvider(baseConfig);
      const result = await provider.uploadDirectory(dir, {
        name: 'test-upload',
        keyvalues: { source: 'test' },
      });

      expect(result.success).toBe(true);
      expect(result.cid).toBe('bafybeimockcid123');
      expect(mockSend).toHaveBeenCalledTimes(2);
    });

    it('uploads files with correct key structure using dirName prefix', async () => {
      const dir = path.join(tempDir, 'my-property');
      await fsPromises.mkdir(dir, { recursive: true });
      await fsPromises.writeFile(
        path.join(dir, 'data.json'),
        JSON.stringify({ x: 1 })
      );

      mockSend.mockResolvedValue({ 'x-amz-meta-cid': 'bafybeimockcid' });

      const provider = new S3CompatibleStorageProvider(baseConfig);
      await provider.uploadDirectory(dir);

      const putCall = mockSend.mock.calls[0][0];
      expect(putCall.Key).toBe('my-property/data.json');
      expect(putCall.Bucket).toBe('test-bucket');
    });

    it('uses directoryName override from metadata for key prefix', async () => {
      const dir = path.join(tempDir, 'orig-name');
      await fsPromises.mkdir(dir, { recursive: true });
      await fsPromises.writeFile(
        path.join(dir, 'file.json'),
        JSON.stringify({})
      );

      mockSend.mockResolvedValue({ 'x-amz-meta-cid': 'bafybeimockcid' });

      const provider = new S3CompatibleStorageProvider(baseConfig);
      await provider.uploadDirectory(dir, {
        directoryName: 'custom-dir-name',
      });

      const putCall = mockSend.mock.calls[0][0];
      expect(putCall.Key).toBe('custom-dir-name/file.json');
    });

    it('attaches keyvalues as S3 object metadata', async () => {
      const dir = path.join(tempDir, 'meta-dir');
      await fsPromises.mkdir(dir, { recursive: true });
      await fsPromises.writeFile(
        path.join(dir, 'file.json'),
        JSON.stringify({})
      );

      mockSend.mockResolvedValue({ 'x-amz-meta-cid': 'bafybeimockcid' });

      const provider = new S3CompatibleStorageProvider(baseConfig);
      await provider.uploadDirectory(dir, {
        name: 'test',
        keyvalues: {
          propertyCid: 'bafyprop',
          dataGroupCid: 'bafydg',
          originalCid: 'bafyorig',
        },
      });

      const putCall = mockSend.mock.calls[0][0];
      expect(putCall.Metadata).toMatchObject({
        propertyCid: 'bafyprop',
        dataGroupCid: 'bafydg',
        originalCid: 'bafyorig',
      });
    });

    it('returns success with undefined CID when provider does not return header', async () => {
      const dir = path.join(tempDir, 'no-cid-dir');
      await fsPromises.mkdir(dir, { recursive: true });
      await fsPromises.writeFile(
        path.join(dir, 'file.json'),
        JSON.stringify({})
      );

      mockSend.mockResolvedValue({});

      const provider = new S3CompatibleStorageProvider(baseConfig);
      const result = await provider.uploadDirectory(dir);

      expect(result.success).toBe(true);
      expect(result.cid).toBeUndefined();
    });

    it('uploads files in nested directories with posix-style keys', async () => {
      const dir = path.join(tempDir, 'nested-dir');
      const sub = path.join(dir, 'subdir');
      await fsPromises.mkdir(sub, { recursive: true });
      await fsPromises.writeFile(path.join(dir, 'root.json'), '{}');
      await fsPromises.writeFile(path.join(sub, 'nested.json'), '{}');

      mockSend.mockResolvedValue({ 'x-amz-meta-cid': 'bafybeimockcid' });

      const provider = new S3CompatibleStorageProvider(baseConfig);
      await provider.uploadDirectory(dir);

      expect(mockSend).toHaveBeenCalledTimes(2);

      const keys = mockSend.mock.calls.map(
        (call: Array<{ Key: string }>) => call[0].Key
      );
      expect(keys).toContain('nested-dir/root.json');
      expect(keys).toContain('nested-dir/subdir/nested.json');
    });

    it('propagates S3 send errors as a failed result — throws are not suppressed', async () => {
      const dir = path.join(tempDir, 'err-dir');
      await fsPromises.mkdir(dir, { recursive: true });
      await fsPromises.writeFile(path.join(dir, 'file.json'), '{}');

      mockSend.mockRejectedValue(new Error('S3 connection refused'));

      const provider = new S3CompatibleStorageProvider(baseConfig);
      await expect(provider.uploadDirectory(dir)).rejects.toThrow(
        'S3 connection refused'
      );
    });
  });
});
