import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
import { registerReconstructDataCommand } from '../../../src/commands/reconstruct-data.js';
import { IPFSReconstructorService } from '../../../src/services/ipfs-reconstructor.service.js';
import { logger } from '../../../src/utils/logger.js';
import * as progress from '../../../src/utils/progress.js';
import * as validation from '../../../src/utils/validation.js';
import { isHexString } from 'ethers';

// Mock dependencies
vi.mock('../../../src/services/ipfs-reconstructor.service.js');
vi.mock('../../../src/utils/logger.js');
vi.mock('../../../src/utils/progress.js');
vi.mock('../../../src/utils/validation.js');
vi.mock('ethers', () => ({
  isHexString: vi.fn(),
}));

describe('reconstruct-data command', () => {
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
    registerReconstructDataCommand(program);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('command registration', () => {
    it('should register the command with correct options', () => {
      const cmd = program.commands.find((c) => c.name() === 'reconstruct-data');
      expect(cmd).toBeDefined();
      expect(cmd?.description()).toBe(
        'Reconstruct data tree from an IPFS CID or transaction hash, downloading all linked data'
      );

      const options = cmd?.options;
      expect(options).toHaveLength(3);
      expect(options?.[0].short).toBe('-g');
      expect(options?.[0].long).toBe('--gateway');
      expect(options?.[1].short).toBe('-o');
      expect(options?.[1].long).toBe('--output-dir');
      expect(options?.[2].short).toBe('-r');
      expect(options?.[2].long).toBe('--rpc-url');
    });
  });

  describe('command execution', () => {
    it('should reconstruct data successfully', async () => {
      const mockReconstructData = vi
        .fn()
        .mockResolvedValue(
          'data/QmWUnTmuodSYEuHVPgxtrARGra2VpzsusAp4FqT9FWobuU'
        );
      vi.mocked(IPFSReconstructorService).mockImplementation(
        () =>
          ({
            reconstructData: mockReconstructData,
          }) as any
      );

      await program.parseAsync([
        'node',
        'test',
        'reconstruct-data',
        'QmWUnTmuodSYEuHVPgxtrARGra2VpzsusAp4FqT9FWobuU',
      ]);

      expect(mockSpinner.start).toHaveBeenCalledWith(
        'Initializing IPFS reconstructor service...'
      );
      expect(mockSpinner.succeed).toHaveBeenCalledWith('Service initialized.');
      expect(mockSpinner.start).toHaveBeenCalledWith(
        'Starting reconstruction from CID: QmWUnTmuodSYEuHVPgxtrARGra2VpzsusAp4FqT9FWobuU'
      );
      expect(mockSpinner.succeed).toHaveBeenCalledWith(
        'Data reconstruction complete!'
      );

      expect(mockReconstructData).toHaveBeenCalledWith(
        'QmWUnTmuodSYEuHVPgxtrARGra2VpzsusAp4FqT9FWobuU',
        'data'
      );
      expect(vi.mocked(logger.log)).toHaveBeenCalledWith(
        expect.stringContaining('✓ Reconstruction successful!')
      );
      expect(vi.mocked(logger.log)).toHaveBeenCalledWith(
        expect.stringContaining(
          'Data saved in: data/QmWUnTmuodSYEuHVPgxtrARGra2VpzsusAp4FqT9FWobuU'
        )
      );
    });

    it('should use custom gateway URL', async () => {
      const mockReconstructData = vi
        .fn()
        .mockResolvedValue('output/data_QmTest');
      let capturedGatewayUrl: string | undefined;

      vi.mocked(IPFSReconstructorService).mockImplementation(
        (gatewayUrl: string) => {
          capturedGatewayUrl = gatewayUrl;
          return {
            reconstructData: mockReconstructData,
          } as any;
        }
      );

      await program.parseAsync([
        'node',
        'test',
        'reconstruct-data',
        'QmWUnTmuodSYEuHVPgxtrARGra2VpzsusAp4FqT9FWobuU',
        '--gateway',
        'https://custom.gateway.com/ipfs',
      ]);

      expect(capturedGatewayUrl).toBe('https://custom.gateway.com/ipfs');
    });

    it('should use custom output directory', async () => {
      const mockReconstructData = vi
        .fn()
        .mockResolvedValue(
          'custom-output/data_QmWUnTmuodSYEuHVPgxtrARGra2VpzsusAp4FqT9FWobuU'
        );
      vi.mocked(IPFSReconstructorService).mockImplementation(
        () =>
          ({
            reconstructData: mockReconstructData,
          }) as any
      );

      await program.parseAsync([
        'node',
        'test',
        'reconstruct-data',
        'QmWUnTmuodSYEuHVPgxtrARGra2VpzsusAp4FqT9FWobuU',
        '--output-dir',
        'custom-output',
      ]);

      expect(mockReconstructData).toHaveBeenCalledWith(
        'QmWUnTmuodSYEuHVPgxtrARGra2VpzsusAp4FqT9FWobuU',
        'custom-output'
      );
    });

    it('should validate gateway URL', async () => {
      vi.mocked(validation.isValidUrl).mockReturnValue(false);

      await program.parseAsync([
        'node',
        'test',
        'reconstruct-data',
        'QmWUnTmuodSYEuHVPgxtrARGra2VpzsusAp4FqT9FWobuU',
        '--gateway',
        'invalid-url',
      ]);

      expect(vi.mocked(logger.error)).toHaveBeenCalledWith(
        'Invalid IPFS Gateway URL: invalid-url'
      );
      expect(mockProcess.exit).toHaveBeenCalledWith(1);
    });

    it('should handle reconstruction errors', async () => {
      const error = new Error('Failed to fetch CID');
      const mockReconstructData = vi.fn().mockRejectedValue(error);
      vi.mocked(IPFSReconstructorService).mockImplementation(
        () =>
          ({
            reconstructData: mockReconstructData,
          }) as any
      );

      await program.parseAsync([
        'node',
        'test',
        'reconstruct-data',
        'QmWUnTmuodSYEuHVPgxtrARGra2VpzsusAp4FqT9FWobuU',
      ]);

      expect(mockSpinner.fail).toHaveBeenCalledWith('Reconstruction failed');
      expect(vi.mocked(logger.error)).toHaveBeenCalledWith(
        'Failed to fetch CID'
      );
      expect(mockProcess.exit).toHaveBeenCalledWith(1);
    });

    it('should handle non-Error exceptions', async () => {
      const mockReconstructData = vi.fn().mockRejectedValue('String error');
      vi.mocked(IPFSReconstructorService).mockImplementation(
        () =>
          ({
            reconstructData: mockReconstructData,
          }) as any
      );

      await program.parseAsync([
        'node',
        'test',
        'reconstruct-data',
        'QmWUnTmuodSYEuHVPgxtrARGra2VpzsusAp4FqT9FWobuU',
      ]);

      expect(mockSpinner.fail).toHaveBeenCalledWith('Reconstruction failed');
      expect(vi.mocked(logger.error)).toHaveBeenCalledWith('String error');
      expect(mockProcess.exit).toHaveBeenCalledWith(1);
    });

    it('should handle transaction hash input', async () => {
      const mockReconstructFromTransaction = vi
        .fn()
        .mockResolvedValue(undefined);
      vi.mocked(IPFSReconstructorService).mockImplementation(
        () =>
          ({
            reconstructData: vi.fn(),
            reconstructFromTransaction: mockReconstructFromTransaction,
          }) as any
      );

      // Mock isHexString to return true for transaction hash
      vi.mocked(isHexString).mockReturnValue(true);
      vi.mocked(validation.isValidCID).mockReturnValue(false);

      await program.parseAsync([
        'node',
        'test',
        'reconstruct-data',
        '0x1234567890123456789012345678901234567890123456789012345678901234',
      ]);

      expect(mockReconstructFromTransaction).toHaveBeenCalledWith(
        '0x1234567890123456789012345678901234567890123456789012345678901234',
        'data'
      );
      expect(mockSpinner.succeed).toHaveBeenCalledWith(
        'Transaction data reconstruction complete!'
      );
    });

    it('should validate RPC URL when provided', async () => {
      vi.mocked(validation.isValidUrl).mockImplementation((url) => {
        return url !== 'invalid-rpc';
      });

      await program.parseAsync([
        'node',
        'test',
        'reconstruct-data',
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

      await program.parseAsync([
        'node',
        'test',
        'reconstruct-data',
        'invalid-input',
      ]);

      expect(mockSpinner.fail).toHaveBeenCalledWith('Reconstruction failed');
      expect(vi.mocked(logger.error)).toHaveBeenCalledWith(
        'Input must be either a valid IPFS CID or a transaction hash (32 bytes hex string)'
      );
      expect(mockProcess.exit).toHaveBeenCalledWith(1);
    });
  });
});
