import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { IPFSService } from '../../../src/services/ipfs.service';
import { OracleAssignment } from '../../../src/types';

// Mock fetch implementation
const mockFetchImplementation = vi.fn<typeof fetch>();

// Mock fetch globally
global.fetch = mockFetchImplementation;

describe('IPFSService', () => {
  let ipfsService: IPFSService;
  let tempDir: string;
  const mockGatewayUrl = 'https://gateway.pinata.cloud/ipfs/';
  const mockCid = 'QmWUnTmuodSYEuHVPgxtrARGra2VpzsusAp4FqT9FWobuU';
  let mockOutputPath: string;

  beforeEach(() => {
    // Create a temporary directory for each test
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ipfs-test-'));
    mockOutputPath = path.join(tempDir, mockCid);

    // Clear all mock implementations and calls
    mockFetchImplementation.mockClear();

    ipfsService = new IPFSService(mockGatewayUrl); // Default maxConcurrent is 3
  });

  afterEach(() => {
    // Clean up temporary directory after each test
    try {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    } catch (error) {
      // Ignore cleanup errors to prevent test failures
      console.warn('Failed to clean up temp directory:', error);
    }
  });

  describe('constructor', () => {
    it('should initialize with gateway URL ending with slash', () => {
      const service = new IPFSService('https://gateway.pinata.cloud/ipfs');
      expect(service['gateway']).toBe('https://gateway.pinata.cloud/ipfs/');
    });

    it('should preserve gateway URL already ending with slash', () => {
      const service = new IPFSService('https://gateway.pinata.cloud/ipfs/');
      expect(service['gateway']).toBe('https://gateway.pinata.cloud/ipfs/');
    });

    it('should set default maxConcurrent to 3', () => {
      const service = new IPFSService(mockGatewayUrl);
      expect(service['maxConcurrent']).toBe(3);
    });

    it('should accept custom maxConcurrent value', () => {
      const service = new IPFSService(mockGatewayUrl, 5);
      expect(service['maxConcurrent']).toBe(5);
    });
  });

  describe('downloadFile', () => {
    beforeEach(() => {
      // Mock fetch to return a response with arrayBuffer
      const testContent = new TextEncoder().encode('test file content');
      const mockResponse = {
        ok: true,
        status: 200,
        arrayBuffer: () => Promise.resolve(testContent.buffer.slice(0)),
      } as unknown as Response;

      mockFetchImplementation.mockResolvedValue(mockResponse);
    });

    it('should download file successfully', async () => {
      const result = await ipfsService.downloadFile(mockCid, mockOutputPath);

      expect(mockFetchImplementation).toHaveBeenCalledWith(
        `${mockGatewayUrl}${mockCid}`,
        expect.objectContaining({
          signal: expect.any(AbortSignal),
        })
      );
      expect(result).toEqual({
        cid: mockCid,
        success: true,
        path: mockOutputPath,
      });
      // Verify the file was actually created
      expect(fs.existsSync(mockOutputPath)).toBe(true);
      // Verify the file contains our test content
      const content = fs.readFileSync(mockOutputPath, 'utf8');
      expect(content).toBe('test file content');
    });

    it('should create directory if it does not exist', async () => {
      const nestedPath = path.join(tempDir, 'nested', 'directory', mockCid);

      const result = await ipfsService.downloadFile(mockCid, nestedPath);

      expect(result.success).toBe(true);
      expect(fs.existsSync(nestedPath)).toBe(true);
      expect(fs.existsSync(path.dirname(nestedPath))).toBe(true);
    });

    it('should handle download failure from fetch', async () => {
      const error = new Error('Network error');
      mockFetchImplementation.mockRejectedValue(error);

      const result = await ipfsService.downloadFile(mockCid, mockOutputPath, 0); // 0 retries

      expect(result).toEqual({ cid: mockCid, success: false, error: error });
      // Verify no file was created
      expect(fs.existsSync(mockOutputPath)).toBe(false);
    });

    it('should retry on failure if retries > 0', async () => {
      const error = new Error('Temporary failure');
      const retryContent = new TextEncoder().encode('retry success content');
      const successResponse = {
        ok: true,
        status: 200,
        arrayBuffer: () => Promise.resolve(retryContent.buffer.slice(0)),
      } as unknown as Response;

      mockFetchImplementation
        .mockRejectedValueOnce(error) // First call fails
        .mockResolvedValueOnce(successResponse); // Second call succeeds

      const result = await ipfsService.downloadFile(mockCid, mockOutputPath, 1); // 1 retry

      expect(mockFetchImplementation).toHaveBeenCalledTimes(2);
      expect(result.success).toBe(true);
      expect(fs.existsSync(mockOutputPath)).toBe(true);
    });

    it('should handle HTTP error responses', async () => {
      // Mock a response with HTTP error status
      const errorResponse = {
        ok: false,
        status: 404,
      } as Response;

      mockFetchImplementation.mockResolvedValue(errorResponse);

      const result = await ipfsService.downloadFile(mockCid, mockOutputPath);

      expect(result.success).toBe(false);
      expect(result.error?.message).toBe('HTTP error! status: 404');
    });
  });

  describe('downloadBatch', () => {
    const mockAssignments: OracleAssignment[] = [
      {
        cid: 'QmCID1',
        elephant: '0x123',
        blockNumber: 100,
        transactionHash: '0xhash1',
      },
      {
        cid: 'QmCID2',
        elephant: '0x123',
        blockNumber: 101,
        transactionHash: '0xhash2',
      },
      {
        cid: 'QmCID3',
        elephant: '0x123',
        blockNumber: 102,
        transactionHash: '0xhash3',
      },
    ];

    beforeEach(() => {
      // For batch downloads, each fetch call should resolve to a successful response
      mockFetchImplementation.mockImplementation(() => {
        const batchContent = new TextEncoder().encode('batch test content');
        const mockResponse = {
          ok: true,
          status: 200,
          arrayBuffer: () => Promise.resolve(batchContent.buffer.slice(0)),
        } as unknown as Response;
        return Promise.resolve(mockResponse);
      });
    });

    it('should download multiple files with progress callback', async () => {
      const progressCallback = vi.fn();
      const results = await ipfsService.downloadBatch(
        mockAssignments,
        tempDir,
        progressCallback
      );

      expect(results).toHaveLength(3);
      expect(results.every((r) => r.success)).toBe(true);

      // Verify files were actually created
      expect(fs.existsSync(path.join(tempDir, 'QmCID1'))).toBe(true);
      expect(fs.existsSync(path.join(tempDir, 'QmCID2'))).toBe(true);
      expect(fs.existsSync(path.join(tempDir, 'QmCID3'))).toBe(true);

      // Progress callback is called asynchronously due to promises in p-queue
      // Wait for promises to settle to check calls
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(progressCallback).toHaveBeenCalledWith(1, 3);
      expect(progressCallback).toHaveBeenCalledWith(2, 3);
      expect(progressCallback).toHaveBeenCalledWith(3, 3);
    });

    it('should respect concurrent download limit', async () => {
      const serviceWithLimit = new IPFSService(mockGatewayUrl, 2); // Limit to 2
      let activeDownloads = 0;
      let maxObservedActive = 0;

      mockFetchImplementation.mockImplementation(async () => {
        activeDownloads++;
        maxObservedActive = Math.max(maxObservedActive, activeDownloads);
        await new Promise((resolve) => setTimeout(resolve, 20)); // Simulate download time
        activeDownloads--;
        const concurrentContent = new TextEncoder().encode(
          'concurrent test content'
        );
        const mockResponse = {
          ok: true,
          status: 200,
          arrayBuffer: () => Promise.resolve(concurrentContent.buffer.slice(0)),
        } as unknown as Response;
        return mockResponse;
      });

      await serviceWithLimit.downloadBatch(mockAssignments, tempDir);
      expect(maxObservedActive).toBeLessThanOrEqual(2); // Max concurrent should be <= 2
    });

    it('should handle mixed success and failure in batch', async () => {
      // Clear the beforeEach mock and set up a specific mock for this test
      mockFetchImplementation.mockClear();

      const successContent = new TextEncoder().encode('success content');
      const successResponse = {
        ok: true,
        status: 200,
        arrayBuffer: () => Promise.resolve(successContent.buffer.slice(0)),
      } as unknown as Response;

      // Create a mock that responds differently based on the CID in the URL
      mockFetchImplementation.mockImplementation((input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('QmCID2')) {
          return Promise.reject(new Error('Download failed for CID2'));
        }
        return Promise.resolve(successResponse);
      });

      const results = await ipfsService.downloadBatch(mockAssignments, tempDir);

      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(false);
      expect(results[1].error?.message).toBe('Download failed for CID2');
      expect(results[2].success).toBe(true);

      // Verify only successful files were created
      expect(fs.existsSync(path.join(tempDir, 'QmCID1'))).toBe(true);
      expect(fs.existsSync(path.join(tempDir, 'QmCID2'))).toBe(false);
      expect(fs.existsSync(path.join(tempDir, 'QmCID3'))).toBe(true);
    });
  });
});

