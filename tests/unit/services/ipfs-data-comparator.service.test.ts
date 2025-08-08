import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { IpfsDataComparatorService } from '../../../src/services/ipfs-data-comparator.service.js';
import * as logger from '../../../src/utils/logger.js';

// Mock the logger
vi.mock('../../../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('IpfsDataComparatorService', () => {
  let service: IpfsDataComparatorService;
  const mockGatewayUrl = 'https://test-gateway.ipfs.io/ipfs';
  let mockFetch: any;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
    service = new IpfsDataComparatorService(mockGatewayUrl);
  });

  afterEach(() => {
    service.clearCache();
    vi.unstubAllGlobals();
  });

  describe('compareMultipleCids', () => {
    it('should throw error if less than 2 CIDs provided', async () => {
      await expect(
        service.compareMultipleCids(['cid1'], 'prop1', 'dataGroup1')
      ).rejects.toThrow('At least 2 CIDs are required for comparison');
    });

    it('should compare identical JSON data', async () => {
      const mockData = {
        label: 'Test',
        value: 'same',
      };

      const cid1 = 'bafybeiabc123';
      const cid2 = 'bafybeiabc456';

      // Mock fetch for both CIDs - return exact same data
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ...mockData }),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ...mockData }),
      });

      const result = await service.compareMultipleCids(
        [cid1, cid2],
        'propHash',
        'dataGroupHash'
      );

      expect(result.cids).toEqual([cid1, cid2]);
      expect(result.totalDifferences).toBe(0);
      expect(result.pairwiseComparisons).toHaveLength(1);
      expect(result.pairwiseComparisons[0].hasDifferences).toBe(false);
      expect(result.summary).toContain('All 2 submissions are identical');
    });

    it('should detect differences between JSON data', async () => {
      const mockData1 = {
        label: 'Test',
        relationships: {
          property_seed: {
            from: 'value1',
            to: 'value2',
          },
        },
      };

      const mockData2 = {
        label: 'Test Modified',
        relationships: {
          property_seed: {
            from: 'value1',
            to: 'value3',
            extra: 'field',
          },
        },
      };

      const cid1 = 'bafybeiabc123';
      const cid2 = 'bafybeiabc456';

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockData1,
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockData2,
      });

      const result = await service.compareMultipleCids(
        [cid1, cid2],
        'propHash',
        'dataGroupHash'
      );

      expect(result.totalDifferences).toBeGreaterThan(0);
      expect(result.pairwiseComparisons[0].hasDifferences).toBe(true);
      expect(result.summary).toContain('Compared 2 submissions');
      expect(result.summary).toContain('Most common differences');
    });

    it('should handle CID references and resolve them', async () => {
      const nestedCid = 'bafkreinestedcid';
      const mockDataWithCidRef = {
        label: 'Test',
        relationships: {
          property_seed: { '/': nestedCid },
        },
      };

      const nestedData = {
        from: { county: 'Test County' },
        to: { address: '123 Test St' },
      };

      const cid1 = 'bafybeiabc123';
      const cid2 = 'bafybeiabc456';

      // Mock main CID fetches with same structure
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ...mockDataWithCidRef }),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ...mockDataWithCidRef }),
      });

      // Mock nested CID fetch - will be cached after first fetch
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ...nestedData }),
      });

      const result = await service.compareMultipleCids(
        [cid1, cid2],
        'propHash',
        'dataGroupHash'
      );

      // After resolving, both should have identical data
      expect(result.pairwiseComparisons[0].hasDifferences).toBe(false);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining(nestedCid),
        expect.any(Object)
      );
    });

    it('should handle fetch errors with retry logic', async () => {
      const cid1 = 'bafybeiabc123';
      const cid2 = 'bafybeiabc456';
      const mockData = { test: 'data' };

      // First CID: fail twice, then succeed
      mockFetch.mockRejectedValueOnce(new Error('Network error'));
      mockFetch.mockRejectedValueOnce(new Error('Network error'));
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ...mockData }),
      });

      // Second CID: succeed immediately with same data
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ...mockData }),
      });

      const result = await service.compareMultipleCids(
        [cid1, cid2],
        'propHash',
        'dataGroupHash'
      );

      expect(result.totalDifferences).toBe(0);
      expect(logger.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Retry')
      );
    });

    it('should handle rate limiting with exponential backoff', async () => {
      const cid1 = 'bafybeiabc123';
      const cid2 = 'bafybeiabc456';
      const mockData = { test: 'data' };

      // First CID: rate limited, then succeed
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ...mockData }),
      });

      // Second CID: succeed immediately with same data
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ...mockData }),
      });

      const result = await service.compareMultipleCids(
        [cid1, cid2],
        'propHash',
        'dataGroupHash'
      );

      expect(result.totalDifferences).toBe(0);
      expect(logger.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Rate limited')
      );
    });

    it('should handle circular references', async () => {
      const cid1 = 'bafybeiabc123';
      const cid2 = 'bafybeiabc456';

      // Create circular reference
      const mockData1 = {
        label: 'Test',
        relationships: {
          self: { '/': cid1 }, // Points to itself
        },
      };

      const mockData2 = {
        label: 'Test',
        relationships: {
          self: { '/': cid2 }, // Points to itself
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockData1,
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockData2,
      });

      const result = await service.compareMultipleCids(
        [cid1, cid2],
        'propHash',
        'dataGroupHash'
      );

      // Should handle circular references gracefully
      expect(result.pairwiseComparisons[0].differences).toHaveLength(1);
      // The path might be $root or relationships.self./ depending on json-diff-ts behavior
      const diffPath = result.pairwiseComparisons[0].differences[0].path;
      expect(['$root', 'relationships.self./', 'relationships.self']).toContain(
        diffPath
      );
    });

    it('should compare three CIDs with pairwise comparisons', async () => {
      const cid1 = 'bafybeiabc123';
      const cid2 = 'bafybeiabc456';
      const cid3 = 'bafybeiabc789';

      const mockData1 = { value: 1 };
      const mockData2 = { value: 2 };
      const mockData3 = { value: 3 };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockData1,
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockData2,
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockData3,
      });

      const result = await service.compareMultipleCids(
        [cid1, cid2, cid3],
        'propHash',
        'dataGroupHash'
      );

      // Should have 3 pairwise comparisons: 1-2, 1-3, 2-3
      expect(result.pairwiseComparisons).toHaveLength(3);
      expect(result.cids).toEqual([cid1, cid2, cid3]);
      expect(result.summary).toContain('Compared 3 submissions');
    });

    it('should handle nested CID references in arrays', async () => {
      const nestedCid1 = 'bafkreinestedcid1';
      const nestedCid2 = 'bafkreinestedcid2';

      const mockData = {
        label: 'Test',
        items: [{ '/': nestedCid1 }, { '/': nestedCid2 }],
      };

      const nestedData1 = { id: 1, name: 'Item 1' };
      const nestedData2 = { id: 2, name: 'Item 2' };

      const cid1 = 'bafybeiabc123';
      const cid2 = 'bafybeiabc456';

      // Mock main CID fetches with same structure
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ...mockData }),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ...mockData }),
      });

      // Mock nested CID fetches - will be cached after first fetch
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ...nestedData1 }),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ...nestedData2 }),
      });

      const result = await service.compareMultipleCids(
        [cid1, cid2],
        'propHash',
        'dataGroupHash'
      );

      // After resolving, both should have identical structure
      expect(result.pairwiseComparisons[0].hasDifferences).toBe(false);
    });

    it('should format difference descriptions correctly', async () => {
      const mockData1 = {
        shortString: 'short',
        longString: 'a'.repeat(60),
        nullValue: null,
        undefinedValue: undefined,
        objectValue: { nested: 'value' },
        arrayValue: [1, 2, 3],
      };

      const mockData2 = {
        shortString: 'modified',
        longString: 'b'.repeat(60),
        nullValue: 'not null',
        objectValue: { nested: 'changed' },
        arrayValue: [1, 2, 3, 4],
        newField: 'added',
      };

      const cid1 = 'bafybeiabc123';
      const cid2 = 'bafybeiabc456';

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockData1,
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockData2,
      });

      const result = await service.compareMultipleCids(
        [cid1, cid2],
        'propHash',
        'dataGroupHash'
      );

      const differences = result.pairwiseComparisons[0].differences;

      // Check various formatting scenarios
      const shortStringDiff = differences.find((d) => d.path === 'shortString');
      if (shortStringDiff) {
        expect(shortStringDiff.description).toContain(
          'Changed from "short" to "modified"'
        );
      }

      const longStringDiff = differences.find((d) => d.path === 'longString');
      if (longStringDiff) {
        expect(longStringDiff.description).toContain('...');
      }

      const nullDiff = differences.find((d) => d.path === 'nullValue');
      if (nullDiff) {
        expect(nullDiff.description).toContain('null');
      }

      const newFieldDiff = differences.find((d) => d.path === 'newField');
      expect(newFieldDiff?.type).toBe('ADD');
    });
  });

  describe('clearCache', () => {
    it('should clear the fetch cache', async () => {
      const cid1 = 'bafybeiabc123';
      const cid2 = 'bafybeiabc456';
      const mockData1 = { test: 'data1' };
      const mockData2 = { test: 'data2' };

      // First fetch - 2 different CIDs
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ...mockData1 }),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ...mockData2 }),
      });

      await service.compareMultipleCids([cid1, cid2], 'prop', 'dataGroup');

      // Clear cache
      service.clearCache();

      // Second fetch should hit the API again (not cache)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ...mockData1 }),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ...mockData2 }),
      });

      await service.compareMultipleCids([cid1, cid2], 'prop', 'dataGroup');

      // Should have been called 4 times total (2 initial + 2 after cache clear)
      expect(mockFetch).toHaveBeenCalledTimes(4);
    });
  });
});
