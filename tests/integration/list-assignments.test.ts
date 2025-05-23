import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { listAssignments } from '../../src/commands/list-assignments';
import { BlockchainService } from '../../src/services/blockchain.service';
import { IPFSService } from '../../src/services/ipfs.service';
import { logger } from '../../src/utils/logger';
import * as validation from '../../src/utils/validation';
import * as progress from '../../src/utils/progress';
import { CommandOptions, ElephantAssignment, DownloadResult } from '../../src/types';

// Mock all dependencies
jest.mock('../../src/services/blockchain.service');
jest.mock('../../src/services/ipfs.service');
jest.mock('../../src/utils/logger');
jest.mock('../../src/utils/validation');
jest.mock('../../src/utils/progress');

describe('listAssignments integration', () => {
  let mockBlockchainService: jest.Mocked<BlockchainService>;
  let mockIPFSService: jest.Mocked<IPFSService>;
  let mockSpinner: any;
  let processExitSpy: jest.SpiedFunction<typeof process.exit>;
  let consoleLogSpy: jest.SpiedFunction<typeof console.log>;
  let processStdoutWriteSpy: jest.SpiedFunction<typeof process.stdout.write>;

  const defaultOptions: CommandOptions = {
    elephant: '0x0e44bfab0f7e1943cF47942221929F898E181505',
    contract: '0x79D5046e34D4A56D357E12636A18da6eaEfe0586',
    rpc: 'https://rpc.therpc.io/polygon',
    gateway: 'https://gateway.pinata.cloud/ipfs/',
    fromBlock: '71875850',
    downloadDir: './downloads',
  };

  const mockAssignments: ElephantAssignment[] = [
    {
      cid: 'QmWUnTmuodSYEuHVPgxtrARGra2VpzsusAp4FqT9FWobuU',
      elephant: '0x0e44bfab0f7e1943cF47942221929F898E181505',
      blockNumber: 71875870,
      transactionHash: '0xhash1',
    },
    {
      cid: 'QmSecondCID',
      elephant: '0x0e44bfab0f7e1943cF47942221929F898E181505',
      blockNumber: 71875871,
      transactionHash: '0xhash2',
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup process mocks
    processExitSpy = jest.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit called');
    }) as any);
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    processStdoutWriteSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

    // Setup validation mocks
    (validation.isValidAddress as unknown as jest.Mock).mockReturnValue(true);
    (validation.isValidUrl as unknown as jest.Mock).mockReturnValue(true);

    // Setup spinner mock
    mockSpinner = {
      start: jest.fn().mockReturnThis(),
      succeed: jest.fn().mockReturnThis(),
      fail: jest.fn().mockReturnThis(),
    };
    (progress.createSpinner as unknown as jest.Mock).mockReturnValue(mockSpinner);

    // Setup service mocks
    mockBlockchainService = {
      getCurrentBlock: jest.fn(),
      getElephantAssignedEvents: jest.fn(),
    } as any;

    mockIPFSService = {
      downloadBatch: jest.fn(),
    } as any;

    (BlockchainService as unknown as jest.Mock).mockImplementation(() => mockBlockchainService);
    (IPFSService as unknown as jest.Mock).mockImplementation(() => mockIPFSService);
  });

  afterEach(() => {
    processExitSpy.mockRestore();
    consoleLogSpy.mockRestore();
    processStdoutWriteSpy.mockRestore();
  });

  describe('successful flow', () => {
    beforeEach(() => {
      mockBlockchainService.getCurrentBlock.mockResolvedValue(71875900);
      mockBlockchainService.getElephantAssignedEvents.mockResolvedValue(mockAssignments);
      mockIPFSService.downloadBatch.mockResolvedValue([
        { cid: mockAssignments[0].cid, success: true, path: './downloads/QmWUnTmuodSYEuHVPgxtrARGra2VpzsusAp4FqT9FWobuU' },
        { cid: mockAssignments[1].cid, success: true, path: './downloads/QmSecondCID' },
      ]);
    });

    it('should complete full flow successfully', async () => {
      await listAssignments(defaultOptions);

      // Verify blockchain service calls
      expect(mockBlockchainService.getCurrentBlock).toHaveBeenCalledTimes(1);
      expect(mockBlockchainService.getElephantAssignedEvents).toHaveBeenCalledWith(
        defaultOptions.elephant,
        71875850,
        71875900
      );

      // Verify IPFS service calls
      expect(mockIPFSService.downloadBatch).toHaveBeenCalledWith(
        mockAssignments,
        './downloads',
        expect.any(Function)
      );

      // Verify spinners
      expect(progress.createSpinner).toHaveBeenCalledWith('Fetching current block number...');
      expect(progress.createSpinner).toHaveBeenCalledWith('Querying blocks 71875850 to 71875900...');
      expect(mockSpinner.succeed).toHaveBeenCalledWith('Current block: 71875900');
      expect(mockSpinner.succeed).toHaveBeenCalledWith('Found 2 assignments');

      // Verify logger calls
      expect(logger.info).toHaveBeenCalledWith('Starting downloads...');
      expect(logger.success).toHaveBeenCalledWith('Downloads complete! 2 succeeded, 0 failed.');
      expect(logger.info).toHaveBeenCalledWith('Summary:');
    });

    it('should display assignment details', async () => {
      await listAssignments(defaultOptions);

      expect(consoleLogSpy).toHaveBeenCalledWith('\nAssignment 1:');
      expect(consoleLogSpy).toHaveBeenCalledWith(`  CID: ${mockAssignments[0].cid}`);
      expect(consoleLogSpy).toHaveBeenCalledWith(`  Block: ${mockAssignments[0].blockNumber}`);
      expect(consoleLogSpy).toHaveBeenCalledWith(`  Transaction: ${mockAssignments[0].transactionHash}`);
    });

    it('should show download progress', async () => {
      let progressCallback: Function;
      mockIPFSService.downloadBatch.mockImplementation(async (assignments, dir, onProgress) => {
        progressCallback = onProgress!;
        // Simulate progress
        onProgress!(1, 2);
        onProgress!(2, 2);
        return [
          { cid: mockAssignments[0].cid, success: true, path: './downloads/file1' },
          { cid: mockAssignments[1].cid, success: true, path: './downloads/file2' },
        ];
      });

      await listAssignments(defaultOptions);

      expect(processStdoutWriteSpy).toHaveBeenCalledWith('\rDownloaded 1 of 2 files...');
      expect(processStdoutWriteSpy).toHaveBeenCalledWith('\rDownloaded 2 of 2 files...');
      expect(processStdoutWriteSpy).toHaveBeenCalledWith('\r\x1b[K'); // Clear line
    });
  });

  describe('validation errors', () => {
    it('should exit on invalid elephant address', async () => {
      (validation.isValidAddress as unknown as jest.Mock).mockReturnValueOnce(false);

      await expect(listAssignments(defaultOptions)).rejects.toThrow('process.exit called');

      expect(logger.error).toHaveBeenCalledWith('Invalid elephant address');
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('should exit on invalid contract address', async () => {
      (validation.isValidAddress as unknown as jest.Mock)
        .mockReturnValueOnce(true) // elephant address
        .mockReturnValueOnce(false); // contract address

      await expect(listAssignments(defaultOptions)).rejects.toThrow('process.exit called');

      expect(logger.error).toHaveBeenCalledWith('Invalid contract address');
    });

    it('should exit on invalid RPC URL', async () => {
      (validation.isValidUrl as unknown as jest.Mock).mockReturnValueOnce(false);

      await expect(listAssignments(defaultOptions)).rejects.toThrow('process.exit called');

      expect(logger.error).toHaveBeenCalledWith('Invalid RPC URL');
    });

    it('should exit on invalid gateway URL', async () => {
      (validation.isValidUrl as unknown as jest.Mock)
        .mockReturnValueOnce(true) // RPC URL
        .mockReturnValueOnce(false); // Gateway URL

      await expect(listAssignments(defaultOptions)).rejects.toThrow('process.exit called');

      expect(logger.error).toHaveBeenCalledWith('Invalid IPFS gateway URL');
    });
  });

  describe('no assignments found', () => {
    it('should handle empty assignment list gracefully', async () => {
      mockBlockchainService.getCurrentBlock.mockResolvedValue(71875900);
      mockBlockchainService.getElephantAssignedEvents.mockResolvedValue([]);

      await listAssignments(defaultOptions);

      expect(logger.info).toHaveBeenCalledWith(
        'No assignments found for this elephant address in the specified block range.'
      );
      expect(mockIPFSService.downloadBatch).not.toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Completed in'));
    });
  });

  describe('download failures', () => {
    it('should handle partial download failures', async () => {
      mockBlockchainService.getCurrentBlock.mockResolvedValue(71875900);
      mockBlockchainService.getElephantAssignedEvents.mockResolvedValue(mockAssignments);
      
      const downloadResults: DownloadResult[] = [
        { cid: mockAssignments[0].cid, success: true, path: './downloads/file1' },
        { cid: mockAssignments[1].cid, success: false, error: new Error('IPFS timeout') },
      ];
      mockIPFSService.downloadBatch.mockResolvedValue(downloadResults);

      await listAssignments(defaultOptions);

      expect(logger.success).toHaveBeenCalledWith(
        `Downloaded ${mockAssignments[0].cid} to ./downloads/file1`
      );
      expect(logger.error).toHaveBeenCalledWith(
        `Failed to download ${mockAssignments[1].cid}: IPFS timeout`
      );
      expect(logger.success).toHaveBeenCalledWith('Downloads complete! 1 succeeded, 1 failed.');
    });

    it('should handle all downloads failing', async () => {
      mockBlockchainService.getCurrentBlock.mockResolvedValue(71875900);
      mockBlockchainService.getElephantAssignedEvents.mockResolvedValue(mockAssignments);
      
      const downloadResults: DownloadResult[] = mockAssignments.map(a => ({
        cid: a.cid,
        success: false,
        error: new Error('Network error'),
      }));
      mockIPFSService.downloadBatch.mockResolvedValue(downloadResults);

      await listAssignments(defaultOptions);

      expect(logger.success).toHaveBeenCalledWith('Downloads complete! 0 succeeded, 2 failed.');
    });
  });

  describe('blockchain errors', () => {
    it('should handle RPC connection errors', async () => {
      const networkError = new Error('Network error');
      (networkError as any).code = 'NETWORK_ERROR';
      mockBlockchainService.getCurrentBlock.mockRejectedValue(networkError);

      await expect(listAssignments(defaultOptions)).rejects.toThrow('process.exit called');

      expect(logger.error).toHaveBeenCalledWith(
        'Failed to connect to RPC endpoint. Please check your RPC URL and internet connection.'
      );
    });

    it('should handle server errors', async () => {
      const serverError = new Error('Server error');
      (serverError as any).code = 'SERVER_ERROR';
      mockBlockchainService.getCurrentBlock.mockRejectedValue(serverError);

      await expect(listAssignments(defaultOptions)).rejects.toThrow('process.exit called');

      expect(logger.error).toHaveBeenCalledWith(
        'Failed to connect to RPC endpoint. Please check your RPC URL and internet connection.'
      );
    });

    it('should handle invalid address errors', async () => {
      const addressError = new Error('invalid address or ENS name');
      mockBlockchainService.getCurrentBlock.mockRejectedValue(addressError);

      await expect(listAssignments(defaultOptions)).rejects.toThrow('process.exit called');

      expect(logger.error).toHaveBeenCalledWith('Invalid contract or elephant address format.');
    });

    it('should handle generic errors', async () => {
      const genericError = new Error('Something went wrong');
      mockBlockchainService.getCurrentBlock.mockRejectedValue(genericError);

      await expect(listAssignments(defaultOptions)).rejects.toThrow('process.exit called');

      expect(logger.error).toHaveBeenCalledWith('Error: Something went wrong');
    });
  });

  describe('fromBlock parameter handling', () => {
    it('should use default fromBlock of 0 when not provided', async () => {
      const optionsWithoutFromBlock = { ...defaultOptions };
      delete optionsWithoutFromBlock.fromBlock;

      mockBlockchainService.getCurrentBlock.mockResolvedValue(71875900);
      mockBlockchainService.getElephantAssignedEvents.mockResolvedValue([]);

      await listAssignments(optionsWithoutFromBlock);

      expect(mockBlockchainService.getElephantAssignedEvents).toHaveBeenCalledWith(
        defaultOptions.elephant,
        0,
        71875900
      );
    });

    it('should parse fromBlock as integer', async () => {
      const optionsWithStringFromBlock = {
        ...defaultOptions,
        fromBlock: '12345',
      };

      mockBlockchainService.getCurrentBlock.mockResolvedValue(71875900);
      mockBlockchainService.getElephantAssignedEvents.mockResolvedValue([]);

      await listAssignments(optionsWithStringFromBlock);

      expect(mockBlockchainService.getElephantAssignedEvents).toHaveBeenCalledWith(
        defaultOptions.elephant,
        12345,
        71875900
      );
    });
  });

  describe('summary statistics', () => {
    it('should display correct summary for successful downloads', async () => {
      mockBlockchainService.getCurrentBlock.mockResolvedValue(71875900);
      mockBlockchainService.getElephantAssignedEvents.mockResolvedValue(mockAssignments);
      mockIPFSService.downloadBatch.mockResolvedValue([
        { cid: mockAssignments[0].cid, success: true, path: './downloads/file1' },
        { cid: mockAssignments[1].cid, success: true, path: './downloads/file2' },
      ]);

      await listAssignments(defaultOptions);

      expect(consoleLogSpy).toHaveBeenCalledWith('\n' + '='.repeat(50));
      expect(logger.info).toHaveBeenCalledWith('  Total assignments found: 2');
      expect(logger.info).toHaveBeenCalledWith('  Files downloaded: 2');
      expect(logger.info).toHaveBeenCalledWith('  Download failures: 0');
      expect(logger.info).toHaveBeenCalledWith('  Blocks scanned: 51');
      expect(logger.info).toHaveBeenCalledWith(expect.stringMatching(/  Execution time: \d+\.\d+ seconds/));
      expect(consoleLogSpy).toHaveBeenCalledWith('='.repeat(50));
    });
  });
});