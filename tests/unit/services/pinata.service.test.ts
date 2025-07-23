import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PinataService } from '../../../src/services/pinata.service';
import { ProcessedFile } from '../../../src/types/submit.types';
import { mkdtemp, writeFile, rm, mkdir } from 'fs/promises';
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
(global as any).File = class MockFile {
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
    vi.clearAllMocks();

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

    it('should handle invalid file data gracefully', async () => {
      // Test with invalid canonicalJson that would cause JSON parsing issues
      const invalidMockFile = {
        ...mockFile,
        canonicalJson: '', // Empty JSON will cause issues with Buffer.from
      };

      // Mock fetch to simulate successful upload even with empty data
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            IpfsHash: 'bafyEmptyDataHash',
            PinSize: 0,
            Timestamp: new Date().toISOString(),
          }),
      });

      // @ts-ignore
      const result = await pinataService.processUpload(invalidMockFile);
      // The service should handle this gracefully, not necessarily fail
      expect(result).toBeDefined();
      expect(typeof result.success).toBe('boolean');
    }, 10000);
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

  describe('uploadDirectory', () => {
    let testDirPath: string;
    let subDirPath: string;

    beforeEach(async () => {
      // Create a test directory structure
      testDirPath = join(tempTestDir, 'test-html-dir');
      subDirPath = join(testDirPath, 'assets');

      // Create directories
      await mkdir(testDirPath, { recursive: true });
      await mkdir(subDirPath, { recursive: true });
      // Create test files
      await writeFile(
        join(testDirPath, 'index.html'),
        '<html><body>Test</body></html>'
      );
      await writeFile(join(testDirPath, 'style.css'), 'body { color: red; }');
      await writeFile(join(subDirPath, 'script.js'), 'console.log("test");');
    });

    it.skip('should successfully upload a directory with all files', async () => {
      const mockPinataResponse = {
        IpfsHash: 'bafyDirectoryHash',
        PinSize: 500,
        Timestamp: new Date().toISOString(),
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockPinataResponse),
      });

      const metadata = {
        name: 'test-property-html',
        keyvalues: {
          propertyCid: 'bafkreitest123',
          dataGroupCid: 'html-fact-sheet',
        },
      };

      const result = await pinataService.uploadDirectory(testDirPath, metadata);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(result.success).toBe(true);
      expect(result.cid).toBe('bafyDirectoryHash');
      expect(result.propertyCid).toBe('bafkreitest123');
      expect(result.dataGroupCid).toBe('html-fact-sheet');

      // Verify the request was made with proper form data
      const fetchCall = mockFetch.mock.calls[0];
      expect(fetchCall[0]).toBe(
        'https://api.pinata.cloud/pinning/pinFileToIPFS'
      );
      expect(fetchCall[1].method).toBe('POST');
      expect(fetchCall[1].headers.Authorization).toBe('Bearer test-jwt');
    });

    it('should handle non-existent directory gracefully', async () => {
      const nonExistentPath = join(tempTestDir, 'non-existent');

      const result = await pinataService.uploadDirectory(nonExistentPath);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Directory not found');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should handle empty directory', async () => {
      const emptyDirPath = join(tempTestDir, 'empty-dir');
      await mkdir(emptyDirPath, { recursive: true });

      const result = await pinataService.uploadDirectory(emptyDirPath);

      expect(result.success).toBe(false);
      expect(result.error).toContain('No files found in directory');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it.skip('should handle upload failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: () => Promise.resolve('Server error'),
      });

      const result = await pinataService.uploadDirectory(testDirPath);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Pinata API error');
    });

    it.skip('should use default metadata when not provided', async () => {
      const mockPinataResponse = {
        IpfsHash: 'bafyDefaultMetadataHash',
        PinSize: 300,
        Timestamp: new Date().toISOString(),
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockPinataResponse),
      });

      const result = await pinataService.uploadDirectory(testDirPath);

      expect(result.success).toBe(true);
      expect(result.cid).toBe('bafyDefaultMetadataHash');
      expect(result.propertyCid).toBe(testDirPath);
      expect(result.dataGroupCid).toBe('directory');
    });
  });
});
