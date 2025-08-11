import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync } from 'fs';
import { promises as fsPromises } from 'fs';
import { rm, readdir } from 'fs/promises';
import AdmZip from 'adm-zip';
import { IPFSFetcherService } from '../../../src/services/ipfs-fetcher.service.js';
import { logger } from '../../../src/utils/logger.js';

// Mock dependencies
vi.mock('fs');
vi.mock('fs/promises');
vi.mock('../../../src/utils/logger.js');
vi.mock('adm-zip');

// Mock SchemaManifestService
const mockLoadSchemaManifest = vi.fn();
const mockGetDataGroupCidByLabel = vi.fn();
const mockGetAllDataGroups = vi.fn();

vi.mock('../../../src/services/schema-manifest.service.js', () => {
  return {
    SchemaManifestService: class {
      loadSchemaManifest = mockLoadSchemaManifest;
      getDataGroupCidByLabel = mockGetDataGroupCidByLabel;
      getAllDataGroups = mockGetAllDataGroups;
    },
  };
});

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

describe('IPFSFetcherService', () => {
  let service: IPFSFetcherService;
  const mockGatewayUrl = 'https://test.ipfs.io/ipfs';

  beforeEach(() => {
    vi.clearAllMocks();
    // Mock file system operations
    vi.mocked(mkdirSync).mockImplementation(() => undefined);
    vi.mocked(writeFileSync).mockImplementation(() => undefined);

    // Reset mock implementations
    mockLoadSchemaManifest.mockReset();
    mockGetDataGroupCidByLabel.mockReset();
    mockGetAllDataGroups.mockReset();

    // Set default implementations
    mockLoadSchemaManifest.mockResolvedValue(mockSchemaManifest);
    mockGetDataGroupCidByLabel.mockImplementation((label: string) => {
      // Match labels with underscores or spaces
      const normalizedLabel = label.replace(/ /g, '_');
      const entry = Object.entries(mockSchemaManifest).find(
        ([key]) => key === normalizedLabel || key === label
      );
      return entry ? entry[1].ipfsCid : null;
    });

    service = new IPFSFetcherService(mockGatewayUrl);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with correct base URL', () => {
      const service1 = new IPFSFetcherService('https://gateway.com/ipfs/');
      expect(service1['baseUrl']).toBe('https://gateway.com/ipfs');

      const service2 = new IPFSFetcherService('https://gateway.com/ipfs');
      expect(service2['baseUrl']).toBe('https://gateway.com/ipfs');
    });
  });

  describe('loadSchemaManifest', () => {
    it('should fetch and load schema manifest successfully', async () => {
      // Mock the loadSchemaManifest method to return the manifest
      mockLoadSchemaManifest.mockResolvedValueOnce(mockSchemaManifest);

      const result = await service['loadSchemaManifest']();

      expect(mockLoadSchemaManifest).toHaveBeenCalled();
      expect(result).toEqual(mockSchemaManifest);
    });

    it('should throw error if manifest fetch fails', async () => {
      mockLoadSchemaManifest.mockRejectedValueOnce(
        new Error('Failed to load schema manifest from Elephant Network')
      );

      await expect(service['loadSchemaManifest']()).rejects.toThrow(
        'Failed to load schema manifest from Elephant Network'
      );
    });

    it('should only fetch manifest once', async () => {
      mockLoadSchemaManifest.mockResolvedValue(mockSchemaManifest);

      await service['loadSchemaManifest']();
      await service['loadSchemaManifest'](); // Second call

      // SchemaManifestService handles caching internally
      expect(mockLoadSchemaManifest).toHaveBeenCalledTimes(2);
    });
  });

  describe('isValidCid', () => {
    it('should validate correct CIDs', () => {
      expect(
        service['isValidCid']('QmWUnTmuodSYEuHVPgxtrARGra2VpzsusAp4FqT9FWobuU')
      ).toBe(true);
      expect(
        service['isValidCid'](
          'bafkreigvblf5zafojx6zbak6zvph2c2ita56uodqqykmwe3wuz3bco2hy4'
        )
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
    }, 20000); // Timeout needed as retry logic includes actual delays (5s + 10s)

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
        data: { '/': './test1.json' },
        nested: {
          ref: { '/': './test2.json' },
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
      expect(result).toEqual([{ '/': './test1.json' }, { value: 'normal' }]);
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

  describe('fetchData', () => {
    beforeEach(() => {
      // Schema manifest is now loaded via SchemaManifestService mock
      // No need to mock fetch for it
    });

    it('should fetch data successfully', async () => {
      const mockContent = {
        label: 'Test Data',
        value: 'test',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockContent,
      });

      const result = await service.fetchData(
        'QmWUnTmuodSYEuHVPgxtrARGra2VpzsusAp4FqT9FWobuU',
        'output'
      );
      expect(result).toBe(
        'output/QmWUnTmuodSYEuHVPgxtrARGra2VpzsusAp4FqT9FWobuU'
      );
      expect(vi.mocked(mkdirSync)).toHaveBeenCalledWith('output', {
        recursive: true,
      });
      expect(vi.mocked(mkdirSync)).toHaveBeenCalledWith(
        'output/QmWUnTmuodSYEuHVPgxtrARGra2VpzsusAp4FqT9FWobuU',
        { recursive: true }
      );
      expect(vi.mocked(writeFileSync)).toHaveBeenCalledWith(
        'output/QmWUnTmuodSYEuHVPgxtrARGra2VpzsusAp4FqT9FWobuU/QmWUnTmuodSYEuHVPgxtrARGra2VpzsusAp4FqT9FWobuU.json',
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

      await service.fetchData(
        'QmWUnTmuodSYEuHVPgxtrARGra2VpzsusAp4FqT9FWobuU',
        'output'
      );

      expect(vi.mocked(writeFileSync)).toHaveBeenCalledTimes(2);
      expect(vi.mocked(writeFileSync)).toHaveBeenNthCalledWith(
        1,
        'output/QmWUnTmuodSYEuHVPgxtrARGra2VpzsusAp4FqT9FWobuU/child.json',
        expect.stringContaining('"child data"'),
        'utf-8'
      );
      expect(vi.mocked(writeFileSync)).toHaveBeenNthCalledWith(
        2,
        'output/QmWUnTmuodSYEuHVPgxtrARGra2VpzsusAp4FqT9FWobuU/QmWUnTmuodSYEuHVPgxtrARGra2VpzsusAp4FqT9FWobuU.json',
        expect.stringContaining('"/": "./child.json"'),
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

      await service.fetchData(
        'QmWUnTmuodSYEuHVPgxtrARGra2VpzsusAp4FqT9FWobuU',
        'output'
      );

      // Should use the CID from schema manifest for Photo_Metadata
      expect(vi.mocked(writeFileSync)).toHaveBeenCalledWith(
        'output/QmWUnTmuodSYEuHVPgxtrARGra2VpzsusAp4FqT9FWobuU/bafkreicmuiczizzjipqjevk22ovfezn3qbeefrm2vsymzme43einrvkz4i.json',
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

      await service.fetchData(
        'QmWUnTmuodSYEuHVPgxtrARGra2VpzsusAp4FqT9FWobuU',
        'output'
      );

      // Should use the original CID as filename
      expect(vi.mocked(writeFileSync)).toHaveBeenCalledWith(
        'output/QmWUnTmuodSYEuHVPgxtrARGra2VpzsusAp4FqT9FWobuU/QmWUnTmuodSYEuHVPgxtrARGra2VpzsusAp4FqT9FWobuU.json',
        expect.any(String),
        'utf-8'
      );
    });

    it('should throw error for invalid CID', async () => {
      await expect(service.fetchData('invalid', 'output')).rejects.toThrow(
        'Invalid IPFS CID: invalid'
      );
    });

    it('should throw error if fetch fails', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      await expect(
        service.fetchData(
          'QmWUnTmuodSYEuHVPgxtrARGra2VpzsusAp4FqT9FWobuU',
          'output'
        )
      ).rejects.toThrow(
        'Failed to fetch initial CID: QmWUnTmuodSYEuHVPgxtrARGra2VpzsusAp4FqT9FWobuU'
      );
    });
  });

  describe('fetchFromTransaction', () => {
    const mockRpcUrl = 'https://polygon-rpc.com';
    const mockTransactionHash =
      '0x1234567890123456789012345678901234567890123456789012345678901234';

    beforeEach(() => {
      // Create service with RPC URL
      service = new IPFSFetcherService(mockGatewayUrl, mockRpcUrl);

      // Mock schema manifest loading
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockSchemaManifest,
      });
    });

    it('should throw error if RPC provider is not initialized', async () => {
      const serviceWithoutRpc = new IPFSFetcherService(mockGatewayUrl);

      await expect(
        serviceWithoutRpc.fetchFromTransaction(mockTransactionHash)
      ).rejects.toThrow('RPC provider not initialized');
    });

    it('should throw error if transaction is not found', async () => {
      // Mock ethers provider
      const mockProvider = {
        getTransaction: vi.fn().mockResolvedValue(null),
      };

      // Inject mock provider
      (service as any).provider = mockProvider;

      await expect(
        service.fetchFromTransaction(mockTransactionHash)
      ).rejects.toThrow(`Transaction not found: ${mockTransactionHash}`);
    });

    it('should throw error if transaction has no input data', async () => {
      const mockTx = {
        hash: mockTransactionHash,
        data: '0x',
      };

      const mockProvider = {
        getTransaction: vi.fn().mockResolvedValue(mockTx),
      };

      (service as any).provider = mockProvider;

      await expect(
        service.fetchFromTransaction(mockTransactionHash)
      ).rejects.toThrow('Transaction has no input data');
    });

    it('should decode and process submitBatchData transaction', async () => {
      // Mock transaction with encoded submitBatchData call
      // Function selector for submitBatchData: 0xb35d6ef2
      const encodedData =
        '0xb35d6ef2' +
        '0000000000000000000000000000000000000000000000000000000000000020' + // offset to array
        '0000000000000000000000000000000000000000000000000000000000000001' + // array length (1 item)
        // First item (propertyHash, dataGroupHash, dataHash)
        '1234567890123456789012345678901234567890123456789012345678901234' + // propertyHash
        'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890' + // dataGroupHash
        'fedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321'; // dataHash

      const mockTx = {
        hash: mockTransactionHash,
        data: encodedData,
      };

      const mockProvider = {
        getTransaction: vi.fn().mockResolvedValue(mockTx),
      };

      (service as any).provider = mockProvider;

      // Mock IPFS fetch for data
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          label: 'Test Data',
          data: 'test content',
        }),
      });

      await service.fetchFromTransaction(mockTransactionHash, 'test-output');

      // Verify transaction was fetched
      expect(mockProvider.getTransaction).toHaveBeenCalledWith(
        mockTransactionHash
      );

      // Verify directories were created
      expect(mkdirSync).toHaveBeenCalledWith(
        expect.stringContaining('test-output'),
        expect.any(Object)
      );

      // Verify logger messages
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Found 1 data items in transaction')
      );
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining(
          'Processing 1 unique properties from transaction'
        )
      );
    });

    it('should handle multiple data items in transaction', async () => {
      // Mock transaction with multiple items
      const encodedData =
        '0xb35d6ef2' +
        '0000000000000000000000000000000000000000000000000000000000000020' + // offset to array
        '0000000000000000000000000000000000000000000000000000000000000002' + // array length (2 items)
        // First item
        '1234567890123456789012345678901234567890123456789012345678901234' + // propertyHash 1
        'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890' + // dataGroupHash 1
        'fedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321' + // dataHash 1
        // Second item (same property, different data group)
        '1234567890123456789012345678901234567890123456789012345678901234' + // propertyHash 1 (same)
        '1111111111111111111111111111111111111111111111111111111111111111' + // dataGroupHash 2
        '2222222222222222222222222222222222222222222222222222222222222222'; // dataHash 2

      const mockTx = {
        hash: mockTransactionHash,
        data: encodedData,
      };

      const mockProvider = {
        getTransaction: vi.fn().mockResolvedValue(mockTx),
      };

      (service as any).provider = mockProvider;

      // Mock IPFS fetches
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ label: 'Data 1', content: 'test 1' }),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ label: 'Data 2', content: 'test 2' }),
      });

      await service.fetchFromTransaction(mockTransactionHash);

      // Verify correct number of items found
      expect(logger.info).toHaveBeenCalledWith(
        'Found 2 data items in transaction'
      );
      expect(logger.info).toHaveBeenCalledWith(
        'Processing 1 unique properties from transaction'
      );
      expect(logger.info).toHaveBeenCalledWith('  Found 2 data groups');
    });

    it('should handle transaction decoding errors gracefully', async () => {
      const mockTx = {
        hash: mockTransactionHash,
        data: '0xinvaliddata',
      };

      const mockProvider = {
        getTransaction: vi.fn().mockResolvedValue(mockTx),
      };

      (service as any).provider = mockProvider;

      await expect(
        service.fetchFromTransaction(mockTransactionHash)
      ).rejects.toThrow('Failed to decode transaction data');
    });
  });

  describe('fetchDataToZip', () => {
    let mockZip: any;
    let mockAddDirectoryToZip: any;

    beforeEach(() => {
      // Mock AdmZip instance
      mockZip = {
        addFile: vi.fn(),
        writeZip: vi.fn(),
      };
      vi.mocked(AdmZip).mockImplementation(() => mockZip);

      // Mock fs promises
      vi.mocked(fsPromises.mkdtemp).mockResolvedValue(
        '/tmp/elephant-cli-fetch-123'
      );
      vi.mocked(rm).mockResolvedValue(undefined);
      vi.mocked(readdir).mockResolvedValue([]);
      vi.mocked(fsPromises.readFile).mockResolvedValue(
        Buffer.from('test content')
      );

      // Mock the addDirectoryToZip method
      mockAddDirectoryToZip = vi
        .spyOn(service as any, 'addDirectoryToZip')
        .mockResolvedValue(undefined);
    });

    afterEach(() => {
      mockAddDirectoryToZip.mockRestore();
    });

    it('should create a temporary directory', async () => {
      // Mock the fetchData method to return a directory path
      vi.spyOn(service, 'fetchData').mockResolvedValue(
        '/tmp/elephant-cli-fetch-123/QmTest'
      );

      await service.fetchDataToZip('QmTest', 'output.zip');

      expect(fsPromises.mkdtemp).toHaveBeenCalledWith(
        expect.stringContaining('elephant-cli-fetch-')
      );
    });

    it('should call fetchData with correct parameters', async () => {
      const fetchDataSpy = vi
        .spyOn(service, 'fetchData')
        .mockResolvedValue('/tmp/elephant-cli-fetch-123/QmTest');

      await service.fetchDataToZip('QmTest', 'output.zip');

      expect(fetchDataSpy).toHaveBeenCalledWith(
        'QmTest',
        '/tmp/elephant-cli-fetch-123'
      );
    });

    it('should create ZIP with correct structure', async () => {
      vi.spyOn(service, 'fetchData').mockResolvedValue(
        '/tmp/elephant-cli-fetch-123/QmTest'
      );

      await service.fetchDataToZip('QmTest', 'output.zip');

      // Verify ZIP was created with data folder structure
      expect(mockAddDirectoryToZip).toHaveBeenCalledWith(
        mockZip,
        '/tmp/elephant-cli-fetch-123/QmTest',
        'data/QmTest'
      );
      expect(mockZip.writeZip).toHaveBeenCalledWith('output.zip');
    });

    it('should clean up temporary directory on success', async () => {
      vi.spyOn(service, 'fetchData').mockResolvedValue(
        '/tmp/elephant-cli-fetch-123/QmTest'
      );

      await service.fetchDataToZip('QmTest', 'output.zip');

      expect(rm).toHaveBeenCalledWith('/tmp/elephant-cli-fetch-123', {
        recursive: true,
        force: true,
      });
    });

    it('should clean up temporary directory on fetchData failure', async () => {
      vi.spyOn(service, 'fetchData').mockRejectedValue(
        new Error('Fetch failed')
      );

      await expect(
        service.fetchDataToZip('QmTest', 'output.zip')
      ).rejects.toThrow('Fetch failed');

      expect(rm).toHaveBeenCalledWith('/tmp/elephant-cli-fetch-123', {
        recursive: true,
        force: true,
      });
    });

    it('should clean up temporary directory on ZIP creation failure', async () => {
      vi.spyOn(service, 'fetchData').mockResolvedValue(
        '/tmp/elephant-cli-fetch-123/QmTest'
      );
      mockZip.writeZip.mockImplementation(() => {
        throw new Error('ZIP write failed');
      });

      await expect(
        service.fetchDataToZip('QmTest', 'output.zip')
      ).rejects.toThrow('ZIP write failed');

      expect(rm).toHaveBeenCalledWith('/tmp/elephant-cli-fetch-123', {
        recursive: true,
        force: true,
      });
    });

    it('should log appropriate messages', async () => {
      vi.spyOn(service, 'fetchData').mockResolvedValue(
        '/tmp/elephant-cli-fetch-123/QmTest'
      );

      await service.fetchDataToZip('QmTest', 'output.zip');

      expect(logger.info).toHaveBeenCalledWith('Creating ZIP file: output.zip');
      expect(logger.info).toHaveBeenCalledWith(
        'ZIP file created successfully: output.zip'
      );
    });

    it('should handle cleanup failure gracefully', async () => {
      vi.spyOn(service, 'fetchData').mockResolvedValue(
        '/tmp/elephant-cli-fetch-123/QmTest'
      );
      vi.mocked(rm).mockRejectedValue(new Error('Cleanup failed'));

      // Should not throw even if cleanup fails
      await expect(
        service.fetchDataToZip('QmTest', 'output.zip')
      ).resolves.not.toThrow();

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to clean up temporary directory')
      );
    });
  });

  describe('fetchFromTransactionToZip', () => {
    let mockZip: any;
    const mockTransactionHash =
      '0x1234567890123456789012345678901234567890123456789012345678901234';

    beforeEach(() => {
      // Mock AdmZip instance
      mockZip = {
        addFile: vi.fn(),
        writeZip: vi.fn(),
      };
      vi.mocked(AdmZip).mockImplementation(() => mockZip);

      // Mock fs promises
      vi.mocked(fsPromises.mkdtemp).mockResolvedValue(
        '/tmp/elephant-cli-fetch-456'
      );
      vi.mocked(rm).mockResolvedValue(undefined);
      vi.mocked(fsPromises.readFile).mockResolvedValue(
        Buffer.from('test content')
      );
    });

    it('should create a temporary directory', async () => {
      vi.spyOn(service, 'fetchFromTransaction').mockResolvedValue(undefined);
      vi.mocked(readdir).mockResolvedValue([]);

      await service.fetchFromTransactionToZip(
        mockTransactionHash,
        'output.zip'
      );

      expect(fsPromises.mkdtemp).toHaveBeenCalledWith(
        expect.stringContaining('elephant-cli-fetch-')
      );
    });

    it('should call fetchFromTransaction with correct parameters', async () => {
      const fetchFromTransactionSpy = vi
        .spyOn(service, 'fetchFromTransaction')
        .mockResolvedValue(undefined);
      vi.mocked(readdir).mockResolvedValue([]);

      await service.fetchFromTransactionToZip(
        mockTransactionHash,
        'output.zip'
      );

      expect(fetchFromTransactionSpy).toHaveBeenCalledWith(
        mockTransactionHash,
        '/tmp/elephant-cli-fetch-456'
      );
    });

    it('should add directories to ZIP with data prefix', async () => {
      vi.spyOn(service, 'fetchFromTransaction').mockResolvedValue(undefined);

      // Mock directory entries
      const mockEntries = [
        { name: 'bafybeiabc123', isDirectory: () => true, isFile: () => false },
        { name: 'bafybeiabc456', isDirectory: () => true, isFile: () => false },
      ] as any;
      vi.mocked(readdir).mockResolvedValue(mockEntries);

      const addDirectoryToZipSpy = vi
        .spyOn(service as any, 'addDirectoryToZip')
        .mockResolvedValue(undefined);

      await service.fetchFromTransactionToZip(
        mockTransactionHash,
        'output.zip'
      );

      expect(addDirectoryToZipSpy).toHaveBeenCalledWith(
        mockZip,
        '/tmp/elephant-cli-fetch-456/bafybeiabc123',
        'data/bafybeiabc123'
      );
      expect(addDirectoryToZipSpy).toHaveBeenCalledWith(
        mockZip,
        '/tmp/elephant-cli-fetch-456/bafybeiabc456',
        'data/bafybeiabc456'
      );
    });

    it('should add root files to ZIP under data folder', async () => {
      vi.spyOn(service, 'fetchFromTransaction').mockResolvedValue(undefined);

      // Mock file entries
      const mockEntries = [
        { name: 'rootfile.json', isDirectory: () => false, isFile: () => true },
      ] as any;
      vi.mocked(readdir).mockResolvedValue(mockEntries);

      await service.fetchFromTransactionToZip(
        mockTransactionHash,
        'output.zip'
      );

      expect(fsPromises.readFile).toHaveBeenCalledWith(
        '/tmp/elephant-cli-fetch-456/rootfile.json'
      );
      expect(mockZip.addFile).toHaveBeenCalledWith(
        'data/rootfile.json',
        Buffer.from('test content')
      );
    });

    it('should write ZIP file', async () => {
      vi.spyOn(service, 'fetchFromTransaction').mockResolvedValue(undefined);
      vi.mocked(readdir).mockResolvedValue([]);

      await service.fetchFromTransactionToZip(
        mockTransactionHash,
        'output.zip'
      );

      expect(mockZip.writeZip).toHaveBeenCalledWith('output.zip');
    });

    it('should clean up temporary directory on success', async () => {
      vi.spyOn(service, 'fetchFromTransaction').mockResolvedValue(undefined);
      vi.mocked(readdir).mockResolvedValue([]);

      await service.fetchFromTransactionToZip(
        mockTransactionHash,
        'output.zip'
      );

      expect(rm).toHaveBeenCalledWith('/tmp/elephant-cli-fetch-456', {
        recursive: true,
        force: true,
      });
    });

    it('should clean up temporary directory on fetchFromTransaction failure', async () => {
      vi.spyOn(service, 'fetchFromTransaction').mockRejectedValue(
        new Error('Transaction fetch failed')
      );

      await expect(
        service.fetchFromTransactionToZip(mockTransactionHash, 'output.zip')
      ).rejects.toThrow('Transaction fetch failed');

      expect(rm).toHaveBeenCalledWith('/tmp/elephant-cli-fetch-456', {
        recursive: true,
        force: true,
      });
    });

    it('should clean up temporary directory on ZIP creation failure', async () => {
      vi.spyOn(service, 'fetchFromTransaction').mockResolvedValue(undefined);
      vi.mocked(readdir).mockResolvedValue([]);
      mockZip.writeZip.mockImplementation(() => {
        throw new Error('ZIP write failed');
      });

      await expect(
        service.fetchFromTransactionToZip(mockTransactionHash, 'output.zip')
      ).rejects.toThrow('ZIP write failed');

      expect(rm).toHaveBeenCalledWith('/tmp/elephant-cli-fetch-456', {
        recursive: true,
        force: true,
      });
    });

    it('should handle cleanup failure gracefully', async () => {
      vi.spyOn(service, 'fetchFromTransaction').mockResolvedValue(undefined);
      vi.mocked(readdir).mockResolvedValue([]);
      vi.mocked(rm).mockRejectedValue(new Error('Cleanup failed'));

      // Should not throw even if cleanup fails
      await expect(
        service.fetchFromTransactionToZip(mockTransactionHash, 'output.zip')
      ).resolves.not.toThrow();

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to clean up temporary directory')
      );
    });

    it('should log appropriate messages', async () => {
      vi.spyOn(service, 'fetchFromTransaction').mockResolvedValue(undefined);
      vi.mocked(readdir).mockResolvedValue([]);

      await service.fetchFromTransactionToZip(
        mockTransactionHash,
        'output.zip'
      );

      expect(logger.info).toHaveBeenCalledWith('Creating ZIP file: output.zip');
      expect(logger.info).toHaveBeenCalledWith(
        'ZIP file created successfully: output.zip'
      );
    });
  });

  describe('addDirectoryToZip', () => {
    let mockZip: any;

    beforeEach(() => {
      mockZip = {
        addFile: vi.fn(),
      };
    });

    it('should recursively add files to ZIP', async () => {
      // Mock readdir to return mixed files and directories
      const mockEntries = [
        { name: 'file1.json', isDirectory: () => false, isFile: () => true },
        { name: 'subdir', isDirectory: () => true, isFile: () => false },
      ] as any;

      const mockSubEntries = [
        { name: 'file2.json', isDirectory: () => false, isFile: () => true },
      ] as any;

      vi.mocked(readdir)
        .mockResolvedValueOnce(mockEntries)
        .mockResolvedValueOnce(mockSubEntries);

      vi.mocked(fsPromises.readFile)
        .mockResolvedValueOnce(Buffer.from('content1'))
        .mockResolvedValueOnce(Buffer.from('content2'));

      await (service as any).addDirectoryToZip(
        mockZip,
        '/test/dir',
        'data/test'
      );

      expect(mockZip.addFile).toHaveBeenCalledWith(
        'data/test/file1.json',
        Buffer.from('content1')
      );
      expect(mockZip.addFile).toHaveBeenCalledWith(
        'data/test/subdir/file2.json',
        Buffer.from('content2')
      );
    });

    it('should normalize path separators for ZIP compatibility', async () => {
      const mockEntries = [
        { name: 'file.json', isDirectory: () => false, isFile: () => true },
      ] as any;

      vi.mocked(readdir).mockResolvedValue(mockEntries);
      vi.mocked(fsPromises.readFile).mockResolvedValue(Buffer.from('content'));

      // Test with Windows-style path separators
      const originalJoin = require('path').join;
      require('path').join = (...args: string[]) => args.join('\\');

      await (service as any).addDirectoryToZip(
        mockZip,
        'C:\\test\\dir',
        'data\\test'
      );

      // Verify that backslashes are converted to forward slashes
      expect(mockZip.addFile).toHaveBeenCalledWith(
        'data/test/file.json',
        Buffer.from('content')
      );

      // Restore original join
      require('path').join = originalJoin;
    });

    it('should handle empty directories', async () => {
      vi.mocked(readdir).mockResolvedValue([]);

      await (service as any).addDirectoryToZip(
        mockZip,
        '/empty/dir',
        'data/empty'
      );

      expect(mockZip.addFile).not.toHaveBeenCalled();
    });

    it('should log debug messages for added files', async () => {
      const mockEntries = [
        { name: 'file.json', isDirectory: () => false, isFile: () => true },
      ] as any;

      vi.mocked(readdir).mockResolvedValue(mockEntries);
      vi.mocked(fsPromises.readFile).mockResolvedValue(Buffer.from('content'));

      await (service as any).addDirectoryToZip(
        mockZip,
        '/test/dir',
        'data/test'
      );

      expect(logger.debug).toHaveBeenCalledWith(
        'Added to ZIP: data/test/file.json'
      );
    });
  });
});
