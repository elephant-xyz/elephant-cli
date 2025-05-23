import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import { IPFSService } from '../../../src/services/ipfs.service';
import { ElephantAssignment } from '../../../src/types';
import type { Mock } from 'jest-mock';

// Create mock axios get function
const mockAxiosGet = jest.fn() as Mock<Promise<any>>;

// Mock axios
jest.mock('axios', () => ({
  get: mockAxiosGet
}));

// Mock fs
jest.mock('fs');

describe('IPFSService', () => {
  let ipfsService: IPFSService;
  const mockGatewayUrl = 'https://gateway.pinata.cloud/ipfs/';
  const mockCid = 'QmWUnTmuodSYEuHVPgxtrARGra2VpzsusAp4FqT9FWobuU';
  const mockOutputPath = './downloads/QmWUnTmuodSYEuHVPgxtrARGra2VpzsusAp4FqT9FWobuU';

  beforeEach(() => {
    jest.clearAllMocks();
    ipfsService = new IPFSService(mockGatewayUrl);
    
    // Default mocks
    (fs.existsSync as unknown as Mock).mockReturnValue(true);
    (fs.mkdirSync as unknown as Mock).mockReturnValue(undefined);
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
    let mockStream: any;
    let mockWriter: any;

    beforeEach(() => {
      mockStream = {
        pipe: jest.fn(),
      };

      mockWriter = {
        on: jest.fn((event: string, callback: Function) => {
          if (event === 'finish') {
            // Simulate successful write
            setTimeout(() => callback(), 0);
          }
          return mockWriter;
        }),
      };

      mockAxiosGet.mockResolvedValue({
        data: mockStream,
      });

      (fs.createWriteStream as unknown as Mock).mockReturnValue(mockWriter);
      (path.dirname as unknown as Mock).mockReturnValue('./downloads');
    });

    it('should download file successfully', async () => {
      const result = await ipfsService.downloadFile(mockCid, mockOutputPath);

      expect(mockAxiosGet).toHaveBeenCalledWith(
        `${mockGatewayUrl}${mockCid}`,
        {
          responseType: 'stream',
          timeout: 30000,
        }
      );
      expect(fs.createWriteStream).toHaveBeenCalledWith(mockOutputPath);
      expect(mockStream.pipe).toHaveBeenCalledWith(mockWriter);
      expect(result).toEqual({
        cid: mockCid,
        success: true,
        path: mockOutputPath,
      });
    });

    it('should create directory if it does not exist', async () => {
      (fs.existsSync as unknown as Mock).mockReturnValue(false);

      await ipfsService.downloadFile(mockCid, mockOutputPath);

      expect(path.dirname).toHaveBeenCalledWith(mockOutputPath);
      expect(fs.mkdirSync).toHaveBeenCalledWith('./downloads', { recursive: true });
    });

    it('should handle download failure', async () => {
      const error = new Error('Network error');
      mockAxiosGet.mockRejectedValue(error);

      const result = await ipfsService.downloadFile(mockCid, mockOutputPath, 0);

      expect(result).toEqual({
        cid: mockCid,
        success: false,
        error: error,
      });
    });

    it('should retry on failure', async () => {
      const error = new Error('Temporary failure');
      mockAxiosGet
        .mockRejectedValueOnce(error)
        .mockResolvedValueOnce({ data: mockStream });

      const result = await ipfsService.downloadFile(mockCid, mockOutputPath, 1);

      expect(mockAxiosGet).toHaveBeenCalledTimes(2);
      expect(result.success).toBe(true);
    });

    it('should handle write stream errors', async () => {
      const writeError = new Error('Write error');
      mockWriter.on = jest.fn((event: string, callback: Function) => {
        if (event === 'error') {
          setTimeout(() => callback(writeError), 0);
        }
        return mockWriter;
      });

      const result = await ipfsService.downloadFile(mockCid, mockOutputPath);

      expect(result).toEqual({
        cid: mockCid,
        success: false,
        error: writeError,
      });
    });

    it('should respect timeout', async () => {
      await ipfsService.downloadFile(mockCid, mockOutputPath);

      expect(mockAxiosGet).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          timeout: 30000,
        })
      );
    });
  });

  describe('downloadBatch', () => {
    const mockAssignments: ElephantAssignment[] = [
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
      // Mock successful downloads
      const mockStream = { pipe: jest.fn() };
      const mockWriter = {
        on: jest.fn((event: string, callback: Function) => {
          if (event === 'finish') {
            setTimeout(() => callback(), 0);
          }
          return mockWriter;
        }),
      };

      mockAxiosGet.mockResolvedValue({ data: mockStream });
      (fs.createWriteStream as unknown as Mock).mockReturnValue(mockWriter);
      (path.dirname as unknown as Mock).mockImplementation((p) => path.dirname(p));
    });

    it('should download multiple files with progress callback', async () => {
      const progressCallback = jest.fn();

      const results = await ipfsService.downloadBatch(
        mockAssignments,
        './downloads',
        progressCallback
      );

      expect(results).toHaveLength(3);
      expect(results.every(r => r.success)).toBe(true);
      
      // Wait for all async operations to complete
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Progress callback should be called for each completed download
      expect(progressCallback).toHaveBeenCalledWith(1, 3);
      expect(progressCallback).toHaveBeenCalledWith(2, 3);
      expect(progressCallback).toHaveBeenCalledWith(3, 3);
    });

    it('should respect concurrent download limit', async () => {
      const service = new IPFSService(mockGatewayUrl, 2); // Max 2 concurrent
      let activeDownloads = 0;
      let maxActive = 0;

      mockAxiosGet.mockImplementation(async () => {
        activeDownloads++;
        maxActive = Math.max(maxActive, activeDownloads);
        
        // Simulate download time
        await new Promise(resolve => setTimeout(resolve, 50));
        
        activeDownloads--;
        return { data: { pipe: jest.fn() } };
      });

      await service.downloadBatch(mockAssignments);

      expect(maxActive).toBeLessThanOrEqual(2);
    });

    it('should handle mixed success and failure', async () => {
      mockAxiosGet
        .mockResolvedValueOnce({ data: { pipe: jest.fn() } })
        .mockRejectedValueOnce(new Error('Download failed'))
        .mockResolvedValueOnce({ data: { pipe: jest.fn() } });

      const results = await ipfsService.downloadBatch(mockAssignments);

      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(false);
      expect(results[1].error?.message).toBe('Download failed');
      expect(results[2].success).toBe(true);
    });

    it('should use custom download directory', async () => {
      const customDir = './custom-downloads';
      
      await ipfsService.downloadBatch(mockAssignments, customDir);

      expect(fs.createWriteStream).toHaveBeenCalledWith(`${customDir}/QmCID1`);
      expect(fs.createWriteStream).toHaveBeenCalledWith(`${customDir}/QmCID2`);
      expect(fs.createWriteStream).toHaveBeenCalledWith(`${customDir}/QmCID3`);
    });

    it('should reset counters after batch completion', async () => {
      await ipfsService.downloadBatch(mockAssignments);

      expect(ipfsService['completedCount']).toBe(0);
      expect(ipfsService['totalCount']).toBe(0);
      expect(ipfsService['onProgress']).toBeUndefined();
    });

    it('should handle empty assignment list', async () => {
      const results = await ipfsService.downloadBatch([]);

      expect(results).toEqual([]);
      expect(mockAxiosGet).not.toHaveBeenCalled();
    });

    it('should process queue correctly', async () => {
      const service = new IPFSService(mockGatewayUrl, 1); // Max 1 concurrent
      const downloadOrder: string[] = [];

      mockAxiosGet.mockImplementation(async (url) => {
        const cid = url.split('/').pop();
        downloadOrder.push(cid);
        await new Promise(resolve => setTimeout(resolve, 10));
        return { data: { pipe: jest.fn() } };
      });

      await service.downloadBatch(mockAssignments);

      // Downloads should happen in order when max concurrent is 1
      expect(downloadOrder).toEqual(['QmCID1', 'QmCID2', 'QmCID3']);
    });
  });
});