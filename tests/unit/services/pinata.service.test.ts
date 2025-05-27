import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  PinataService,
  PinataPinResponse,
} from '../../../src/services/pinata.service';
import { ProcessedFile } from '../../../src/types/submit.types';
import FormData from 'form-data';
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

// REMOVE fs mock:
// const mockFsReadFile = vi.fn();
// vi.mock('fs', () => { ... });

const mockFormDataAppend = vi.fn();
const mockFormDataGetHeaders = vi
  .fn()
  .mockReturnValue({ 'content-type': 'multipart/form-data; boundary=---123' });
vi.mock('form-data', () => {
  const FormDataMockConstructor = vi.fn(() => ({
    append: mockFormDataAppend,
    getHeaders: mockFormDataGetHeaders,
  }));
  return { default: FormDataMockConstructor };
});

const mockFetch = vi.fn();
global.fetch = mockFetch;

// Spies for QueueManager methods that PinataService will call
const mockQueueManagerPush = vi.fn();
const mockQueueManagerStart = vi.fn();
const mockQueueManagerDrain = vi.fn();
const mockQueueManagerGetStats = vi.fn(() => ({
  pending: 0,
  active: 0,
  completed: 0,
  failed: 0,
}));
const mockQueueManagerOn = vi.fn();

vi.mock('../../../src/utils/queue-manager', () => {
  return {
    QueueManager: vi.fn().mockImplementation(function (
      this: any,
      options: any
    ) {
      this.options = options;
      this.processor = options?.processFn;
      this.pushedItems = [];
      this.push = mockQueueManagerPush.mockImplementation(
        (item: ProcessedFile) => {
          this.pushedItems.push(item);
          return new Promise(async (resolve, reject) => {
            if (this.processor) {
              try {
                const result = await this.processor(item);
                resolve(result);
              } catch (e) {
                reject(e);
              }
            } else {
              resolve({
                success: false,
                error: 'Mock QueueManager: No processor set',
                propertyCid: item.propertyCid,
                dataGroupCid: item.dataGroupCid,
              });
            }
          });
        }
      );
      this.start = mockQueueManagerStart;
      this.drain = mockQueueManagerDrain.mockImplementation(async () => {
        const results = [];
        while (this.pushedItems.length > 0) {
          const item = this.pushedItems.shift();
          if (item && this.processor) {
            results.push(await this.processor(item));
          }
        }
        return Promise.resolve(results);
      });
      this.getStats = mockQueueManagerGetStats;
      this.on = mockQueueManagerOn;
      this.setProcessor = vi.fn((processorFunc) => {
        this.processor = processorFunc;
      });
      return this;
    }),
  };
});

describe('PinataService', () => {
  const mockPinataJwt = 'test-jwt';
  let pinataService: PinataService;
  let tempTestDir: string; // For temporary files

  beforeEach(async () => {
    vi.resetModules(); // Ensure modules are re-evaluated with mocks for each test

    // Create unique temporary directory for each test
    tempTestDir = await mkdtemp(join(tmpdir(), 'pinata-service-test-'));

    // Clear mocks
    // mockFsReadFile.mockClear(); // Removed
    mockFormDataAppend.mockClear();
    mockFormDataGetHeaders
      .mockClear()
      .mockReturnValue({
        'content-type': 'multipart/form-data; boundary=---123',
      });
    mockFetch.mockClear();
    mockQueueManagerPush.mockClear();
    mockQueueManagerStart.mockClear();
    mockQueueManagerDrain.mockClear().mockResolvedValue([]);
    mockQueueManagerGetStats
      .mockClear()
      .mockReturnValue({ pending: 0, active: 0, completed: 0, failed: 0 });
    mockQueueManagerOn.mockClear();

    pinataService = new PinataService(mockPinataJwt, undefined, 1);
  });

  afterEach(async () => {
    // Clean up temp directory
    if (tempTestDir && existsSync(tempTestDir)) {
      await rm(tempTestDir, { recursive: true, force: true });
    }
    // vi.clearAllMocks(); // This is in setup.ts, so might be redundant here
  });

  it('should be instantiated with a JWT', () => {
    expect(pinataService).toBeInstanceOf(PinataService);
    // @ts-ignore
    expect(pinataService.pinataJwt).toBe(mockPinataJwt);
  });

  it('should be instantiated with API key and secret', () => {
    const apiKey = 'test-api-key';
    const secretKey = 'test-secret-key';
    const serviceWithKeys = new PinataService(apiKey, secretKey);
    expect(serviceWithKeys).toBeInstanceOf(PinataService);
    // @ts-ignore
    expect(serviceWithKeys.pinataApiKey).toBe(apiKey);
    // @ts-ignore
    expect(serviceWithKeys.pinataSecretApiKey).toBe(secretKey);
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
      const mockPinataResponse: PinataPinResponse = {
        IpfsHash: 'QmActualHash',
        PinSize: 123,
        Timestamp: new Date().toISOString(),
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockPinataResponse),
      });

      // @ts-ignore
      const result = await pinataService.processUpload(mockFile);

      // expect(mockFsReadFile).toHaveBeenCalledWith(mockFile.filePath); // Removed
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(result.success).toBe(true);
      expect(result.cid).toBe('QmActualHash');
    });

    it('should retry on failure and then succeed', async () => {
      const mockPinataResponse: PinataPinResponse = {
        IpfsHash: 'QmRetryHash',
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
    });

    it('should handle readFile error (e.g., file deleted)', async () => {
      await rm(tempFilePath); // Delete the file to cause a read error

      // @ts-ignore
      const result = await pinataService.processUpload(mockFile);
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/ENOENT|Cannot read file/); // Error message might vary slightly
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
          IpfsHash: `QmDynamicHash_${Math.random()}`,
          PinSize: 10,
          Timestamp: new Date().toISOString(),
        }),
      }));
    });

    it('should queue files and process them', async () => {
      const results = await pinataService.uploadBatch(files);
      expect(mockQueueManagerPush).toHaveBeenCalledTimes(files.length);
      expect(mockQueueManagerStart).toHaveBeenCalled();
      expect(mockFetch).toHaveBeenCalledTimes(files.length); // Because mock QueueManager calls processor directly
      expect(results).toHaveLength(files.length);
      results.forEach((result) => expect(result.success).toBe(true));
    });
  });

  describe('getAuthHeaders', () => {
    it('should return JWT auth header if JWT is provided', () => {
      const serviceWithJwt = new PinataService('test-jwt-token');
      // @ts-ignore
      const headers = serviceWithJwt.getAuthHeaders();
      expect(headers).toEqual({ Authorization: 'Bearer test-jwt-token' });
    });
    it('should return API key headers if API key and secret are provided', () => {
      const serviceWithKeys = new PinataService('key', 'secret');
      // @ts-ignore
      const headers = serviceWithKeys.getAuthHeaders();
      expect(headers).toEqual({
        pinata_api_key: 'key',
        pinata_secret_api_key: 'secret',
      });
    });
  });

  describe('getQueueStats', () => {
    it('should return the current stats of the queue', () => {
      mockQueueManagerGetStats.mockReturnValueOnce({
        pending: 1,
        active: 1,
        completed: 0,
        failed: 0,
      });
      expect(pinataService.getQueueStats()).toEqual({
        pending: 1,
        active: 1,
        completed: 0,
        failed: 0,
      });
    });
  });

  describe('drainQueue', () => {
    it('should drain the queue', async () => {
      await pinataService.drainQueue();
      expect(mockQueueManagerDrain).toHaveBeenCalled();
    });
  });
});
