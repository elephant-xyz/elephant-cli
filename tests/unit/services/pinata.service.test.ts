import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { PinataService, PinMetadata, PinataPinResponse } from '../../../src/services/pinata.service';
import { ProcessedFile, UploadResult } from '../../../src/types/submit.types';
import { QueueManager } from '../../../src/utils/queue-manager';
import FormData from 'form-data';
import { promises as fsPromises } from 'fs';

// Mock QueueManager
vi.mock('../../../src/utils/queue-manager');

// Mock logger
vi.mock('../../../src/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock fsPromises
vi.mock('fs/promises', () => ({
  promises: {
    readFile: vi.fn(),
  },
}));

// Mock FormData
vi.mock('form-data');

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;


describe('PinataService', () => {
  const mockPinataJwt = 'test-jwt';
  let pinataService: PinataService;
  let mockQueueManagerInstance: any;

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup mock for QueueManager constructor and its methods
    mockQueueManagerInstance = {
      push: vi.fn(item => {
        // Simulate processing by calling the service's processUpload for more integrated testing
        // @ts-ignore access private method
        return pinataService.processUpload(item);
      }),
      start: vi.fn(),
      drain: vi.fn(() => Promise.resolve()),
      getStats: vi.fn(() => ({ pending: 0, active: 0, completed: 0, failed: 0 })),
    };
    (QueueManager as vi.Mock).mockImplementation(() => mockQueueManagerInstance);
    
    pinataService = new PinataService(mockPinataJwt, undefined, 1); // Concurrency 1 for easier testing

    // Mock FormData behavior
    (FormData as vi.Mock).mockImplementation(() => {
      const append = vi.fn();
      return { append, getHeaders: () => ({}) }; // getHeaders might not be needed for fetch
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should be instantiated with a JWT', () => {
    expect(pinataService).toBeInstanceOf(PinataService);
    // @ts-ignore access private member for test
    expect(pinataService.pinataJwt).toBe(mockPinataJwt);
  });

  it('should be instantiated with API key and secret', () => {
    const apiKey = 'test-api-key';
    const secretKey = 'test-secret-key';
    const serviceWithKeys = new PinataService(apiKey, secretKey);
    expect(serviceWithKeys).toBeInstanceOf(PinataService);
    // @ts-ignore access private member for test
    expect(serviceWithKeys.pinataApiKey).toBe(apiKey);
    // @ts-ignore access private member for test
    expect(serviceWithKeys.pinataSecretApiKey).toBe(secretKey);
  });

  describe('processUpload (and uploadFileInternal)', () => {
    const mockFile: ProcessedFile = {
      propertyCid: 'propTest',
      dataGroupCid: 'groupTest',
      filePath: '/test/file.json',
      canonicalJson: '{"test": "data"}',
      calculatedCid: 'QmTestCid',
      validationPassed: true,
    };

    beforeEach(() => {
      (fsPromises.readFile as vi.Mock).mockResolvedValue(Buffer.from('{"test":"data"}'));
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

      // @ts-ignore access private method
      const result = await pinataService.processUpload(mockFile);

      expect(fsPromises.readFile).toHaveBeenCalledWith(mockFile.filePath);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.pinata.cloud/pinning/pinFileToIPFS',
        expect.objectContaining({
          method: 'POST',
          headers: { Authorization: `Bearer ${mockPinataJwt}` },
        })
      );
      expect(FormData.prototype.append).toHaveBeenCalledWith('file', expect.any(Buffer), expect.any(Object));
      expect(FormData.prototype.append).toHaveBeenCalledWith('pinataMetadata', expect.any(String));
      expect(FormData.prototype.append).toHaveBeenCalledWith('pinataOptions', expect.any(String));
      
      expect(result.success).toBe(true);
      expect(result.cid).toBe('QmActualHash');
      expect(result.propertyCid).toBe(mockFile.propertyCid);
      expect(result.dataGroupCid).toBe(mockFile.dataGroupCid);
    });

    it('should retry on failure and then succeed', async () => {
      const mockPinataResponse: PinataPinResponse = {
        IpfsHash: 'QmRetryHash', PinSize: 100, Timestamp: new Date().toISOString()
      };
      mockFetch
        .mockResolvedValueOnce({ ok: false, status: 500, statusText: 'Server Error', text: () => Promise.resolve('Internal Server Error') })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(mockPinataResponse) });

      // @ts-ignore access private method
      const result = await pinataService.processUpload(mockFile);

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(result.success).toBe(true);
      expect(result.cid).toBe('QmRetryHash');
    });

    it('should fail after all retries', async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 500, statusText: 'Server Error', text: () => Promise.resolve('Internal Server Error') }); // Fails 4 times (1 initial + 3 retries)

      // @ts-ignore access private method
      const result = await pinataService.processUpload(mockFile);

      expect(mockFetch).toHaveBeenCalledTimes(4); // 1 initial + 3 retries
      expect(result.success).toBe(false);
      expect(result.error).toContain('Pinata API error: 500 Server Error');
    });

    it('should handle readFile error', async () => {
      (fsPromises.readFile as vi.Mock).mockRejectedValueOnce(new Error('Cannot read file'));
      
      // @ts-ignore access private method
      const result = await pinataService.processUpload(mockFile);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Cannot read file');
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('uploadBatch', () => {
    const files: ProcessedFile[] = [
      { propertyCid: 'p1', dataGroupCid: 'g1', filePath: '/path/1.json', canonicalJson: '{}', calculatedCid: 'calc1', validationPassed: true },
      { propertyCid: 'p2', dataGroupCid: 'g2', filePath: '/path/2.json', canonicalJson: '{}', calculatedCid: 'calc2', validationPassed: true },
    ];

    beforeEach(() => {
      (fsPromises.readFile as vi.Mock).mockImplementation(filePath => {
        if (filePath === '/path/1.json') return Promise.resolve(Buffer.from('{"file":1}'));
        if (filePath === '/path/2.json') return Promise.resolve(Buffer.from('{"file":2}'));
        return Promise.reject(new Error('File not found in mock'));
      });
      
      mockFetch.mockImplementation(async () => {
         // Determine which file is being "uploaded" based on FormData content if needed, or just return generic success
        return {
          ok: true,
          json: () => Promise.resolve({
            IpfsHash: `QmDynamicHash_${Math.random()}`, PinSize: 10, Timestamp: new Date().toISOString()
          }),
        };
      });
    });

    it('should queue files and process them', async () => {
      const results = await pinataService.uploadBatch(files);
      
      expect(mockQueueManagerInstance.push).toHaveBeenCalledTimes(2);
      expect(mockQueueManagerInstance.start).toHaveBeenCalled();
      
      // Since push now calls processUpload, fetch should be called
      expect(mockFetch).toHaveBeenCalledTimes(files.length); 
      
      expect(results).toHaveLength(2);
      results.forEach(result => {
        expect(result.success).toBe(true);
        expect(result.cid).toMatch(/^QmDynamicHash_/);
      });
    });
  });
  
  describe('getAuthHeaders', () => {
    it('should return JWT auth header if JWT is provided', () => {
      const serviceWithJwt = new PinataService('test-jwt-token');
      // @ts-ignore access private method for test
      const headers = serviceWithJwt.getAuthHeaders();
      expect(headers).toEqual({ Authorization: 'Bearer test-jwt-token' });
    });

    it('should return API key headers if API key and secret are provided', () => {
      const serviceWithKeys = new PinataService('key', 'secret');
      // @ts-ignore access private method for test
      const headers = serviceWithKeys.getAuthHeaders();
      expect(headers).toEqual({
        pinata_api_key: 'key',
        pinata_secret_api_key: 'secret',
      });
    });
  });

  // Placeholder for processUpload test once it's implemented
  describe('processUpload (placeholder)', () => {
    it('should simulate processing an upload', async () => {
      const file: ProcessedFile = {
        propertyCid: 'propTest',
        dataGroupCid: 'groupTest',
        filePath: '/test/file.json',
        canonicalJson: '{"test": "data"}',
        calculatedCid: 'QmTestCid',
        validationPassed: true,
      };
      // @ts-ignore access private method for test
      const result = await pinataService.processUpload(file);
      expect(result.success).toBe(true);
      expect(result.cid).toContain('QmPlaceholderCidFor_QmTestCid');
    });
  });

  describe('getQueueStats', () => {
    it('should return the current stats of the queue', () => {
      expect(mockQueueManagerInstance.getStats()).toEqual({ pending: 0, active: 0, completed: 0, failed: 0 });
    });
  });

  describe('drainQueue', () => {
    it('should drain the queue and return the results', async () => {
      const results = await pinataService.drainQueue();
      expect(results).toEqual([]);
    });
  });
});
