import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock IpfsService
const mockDownloadFile = vi.fn();
vi.mock('../../../src/services/ipfs.service', () => ({
  IpfsService: vi.fn().mockImplementation(() => ({
    downloadFile: mockDownloadFile,
  })),
}));

import {
  SchemaCacheService,
  JSONSchema,
} from '../../../src/services/schema-cache.service';
import { IpfsService } from '../../../src/services/ipfs.service';

describe('SchemaCacheService', () => {
  let schemaCacheService: SchemaCacheService;
  let mockIpfsService: IpfsService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockIpfsService = new IpfsService('http://test-gateway/');
    schemaCacheService = new SchemaCacheService(mockIpfsService, 3); // Small cache for testing
  });

  describe('cache initialization', () => {
    it('should initialize with empty cache', () => {
      expect(schemaCacheService.has('test-cid')).toBe(false);

      const stats = schemaCacheService.getCacheStats();
      expect(stats.size).toBe(0);
      expect(stats.maxSize).toBe(3);
    });

    it('should initialize with custom max size', () => {
      const customService = new SchemaCacheService(mockIpfsService, 500);
      const stats = customService.getCacheStats();
      expect(stats.maxSize).toBe(500);
    });
  });

  describe('has method', () => {
    it('should return false for non-existent entries', () => {
      expect(schemaCacheService.has('non-existent')).toBe(false);
    });

    it('should return true for cached entries', async () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: { test: { type: 'string' } },
      };
      mockDownloadFile.mockResolvedValueOnce(
        Buffer.from(JSON.stringify(schema))
      );

      await schemaCacheService.getSchema('test-cid');
      expect(schemaCacheService.has('test-cid')).toBe(true);
    });
  });

  describe('getSchema', () => {
    it('should download and cache schema on first request', async () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
          age: { type: 'number' },
        },
        required: ['name'],
      };

      mockDownloadFile.mockResolvedValueOnce(
        Buffer.from(JSON.stringify(schema))
      );

      const result = await schemaCacheService.getSchema('test-cid');

      expect(mockDownloadFile).toHaveBeenCalledWith('test-cid');
      expect(result).toEqual(schema);
      expect(schemaCacheService.has('test-cid')).toBe(true);
    });

    it('should return cached schema on subsequent requests', async () => {
      const schema: JSONSchema = { type: 'object' };
      mockDownloadFile.mockResolvedValueOnce(
        Buffer.from(JSON.stringify(schema))
      );

      // First request
      const result1 = await schemaCacheService.getSchema('test-cid');
      expect(mockDownloadFile).toHaveBeenCalledTimes(1);

      // Second request should use cache
      const result2 = await schemaCacheService.getSchema('test-cid');
      expect(mockDownloadFile).toHaveBeenCalledTimes(1); // No additional calls
      expect(result2).toEqual(schema);
      expect(result1).toEqual(result2);
    });

    it('should handle JSON parsing errors', async () => {
      mockDownloadFile.mockResolvedValueOnce(Buffer.from('invalid json'));

      await expect(schemaCacheService.getSchema('invalid-cid')).rejects.toThrow(
        'Failed to download or parse schema invalid-cid'
      );
    });

    it('should handle IPFS download errors', async () => {
      mockDownloadFile.mockRejectedValueOnce(new Error('Network error'));

      await expect(schemaCacheService.getSchema('error-cid')).rejects.toThrow(
        'Failed to download or parse schema error-cid: Network error'
      );
    });

    it('should reject non-object schemas', async () => {
      mockDownloadFile.mockResolvedValueOnce(Buffer.from('"not an object"'));

      await expect(schemaCacheService.getSchema('string-cid')).rejects.toThrow(
        'Invalid JSON schema: not an object'
      );
    });

    it('should reject null schemas', async () => {
      mockDownloadFile.mockResolvedValueOnce(Buffer.from('null'));

      await expect(schemaCacheService.getSchema('null-cid')).rejects.toThrow(
        'Invalid JSON schema: not an object'
      );
    });
  });

  describe('LRU cache behavior', () => {
    it('should evict least recently used items when cache is full', async () => {
      const schema1: JSONSchema = { type: 'object', title: 'Schema 1' };
      const schema2: JSONSchema = { type: 'object', title: 'Schema 2' };
      const schema3: JSONSchema = { type: 'object', title: 'Schema 3' };
      const schema4: JSONSchema = { type: 'object', title: 'Schema 4' };

      mockDownloadFile
        .mockResolvedValueOnce(Buffer.from(JSON.stringify(schema1)))
        .mockResolvedValueOnce(Buffer.from(JSON.stringify(schema2)))
        .mockResolvedValueOnce(Buffer.from(JSON.stringify(schema3)))
        .mockResolvedValueOnce(Buffer.from(JSON.stringify(schema4)));

      // Fill cache to capacity (3 items)
      await schemaCacheService.getSchema('cid1');
      await schemaCacheService.getSchema('cid2');
      await schemaCacheService.getSchema('cid3');

      expect(schemaCacheService.has('cid1')).toBe(true);
      expect(schemaCacheService.has('cid2')).toBe(true);
      expect(schemaCacheService.has('cid3')).toBe(true);

      // Add fourth item, should evict first (least recently used)
      await schemaCacheService.getSchema('cid4');

      expect(schemaCacheService.has('cid1')).toBe(false); // Evicted
      expect(schemaCacheService.has('cid2')).toBe(true);
      expect(schemaCacheService.has('cid3')).toBe(true);
      expect(schemaCacheService.has('cid4')).toBe(true);

      const stats = schemaCacheService.getCacheStats();
      expect(stats.size).toBe(3);
    });

    it('should update LRU order when accessing cached items', async () => {
      const schema1: JSONSchema = { type: 'object', title: 'Schema 1' };
      const schema2: JSONSchema = { type: 'object', title: 'Schema 2' };
      const schema3: JSONSchema = { type: 'object', title: 'Schema 3' };
      const schema4: JSONSchema = { type: 'object', title: 'Schema 4' };

      mockDownloadFile
        .mockResolvedValueOnce(Buffer.from(JSON.stringify(schema1)))
        .mockResolvedValueOnce(Buffer.from(JSON.stringify(schema2)))
        .mockResolvedValueOnce(Buffer.from(JSON.stringify(schema3)))
        .mockResolvedValueOnce(Buffer.from(JSON.stringify(schema4)));

      // Fill cache
      await schemaCacheService.getSchema('cid1');
      await schemaCacheService.getSchema('cid2');
      await schemaCacheService.getSchema('cid3');

      // Access cid1 to make it most recently used
      await schemaCacheService.getSchema('cid1');

      // Add fourth item, should evict cid2 (now least recently used)
      await schemaCacheService.getSchema('cid4');

      expect(schemaCacheService.has('cid1')).toBe(true); // Still in cache
      expect(schemaCacheService.has('cid2')).toBe(false); // Evicted
      expect(schemaCacheService.has('cid3')).toBe(true);
      expect(schemaCacheService.has('cid4')).toBe(true);
    });
  });

  describe('preloadSchemas', () => {
    it('should preload missing schemas in parallel', async () => {
      const schema1: JSONSchema = { type: 'object', title: 'Schema 1' };
      const schema2: JSONSchema = { type: 'object', title: 'Schema 2' };

      mockDownloadFile
        .mockResolvedValueOnce(Buffer.from(JSON.stringify(schema1)))
        .mockResolvedValueOnce(Buffer.from(JSON.stringify(schema2)));

      const cids = ['cid1', 'cid2'];
      await schemaCacheService.preloadSchemas(cids);

      expect(mockDownloadFile).toHaveBeenCalledTimes(2);
      expect(schemaCacheService.has('cid1')).toBe(true);
      expect(schemaCacheService.has('cid2')).toBe(true);
    });

    it('should skip already cached schemas', async () => {
      const schema1: JSONSchema = { type: 'object', title: 'Schema 1' };
      const schema2: JSONSchema = { type: 'object', title: 'Schema 2' };

      // Pre-cache one schema
      mockDownloadFile.mockResolvedValueOnce(
        Buffer.from(JSON.stringify(schema1))
      );
      await schemaCacheService.getSchema('cid1');

      // Reset mock to count new calls
      mockDownloadFile.mockClear();
      mockDownloadFile.mockResolvedValueOnce(
        Buffer.from(JSON.stringify(schema2))
      );

      // Preload both - should only download cid2
      const cids = ['cid1', 'cid2'];
      await schemaCacheService.preloadSchemas(cids);

      expect(mockDownloadFile).toHaveBeenCalledTimes(1);
      expect(mockDownloadFile).toHaveBeenCalledWith('cid2');
    });

    it('should handle duplicate CIDs in preload list', async () => {
      const schema: JSONSchema = { type: 'object', title: 'Schema' };
      mockDownloadFile.mockResolvedValueOnce(
        Buffer.from(JSON.stringify(schema))
      );

      const cids = ['cid1', 'cid1', 'cid1']; // Duplicates
      await schemaCacheService.preloadSchemas(cids);

      expect(mockDownloadFile).toHaveBeenCalledTimes(1);
      expect(schemaCacheService.has('cid1')).toBe(true);
    });

    it('should handle empty preload list', async () => {
      await schemaCacheService.preloadSchemas([]);
      expect(mockDownloadFile).not.toHaveBeenCalled();
    });

    it('should continue preloading even if some schemas fail', async () => {
      const schema2: JSONSchema = { type: 'object', title: 'Schema 2' };

      mockDownloadFile
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce(Buffer.from(JSON.stringify(schema2)));

      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      const cids = ['cid1', 'cid2'];
      await schemaCacheService.preloadSchemas(cids);

      expect(mockDownloadFile).toHaveBeenCalledTimes(2);
      expect(schemaCacheService.has('cid1')).toBe(false); // Failed to load
      expect(schemaCacheService.has('cid2')).toBe(true); // Successfully loaded
      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to preload schema cid1:',
        expect.any(Error)
      );

      consoleSpy.mockRestore();
    });
  });

  describe('cache management', () => {
    it('should provide accurate cache stats', async () => {
      expect(schemaCacheService.getCacheStats()).toEqual({
        size: 0,
        maxSize: 3,
      });

      const schema: JSONSchema = { type: 'object' };
      mockDownloadFile.mockResolvedValueOnce(
        Buffer.from(JSON.stringify(schema))
      );
      await schemaCacheService.getSchema('test-cid');

      expect(schemaCacheService.getCacheStats()).toEqual({
        size: 1,
        maxSize: 3,
      });
    });

    it('should clear cache completely', async () => {
      const schema: JSONSchema = { type: 'object' };
      mockDownloadFile.mockResolvedValueOnce(
        Buffer.from(JSON.stringify(schema))
      );
      await schemaCacheService.getSchema('test-cid');

      expect(schemaCacheService.has('test-cid')).toBe(true);
      expect(schemaCacheService.getCacheStats().size).toBe(1);

      schemaCacheService.clear();

      expect(schemaCacheService.has('test-cid')).toBe(false);
      expect(schemaCacheService.getCacheStats().size).toBe(0);
    });
  });
});
