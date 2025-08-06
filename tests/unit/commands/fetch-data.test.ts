import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
import { registerFetchDataCommand } from '../../../src/commands/fetch-data.js';
import { IPFSFetcherService } from '../../../src/services/ipfs-fetcher.service.js';
import { logger } from '../../../src/utils/logger.js';
import * as progress from '../../../src/utils/progress.js';
import * as validation from '../../../src/utils/validation.js';
import { isHexString } from 'ethers';

// Mock dependencies
vi.mock('../../../src/services/ipfs-fetcher.service.js');
vi.mock('../../../src/utils/logger.js');
vi.mock('../../../src/utils/progress.js');
vi.mock('../../../src/utils/validation.js');
vi.mock('ethers', () => ({
  isHexString: vi.fn(),
}));

describe('fetch-data command', () => {
  let program: Command;
  let mockSpinner: any;
  let mockProcess: any;

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock process.exit
    mockProcess = {
      exit: vi.fn(),
    };
    global.process = { ...process, exit: mockProcess.exit } as any;

    // Mock spinner
    mockSpinner = {
      start: vi.fn(),
      succeed: vi.fn(),
      fail: vi.fn(),
    };
    vi.mocked(progress.createSpinner).mockReturnValue(mockSpinner);

    // Mock validation
    vi.mocked(validation.isValidUrl).mockReturnValue(true);
    vi.mocked(validation.isValidCID).mockReturnValue(true);
    vi.mocked(isHexString).mockReturnValue(false);

    // Setup command
    program = new Command();
    program.exitOverride(); // Prevent actual process exit
    registerFetchDataCommand(program);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('command registration', () => {
    it('should register the command with correct options', () => {
      const cmd = program.commands.find((c) => c.name() === 'fetch-data');
      expect(cmd).toBeDefined();
      expect(cmd?.description()).toBe(
        'Fetch data tree from an IPFS CID or transaction hash, downloading all linked data'
      );

      const options = cmd?.options;
      expect(options).toHaveLength(3);
      expect(options?.[0].short).toBe('-g');
      expect(options?.[0].long).toBe('--gateway');
      expect(options?.[1].short).toBe('-o');
      expect(options?.[1].long).toBe('--output-zip');
      expect(options?.[2].short).toBe('-r');
      expect(options?.[2].long).toBe('--rpc-url');
    });
  });

  describe('command execution', () => {
    it('should fetch data successfully', async () => {
      const mockFetchDataToZip = vi.fn().mockResolvedValue(undefined);
      vi.mocked(IPFSFetcherService).mockImplementation(
        () =>
          ({
            fetchDataToZip: mockFetchDataToZip,
          }) as any
      );

      await program.parseAsync([
        'node',
        'test',
        'fetch-data',
        'QmWUnTmuodSYEuHVPgxtrARGra2VpzsusAp4FqT9FWobuU',
      ]);

      expect(mockSpinner.start).toHaveBeenCalledWith(
        'Initializing IPFS fetcher service...'
      );
      expect(mockSpinner.succeed).toHaveBeenCalledWith('Service initialized.');
      expect(mockSpinner.start).toHaveBeenCalledWith(
        'Starting fetch from CID: QmWUnTmuodSYEuHVPgxtrARGra2VpzsusAp4FqT9FWobuU'
      );
      expect(mockSpinner.succeed).toHaveBeenCalledWith('Data fetch complete!');

      expect(mockFetchDataToZip).toHaveBeenCalledWith(
        'QmWUnTmuodSYEuHVPgxtrARGra2VpzsusAp4FqT9FWobuU',
        'fetched-data.zip'
      );
      expect(vi.mocked(logger.log)).toHaveBeenCalledWith(
        expect.stringContaining('✓ Fetch successful!')
      );
      expect(vi.mocked(logger.log)).toHaveBeenCalledWith(
        expect.stringContaining(
          '📦 Fetched data is located in: fetched-data.zip'
        )
      );
    });

    it('should use custom gateway URL', async () => {
      const mockFetchDataToZip = vi.fn().mockResolvedValue(undefined);
      let capturedGatewayUrl: string | undefined;

      vi.mocked(IPFSFetcherService).mockImplementation(
        (gatewayUrl?: string) => {
          capturedGatewayUrl = gatewayUrl;
          return {
            fetchDataToZip: mockFetchDataToZip,
          } as any;
        }
      );

      await program.parseAsync([
        'node',
        'test',
        'fetch-data',
        'QmWUnTmuodSYEuHVPgxtrARGra2VpzsusAp4FqT9FWobuU',
        '--gateway',
        'https://custom.gateway.com/ipfs',
      ]);

      expect(capturedGatewayUrl).toBe('https://custom.gateway.com/ipfs');
    });

    it('should use custom output ZIP file', async () => {
      const mockFetchDataToZip = vi.fn().mockResolvedValue(undefined);
      vi.mocked(IPFSFetcherService).mockImplementation(
        () =>
          ({
            fetchDataToZip: mockFetchDataToZip,
          }) as any
      );

      await program.parseAsync([
        'node',
        'test',
        'fetch-data',
        'QmWUnTmuodSYEuHVPgxtrARGra2VpzsusAp4FqT9FWobuU',
        '--output-zip',
        'custom-output.zip',
      ]);

      expect(mockFetchDataToZip).toHaveBeenCalledWith(
        'QmWUnTmuodSYEuHVPgxtrARGra2VpzsusAp4FqT9FWobuU',
        'custom-output.zip'
      );
    });

    it('should validate gateway URL', async () => {
      vi.mocked(validation.isValidUrl).mockReturnValue(false);

      await program.parseAsync([
        'node',
        'test',
        'fetch-data',
        'QmWUnTmuodSYEuHVPgxtrARGra2VpzsusAp4FqT9FWobuU',
        '--gateway',
        'invalid-url',
      ]);

      expect(vi.mocked(logger.error)).toHaveBeenCalledWith(
        'Invalid IPFS Gateway URL: invalid-url'
      );
      expect(mockProcess.exit).toHaveBeenCalledWith(1);
    });

    it('should handle fetch errors', async () => {
      const error = new Error('Failed to fetch CID');
      const mockFetchDataToZip = vi.fn().mockRejectedValue(error);
      vi.mocked(IPFSFetcherService).mockImplementation(
        () =>
          ({
            fetchDataToZip: mockFetchDataToZip,
          }) as any
      );

      await program.parseAsync([
        'node',
        'test',
        'fetch-data',
        'QmWUnTmuodSYEuHVPgxtrARGra2VpzsusAp4FqT9FWobuU',
      ]);

      expect(mockSpinner.fail).toHaveBeenCalledWith('Fetch failed');
      expect(vi.mocked(logger.error)).toHaveBeenCalledWith(
        'Failed to fetch CID'
      );
      expect(mockProcess.exit).toHaveBeenCalledWith(1);
    });

    it('should handle non-Error exceptions', async () => {
      const mockFetchDataToZip = vi.fn().mockRejectedValue('String error');
      vi.mocked(IPFSFetcherService).mockImplementation(
        () =>
          ({
            fetchDataToZip: mockFetchDataToZip,
          }) as any
      );

      await program.parseAsync([
        'node',
        'test',
        'fetch-data',
        'QmWUnTmuodSYEuHVPgxtrARGra2VpzsusAp4FqT9FWobuU',
      ]);

      expect(mockSpinner.fail).toHaveBeenCalledWith('Fetch failed');
      expect(vi.mocked(logger.error)).toHaveBeenCalledWith('String error');
      expect(mockProcess.exit).toHaveBeenCalledWith(1);
    });

    it('should handle transaction hash input', async () => {
      const mockFetchFromTransactionToZip = vi
        .fn()
        .mockResolvedValue(undefined);
      vi.mocked(IPFSFetcherService).mockImplementation(
        () =>
          ({
            fetchDataToZip: vi.fn(),
            fetchFromTransactionToZip: mockFetchFromTransactionToZip,
          }) as any
      );

      // Mock isHexString to return true for transaction hash
      vi.mocked(isHexString).mockReturnValue(true);
      vi.mocked(validation.isValidCID).mockReturnValue(false);

      await program.parseAsync([
        'node',
        'test',
        'fetch-data',
        '0x1234567890123456789012345678901234567890123456789012345678901234',
      ]);

      expect(mockFetchFromTransactionToZip).toHaveBeenCalledWith(
        '0x1234567890123456789012345678901234567890123456789012345678901234',
        'fetched-data.zip'
      );
      expect(mockSpinner.succeed).toHaveBeenCalledWith(
        'Transaction data fetch complete!'
      );
    });

    it('should validate RPC URL when provided', async () => {
      vi.mocked(validation.isValidUrl).mockImplementation((url) => {
        return url !== 'invalid-rpc';
      });

      await program.parseAsync([
        'node',
        'test',
        'fetch-data',
        'QmWUnTmuodSYEuHVPgxtrARGra2VpzsusAp4FqT9FWobuU',
        '--rpc-url',
        'invalid-rpc',
      ]);

      expect(vi.mocked(logger.error)).toHaveBeenCalledWith(
        'Invalid RPC URL: invalid-rpc'
      );
      expect(mockProcess.exit).toHaveBeenCalledWith(1);
    });

    it('should throw error for invalid input', async () => {
      vi.mocked(isHexString).mockReturnValue(false);
      vi.mocked(validation.isValidCID).mockReturnValue(false);

      await program.parseAsync(['node', 'test', 'fetch-data', 'invalid-input']);

      expect(mockSpinner.fail).toHaveBeenCalledWith('Fetch failed');
      expect(vi.mocked(logger.error)).toHaveBeenCalledWith(
        'Input must be either a valid IPFS CID or a transaction hash (32 bytes hex string)'
      );
      expect(mockProcess.exit).toHaveBeenCalledWith(1);
    });
  });
});
