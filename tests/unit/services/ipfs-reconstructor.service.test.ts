import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { IPFSReconstructorService } from '../../../src/services/ipfs-reconstructor.service.js';
import { logger } from '../../../src/utils/logger.js';

// Mock dependencies
vi.mock('fs');
vi.mock('../../../src/utils/logger.js');

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch as any;

// Mock schema manifest
const mockSchemaManifest = {
  Seed: {
    ipfsCid: 'bafkreicmbnr6u6onlqyrhewewzzbil54rpveyknbvlwudx56zclyapmsp4',
    type: 'dataGroup' as const,
  },
  County: {
    ipfsCid: 'bafkreie5pbx4k3wt3fnd4qewthsde2jxewm3krcgn72ecbyvnzqhaeylce',
    type: 'dataGroup' as const,
  },
  Photo_Metadata: {
    ipfsCid: 'bafkreicmuiczizzjipqjevk22ovfezn3qbeefrm2vsymzme43einrvkz4i',
    type: 'dataGroup' as const,
  },
  property: {
    ipfsCid: 'bafkreihf2o2hg6epq5yshmpgqqd5brgz5knd42uffsesujx5u4ooe4xbk4',
    type: 'class' as const,
  },
};

describe('IPFSReconstructorService', () => {
  let service: IPFSReconstructorService;
  const mockGatewayUrl = 'https://test.ipfs.io/ipfs';

  beforeEach(() => {
    vi.clearAllMocks();
    // Mock file system operations
    vi.mocked(mkdirSync).mockImplementation(() => undefined);
    vi.mocked(writeFileSync).mockImplementation(() => undefined);

    service = new IPFSReconstructorService(mockGatewayUrl);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with correct base URL', () => {
      const service1 = new IPFSReconstructorService(
        'https://gateway.com/ipfs/'
      );
      expect(service1['baseUrl']).toBe('https://gateway.com/ipfs');

      const service2 = new IPFSReconstructorService('https://gateway.com/ipfs');
      expect(service2['baseUrl']).toBe('https://gateway.com/ipfs');
    });
  });

  describe('loadSchemaManifest', () => {
    it('should fetch and load schema manifest successfully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockSchemaManifest,
      });

      await service['loadSchemaManifest']();

      expect(mockFetch).toHaveBeenCalledWith(
        'https://lexicon.elephant.xyz/json-schemas/schema-manifest.json'
      );
      expect(service['schemaManifest']).toEqual(mockSchemaManifest);
      expect(vi.mocked(logger.info)).toHaveBeenCalledWith(
        expect.stringContaining(
          'Loaded schema manifest with 4 entries (3 dataGroups)'
        )
      );
    });

    it('should throw error if manifest fetch fails', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      });

      await expect(service['loadSchemaManifest']()).rejects.toThrow(
        'Failed to load schema manifest from Elephant Network'
      );
    });

    it('should only fetch manifest once', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => mockSchemaManifest,
      });

      await service['loadSchemaManifest']();
      await service['loadSchemaManifest'](); // Second call

      expect(mockFetch).toHaveBeenCalledTimes(1); // Only called once
    });
  });

  describe('isValidCid', () => {
    it('should validate correct CIDs', () => {
      expect(
        service['isValidCid']('QmWUnTmuodSYEuHVPgxtrARGra2VpzsusAp4FqT9FWobuU')
      ).toBe(true);
      expect(
        service['isValidCid']('bafkreitest123456789012345678901234567890123456')
      ).toBe(true);
    });

    it('should reject invalid CIDs', () => {
      expect(service['isValidCid']('')).toBe(false);
      expect(service['isValidCid']('invalid')).toBe(false);
      expect(service['isValidCid']('Qm')).toBe(false);
      expect(service['isValidCid']('12345')).toBe(false);
    });
  });

  describe('fetchContent', () => {
    it('should fetch content successfully', async () => {
      const mockContent = { test: 'data' };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockContent,
      });

      const result = await service['fetchContent'](
        'QmWUnTmuodSYEuHVPgxtrARGra2VpzsusAp4FqT9FWobuU'
      );
      expect(result).toEqual(mockContent);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://test.ipfs.io/ipfs/QmWUnTmuodSYEuHVPgxtrARGra2VpzsusAp4FqT9FWobuU',
        expect.objectContaining({
          signal: expect.any(AbortSignal),
          headers: {
            'User-Agent': 'elephant-cli/1.0',
          },
        })
      );
    });

    it('should retry on rate limit (429)', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          statusText: 'Too Many Requests',
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ test: 'data' }),
        });

      const result = await service['fetchContent'](
        'QmWUnTmuodSYEuHVPgxtrARGra2VpzsusAp4FqT9FWobuU'
      );
      expect(result).toEqual({ test: 'data' });
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
        expect.stringContaining('Rate limited')
      );
    });

    it('should throw error after max retries', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
      });

      await expect(
        service['fetchContent'](
          'QmWUnTmuodSYEuHVPgxtrARGra2VpzsusAp4FqT9FWobuU'
        )
      ).rejects.toThrow('HTTP 429: Too Many Requests');
      expect(mockFetch).toHaveBeenCalledTimes(3);
    }, 20000); // Increase timeout for this test

    it('should handle non-429 errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      });

      await expect(
        service['fetchContent'](
          'QmWUnTmuodSYEuHVPgxtrARGra2VpzsusAp4FqT9FWobuU'
        )
      ).rejects.toThrow('HTTP 404: Not Found');
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('replaceCidsWithPaths', () => {
    it('should replace CID references with paths', () => {
      const cidToPath = new Map([
        ['QmWUnTmuodSYEuHVPgxtrARGra2VpzsusAp4FqT9FWobuU', './test1.json'],
        ['QmYjtig7VJQ6XsnUjqqJvj7QaMcCAwtrgNdahSiFofrE7o', './test2.json'],
      ]);

      const content = {
        data: { '/': 'QmWUnTmuodSYEuHVPgxtrARGra2VpzsusAp4FqT9FWobuU' },
        nested: {
          ref: { '/': 'QmYjtig7VJQ6XsnUjqqJvj7QaMcCAwtrgNdahSiFofrE7o' },
        },
      };

      const result = service['replaceCidsWithPaths'](content, cidToPath);
      expect(result).toEqual({
        data: { path: './test1.json' },
        nested: {
          ref: { path: './test2.json' },
        },
      });
    });

    it('should handle arrays', () => {
      const cidToPath = new Map([
        ['QmWUnTmuodSYEuHVPgxtrARGra2VpzsusAp4FqT9FWobuU', './test1.json'],
      ]);
      const content = [
        { '/': 'QmWUnTmuodSYEuHVPgxtrARGra2VpzsusAp4FqT9FWobuU' },
        { value: 'normal' },
      ];

      const result = service['replaceCidsWithPaths'](content, cidToPath);
      expect(result).toEqual([{ path: './test1.json' }, { value: 'normal' }]);
    });

    it('should preserve non-CID references', () => {
      const cidToPath = new Map();
      const content = {
        data: { '/': 'QmWUnTmuodSYEuHVPgxtrARGra2VpzsusAp4FqT9FWobuU' },
        normal: 'value',
      };

      const result = service['replaceCidsWithPaths'](content, cidToPath);
      expect(result).toEqual(content);
    });
  });

  describe('reconstructData', () => {
    beforeEach(() => {
      // Mock schema manifest fetch for all reconstructData tests
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockSchemaManifest,
      });
    });

    it('should reconstruct data successfully', async () => {
      const mockContent = {
        label: 'Test Data',
        value: 'test',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockContent,
      });

      const result = await service.reconstructData(
        'QmWUnTmuodSYEuHVPgxtrARGra2VpzsusAp4FqT9FWobuU',
        'output'
      );
      expect(result).toBe(
        'output/data_QmWUnTmuodSYEuHVPgxtrARGra2VpzsusAp4FqT9FWobuU'
      );
      expect(vi.mocked(mkdirSync)).toHaveBeenCalledWith('output', {
        recursive: true,
      });
      expect(vi.mocked(mkdirSync)).toHaveBeenCalledWith(
        'output/data_QmWUnTmuodSYEuHVPgxtrARGra2VpzsusAp4FqT9FWobuU',
        { recursive: true }
      );
      expect(vi.mocked(writeFileSync)).toHaveBeenCalledWith(
        'output/data_QmWUnTmuodSYEuHVPgxtrARGra2VpzsusAp4FqT9FWobuU/QmWUnTmuodSYEuHVPgxtrARGra2VpzsusAp4FqT9FWobuU.json',
        JSON.stringify(mockContent, null, 2),
        'utf-8'
      );
    });

    it('should handle nested CID references', async () => {
      const rootContent = {
        label: 'Root',
        relationships: {
          child: { '/': 'QmYjtig7VJQ6XsnUjqqJvj7QaMcCAwtrgNdahSiFofrE7o' },
        },
      };

      const childContent = {
        label: 'Child',
        value: 'child data',
      };

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => rootContent,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => childContent,
        });

      await service.reconstructData(
        'QmWUnTmuodSYEuHVPgxtrARGra2VpzsusAp4FqT9FWobuU',
        'output'
      );

      expect(vi.mocked(writeFileSync)).toHaveBeenCalledTimes(2);
      expect(vi.mocked(writeFileSync)).toHaveBeenNthCalledWith(
        1,
        'output/data_QmWUnTmuodSYEuHVPgxtrARGra2VpzsusAp4FqT9FWobuU/child.json',
        expect.stringContaining('"child data"'),
        'utf-8'
      );
      expect(vi.mocked(writeFileSync)).toHaveBeenNthCalledWith(
        2,
        'output/data_QmWUnTmuodSYEuHVPgxtrARGra2VpzsusAp4FqT9FWobuU/QmWUnTmuodSYEuHVPgxtrARGra2VpzsusAp4FqT9FWobuU.json',
        expect.stringContaining('"path": "./child.json"'),
        'utf-8'
      );
    });

    it('should use datagroup CID from schema manifest for filename', async () => {
      const mockContent = {
        label: 'Photo Metadata', // This should match Photo_Metadata in the manifest
        value: 'test',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockContent,
      });

      await service.reconstructData(
        'QmWUnTmuodSYEuHVPgxtrARGra2VpzsusAp4FqT9FWobuU',
        'output'
      );

      // Should use the CID from schema manifest for Photo_Metadata
      expect(vi.mocked(writeFileSync)).toHaveBeenCalledWith(
        'output/data_QmWUnTmuodSYEuHVPgxtrARGra2VpzsusAp4FqT9FWobuU/bafkreicmuiczizzjipqjevk22ovfezn3qbeefrm2vsymzme43einrvkz4i.json',
        expect.any(String),
        'utf-8'
      );
    });

    it('should use original CID if no datagroup match found', async () => {
      const mockContent = {
        label: 'Unknown Label',
        value: 'test',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockContent,
      });

      await service.reconstructData(
        'QmWUnTmuodSYEuHVPgxtrARGra2VpzsusAp4FqT9FWobuU',
        'output'
      );

      // Should use the original CID as filename
      expect(vi.mocked(writeFileSync)).toHaveBeenCalledWith(
        'output/data_QmWUnTmuodSYEuHVPgxtrARGra2VpzsusAp4FqT9FWobuU/QmWUnTmuodSYEuHVPgxtrARGra2VpzsusAp4FqT9FWobuU.json',
        expect.any(String),
        'utf-8'
      );
    });

    it('should throw error for invalid CID', async () => {
      await expect(
        service.reconstructData('invalid', 'output')
      ).rejects.toThrow('Invalid IPFS CID: invalid');
    });

    it('should throw error if fetch fails', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      await expect(
        service.reconstructData(
          'QmWUnTmuodSYEuHVPgxtrARGra2VpzsusAp4FqT9FWobuU',
          'output'
        )
      ).rejects.toThrow(
        'Failed to fetch initial CID: QmWUnTmuodSYEuHVPgxtrARGra2VpzsusAp4FqT9FWobuU'
      );
    });
  });
});
