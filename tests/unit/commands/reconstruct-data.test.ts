import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
import { registerReconstructDataCommand } from '../../../src/commands/reconstruct-data.js';
import { IPFSReconstructorService } from '../../../src/services/ipfs-reconstructor.service.js';
import { logger } from '../../../src/utils/logger.js';
import * as progress from '../../../src/utils/progress.js';
import * as validation from '../../../src/utils/validation.js';

// Mock dependencies
vi.mock('../../../src/services/ipfs-reconstructor.service.js');
vi.mock('../../../src/utils/logger.js');
vi.mock('../../../src/utils/progress.js');
vi.mock('../../../src/utils/validation.js');

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
        'Reconstruct data tree from an IPFS CID, downloading all linked data'
      );

      const options = cmd?.options;
      expect(options).toHaveLength(2);
      expect(options?.[0].short).toBe('-g');
      expect(options?.[0].long).toBe('--gateway');
      expect(options?.[1].short).toBe('-o');
      expect(options?.[1].long).toBe('--output-dir');
    });
  });

  describe('command execution', () => {
    it('should reconstruct data successfully', async () => {
      const mockReconstructData = vi
        .fn()
        .mockResolvedValue(
          'data/data_QmWUnTmuodSYEuHVPgxtrARGra2VpzsusAp4FqT9FWobuU'
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
          'Data saved in: data/data_QmWUnTmuodSYEuHVPgxtrARGra2VpzsusAp4FqT9FWobuU'
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
  });
});
