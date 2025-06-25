import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock IpfsService
const mockFetchContent = vi.fn();
vi.mock('../../../src/services/ipfs.service', () => ({
  IpfsService: vi.fn().mockImplementation(() => ({
    fetchContent: mockFetchContent,
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

  describe('has method', () => {
    it('should return false for non-existent entries', () => {
      expect(schemaCacheService.has('non-existent')).toBe(false);
    });

    it('should return true for cached entries', async () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: { test: { type: 'string' } },
      };
      mockFetchContent.mockResolvedValueOnce(
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

      mockFetchContent.mockResolvedValueOnce(
        Buffer.from(JSON.stringify(schema))
      );

      const result = await schemaCacheService.getSchema('test-cid');

      expect(mockFetchContent).toHaveBeenCalledWith('test-cid');
      expect(result).toEqual(schema);
      expect(schemaCacheService.has('test-cid')).toBe(true);
    });

    it('should return cached schema on subsequent requests', async () => {
      const schema: JSONSchema = { type: 'object' };
      mockFetchContent.mockResolvedValueOnce(
        Buffer.from(JSON.stringify(schema))
      );

      // First request
      const result1 = await schemaCacheService.getSchema('test-cid');
      expect(mockFetchContent).toHaveBeenCalledTimes(1);

      // Second request should use cache
      const result2 = await schemaCacheService.getSchema('test-cid');
      expect(mockFetchContent).toHaveBeenCalledTimes(1); // No additional calls
      expect(result2).toEqual(schema);
      expect(result1).toEqual(result2);
    });

    it('should handle JSON parsing errors', async () => {
      mockFetchContent.mockResolvedValueOnce(Buffer.from('invalid json'));

      await expect(schemaCacheService.getSchema('invalid-cid')).rejects.toThrow(
        'Failed to download or parse schema invalid-cid'
      );
    });

    it('should handle IPFS download errors', async () => {
      mockFetchContent.mockRejectedValueOnce(new Error('Network error'));

      await expect(schemaCacheService.getSchema('error-cid')).rejects.toThrow(
        'Failed to download or parse schema error-cid: Network error'
      );
    });

    it('should reject non-object schemas', async () => {
      mockFetchContent.mockResolvedValueOnce(Buffer.from('"not an object"'));

      await expect(schemaCacheService.getSchema('string-cid')).rejects.toThrow(
        'Invalid JSON schema: not an object'
      );
    });

    it('should reject null schemas', async () => {
      mockFetchContent.mockResolvedValueOnce(Buffer.from('null'));

      await expect(schemaCacheService.getSchema('null-cid')).rejects.toThrow(
        'Invalid JSON schema: not an object'
      );
    });
  });
});
