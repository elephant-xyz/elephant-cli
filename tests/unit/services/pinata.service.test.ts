import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PinataService } from '../../../src/services/pinata.service';
import { ProcessedFile } from '../../../src/types/submit.types';
// No longer using FormData directly
import { mkdtemp, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { existsSync } from 'fs';

// Mock logger
vi.mock('../../../src/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock File (Web API) for Node
global.File = class MockFile {
  buffer: Buffer;
  name: string;
  type: string;
  constructor(parts: Buffer[], name: string, opts: { type?: string }) {
    this.buffer = Buffer.concat(parts);
    this.name = name;
    this.type = opts?.type || '';
  }
};

const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock async-mutex Semaphore
const mockSemaphoreRunExclusive = vi.fn();
vi.mock('async-mutex', () => ({
  Semaphore: vi.fn().mockImplementation(() => ({
    runExclusive: mockSemaphoreRunExclusive.mockImplementation(async (fn) => {
      return await fn();
    }),
  })),
}));

describe('PinataService', () => {
  const mockPinataJwt = 'test-jwt';
  let pinataService: PinataService;
  let tempTestDir: string; // For temporary files

  beforeEach(async () => {
    vi.resetModules();

    tempTestDir = await mkdtemp(join(tmpdir(), 'pinata-service-test-'));

    mockFetch.mockClear();
    mockSemaphoreRunExclusive.mockClear();

    pinataService = new PinataService(mockPinataJwt, undefined, 1);
  });

  afterEach(async () => {
    if (tempTestDir && existsSync(tempTestDir)) {
      await rm(tempTestDir, { recursive: true, force: true });
    }
  });

  it('should be instantiated with a JWT', () => {
    expect(pinataService).toBeInstanceOf(PinataService);
    // @ts-ignore
    expect(pinataService.pinataJwt).toBe(mockPinataJwt);
  });

  it('should throw if JWT is missing', () => {
    // @ts-ignore
    expect(() => new PinataService(undefined)).toThrow();
  });

  describe('processUpload (and uploadFileInternal)', () => {
    let mockFile: ProcessedFile;
    let tempFilePath: string;

    beforeEach(async () => {
      tempFilePath = join(tempTestDir, 'test-file.json');
      const fileContent = '{"test": "data"}';
      mockFile = {
        propertyCid: 'propTest',
        dataGroupCid: 'groupTest',
        filePath: tempFilePath,
        canonicalJson: fileContent,
        calculatedCid: 'QmTestCid',
        validationPassed: true,
      };
      await writeFile(tempFilePath, Buffer.from(fileContent));
    });

    it('should successfully upload a file', async () => {
      const mockPinataResponse = {
        IpfsHash: 'bafyTestHash',
        PinSize: 123,
        Timestamp: new Date().toISOString(),
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockPinataResponse),
      });

      // @ts-ignore
      const result = await pinataService.processUpload(mockFile);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(result.success).toBe(true);
      expect(result.cid).toBe('bafyTestHash');
    });

    it('should retry on failure and then succeed', async () => {
      const mockPinataResponse = {
        IpfsHash: 'bafyRetryHash',
        PinSize: 100,
        Timestamp: new Date().toISOString(),
      };
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          statusText: 'Server Error',
          text: () => Promise.resolve('Internal Server Error'),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockPinataResponse),
        });
      // @ts-ignore
      const result = await pinataService.processUpload(mockFile);
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(result.success).toBe(true);
      expect(result.cid).toBe('bafyRetryHash');
    });

    it('should handle readFile error (e.g., file deleted)', async () => {
      await rm(tempFilePath);

      // @ts-ignore
      const result = await pinataService.processUpload(mockFile);
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/ENOENT|Cannot read file/);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('uploadBatch', () => {
    let files: ProcessedFile[];
    let tempFilePaths: string[];

    beforeEach(async () => {
      tempFilePaths = [
        join(tempTestDir, 'file1.json'),
        join(tempTestDir, 'file2.json'),
      ];
      const fileContents = ['{"file":1}', '{"file":2}'];
      files = [
        {
          propertyCid: 'p1',
          dataGroupCid: 'g1',
          filePath: tempFilePaths[0],
          canonicalJson: fileContents[0],
          calculatedCid: 'calc1',
          validationPassed: true,
        },
        {
          propertyCid: 'p2',
          dataGroupCid: 'g2',
          filePath: tempFilePaths[1],
          canonicalJson: fileContents[1],
          calculatedCid: 'calc2',
          validationPassed: true,
        },
      ];

      await writeFile(tempFilePaths[0], Buffer.from(fileContents[0]));
      await writeFile(tempFilePaths[1], Buffer.from(fileContents[1]));

      mockFetch.mockImplementation(async () => ({
        ok: true,
        json: async () => ({
          IpfsHash: `bafyDynamicHash_${Math.random()}`,
          PinSize: 10,
          Timestamp: new Date().toISOString(),
        }),
      }));
    });

    it('should upload files using semaphore for concurrency control', async () => {
      const results = await pinataService.uploadBatch(files);
      expect(mockSemaphoreRunExclusive).toHaveBeenCalledTimes(files.length);
      expect(mockFetch).toHaveBeenCalledTimes(files.length);
      expect(results).toHaveLength(files.length);
      results.forEach((result) => expect(result.success).toBe(true));
    });
  });

  // getAuthHeaders is no longer present (JWT only, handled inline)
});
