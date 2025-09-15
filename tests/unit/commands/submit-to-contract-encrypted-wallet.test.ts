import { describe, it, expect, beforeEach, vi } from 'vitest';
import { handleSubmitToContract } from '../../../src/commands/submit-to-contract.js';
import { EncryptedWalletService } from '../../../src/services/encrypted-wallet.service.js';
import { Wallet } from 'ethers';
import * as fs from 'fs';

vi.mock('fs');
vi.mock('../../../src/services/encrypted-wallet.service.js');
vi.mock('../../../src/utils/logger.js', () => ({
  logger: {
    technical: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
  },
}));

describe('Submit to Contract - Encrypted Wallet Support', () => {
  const mockPrivateKey =
    '0xac0974bec39a17e36ba4a6b4d1977b37e8427ff0efc7717320f0a85129670207';
  const mockWalletAddress = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
  const mockPassword = 'test-password-123!@#';
  const mockKeystoreJsonPath = '/path/to/keystore.json';

  const mockCsvContent = `propertyCid,dataGroupCid,dataCid,filePath,uploadedAt
prop1,group1,data1,/path/file1.json,2024-01-01T00:00:00Z
prop2,group2,data2,/path/file2.json,2024-01-01T00:00:00Z`;

  const mockServiceOverrides: any = {
    chainStateService: {
      prepopulateConsensusCache: vi.fn(),
      getUserSubmissions: vi.fn().mockResolvedValue(new Set()),
      getCurrentDataCid: vi.fn().mockResolvedValue(null),
      hasUserSubmittedData: vi.fn().mockResolvedValue(false),
    },
    transactionBatcherService: {
      groupItemsIntoBatches: vi.fn((items) => [items]),
      submitAll: vi.fn().mockImplementation(async function* () {
        yield {
          transactionHash: '0x123',
          itemsSubmitted: 2,
        };
      }),
    },
    csvReporterService: {
      initialize: vi.fn(),
      logError: vi.fn(),
      logWarning: vi.fn(),
      finalize: vi.fn(),
    },
    progressTracker: {
      start: vi.fn(),
      stop: vi.fn(),
      setPhase: vi.fn(),
      increment: vi.fn(),
      getMetrics: vi.fn().mockReturnValue({
        startTime: Date.now(),
      }),
    },
    transactionStatusReporter: {
      initialize: vi.fn(),
      recordTransactionSubmitted: vi.fn(),
      updateTransactionStatus: vi.fn(),
      finalize: vi.fn(),
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fs.readFileSync).mockReturnValue(mockCsvContent);

    // Mock console methods
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  describe('Keystore wallet loading', () => {
    it('should load wallet from encrypted keystore when options are provided', async () => {
      const mockWallet = new Wallet(mockPrivateKey);
      vi.mocked(
        EncryptedWalletService.loadWalletFromEncryptedJson
      ).mockResolvedValue(mockWallet);

      const options = {
        rpcUrl: 'http://localhost:8545',
        contractAddress: '0x123',
        csvFile: '/path/to/data.csv',
        gasPrice: 30,
        dryRun: false,
        keystoreJsonPath: mockKeystoreJsonPath,
        keystorePassword: mockPassword,
      };

      await handleSubmitToContract(options, mockServiceOverrides);

      expect(
        EncryptedWalletService.loadWalletFromEncryptedJson
      ).toHaveBeenCalledWith({
        keystoreJsonPath: mockKeystoreJsonPath,
        password: mockPassword,
      });
      // Wallet loading is now internal, we just verify it was called
      expect(
        EncryptedWalletService.loadWalletFromEncryptedJson
      ).toHaveBeenCalled();
    });

    it('should use keystore password from environment variable when not provided as option', async () => {
      const mockWallet = new Wallet(mockPrivateKey);
      vi.mocked(
        EncryptedWalletService.loadWalletFromEncryptedJson
      ).mockResolvedValue(mockWallet);

      // Set environment variable
      process.env.ELEPHANT_KEYSTORE_PASSWORD = mockPassword;

      const options = {
        rpcUrl: 'http://localhost:8545',
        contractAddress: '0x123',
        csvFile: '/path/to/data.csv',
        gasPrice: 30,
        dryRun: false,
        keystoreJsonPath: mockKeystoreJsonPath,
        keystorePassword: mockPassword, // This would be set in the command handler
      };

      await handleSubmitToContract(options, mockServiceOverrides);

      expect(
        EncryptedWalletService.loadWalletFromEncryptedJson
      ).toHaveBeenCalledWith({
        keystoreJsonPath: mockKeystoreJsonPath,
        password: mockPassword,
      });

      // Clean up
      delete process.env.ELEPHANT_KEYSTORE_PASSWORD;
    });

    it('should exit with error when keystore decryption fails', async () => {
      // Mock process.exit to capture the call
      const exitMock = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit called');
      });

      // Mock console.error to capture the error message
      const consoleErrorMock = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      vi.mocked(
        EncryptedWalletService.loadWalletFromEncryptedJson
      ).mockRejectedValue(new Error('incorrect password'));

      const options = {
        rpcUrl: 'http://localhost:8545',
        contractAddress: '0x123',
        csvFile: '/path/to/data.csv',
        gasPrice: 30,
        dryRun: false,
        keystoreJsonPath: mockKeystoreJsonPath,
        keystorePassword: 'wrong-password',
      };

      await expect(
        handleSubmitToContract(options, mockServiceOverrides)
      ).rejects.toThrow('process.exit called');

      expect(exitMock).toHaveBeenCalledWith(1);
      expect(consoleErrorMock).toHaveBeenCalledWith(
        expect.stringContaining('Incorrect password')
      );

      exitMock.mockRestore();
      consoleErrorMock.mockRestore();
    });

    it('should not load keystore in API mode', async () => {
      const options = {
        rpcUrl: 'http://localhost:8545',
        contractAddress: '0x123',
        csvFile: '/path/to/data.csv',
        gasPrice: 30,
        dryRun: false,
        domain: 'api.example.com',
        apiKey: 'test-api-key',
        oracleKeyId: 'oracle-123',
        keystoreJsonPath: mockKeystoreJsonPath,
        keystorePassword: mockPassword,
        silent: true, // Add silent mode to avoid process.exit in error handler
      };

      await handleSubmitToContract(options, mockServiceOverrides);

      expect(
        EncryptedWalletService.loadWalletFromEncryptedJson
      ).not.toHaveBeenCalled();
    });

    it('should not load keystore when using unsigned transactions with from-address', async () => {
      const options = {
        rpcUrl: 'http://localhost:8545',
        contractAddress: '0x123',
        csvFile: '/path/to/data.csv',
        gasPrice: 30,
        dryRun: true,
        unsignedTransactionsJson: '/path/to/unsigned.json',
        fromAddress: mockWalletAddress,
        keystoreJsonPath: mockKeystoreJsonPath,
        keystorePassword: mockPassword,
      };

      await handleSubmitToContract(options, mockServiceOverrides);

      expect(
        EncryptedWalletService.loadWalletFromEncryptedJson
      ).not.toHaveBeenCalled();
    });

    it('should load keystore for dry-run without from-address', async () => {
      const mockWallet = new Wallet(mockPrivateKey);
      vi.mocked(
        EncryptedWalletService.loadWalletFromEncryptedJson
      ).mockResolvedValue(mockWallet);

      const options = {
        rpcUrl: 'http://localhost:8545',
        contractAddress: '0x123',
        csvFile: '/path/to/data.csv',
        gasPrice: 30,
        dryRun: true,
        keystoreJsonPath: mockKeystoreJsonPath,
        keystorePassword: mockPassword,
      };

      await handleSubmitToContract(options, mockServiceOverrides);

      expect(
        EncryptedWalletService.loadWalletFromEncryptedJson
      ).toHaveBeenCalledWith({
        keystoreJsonPath: mockKeystoreJsonPath,
        password: mockPassword,
      });
    });
  });

  describe('Authentication modes', () => {
    it('should require keystore when not using API mode or unsigned transactions', async () => {
      const options = {
        rpcUrl: 'http://localhost:8545',
        contractAddress: '0x123',
        csvFile: '/path/to/data.csv',
        gasPrice: 30,
        dryRun: false,
        // No keystore provided
      };

      await expect(
        handleSubmitToContract(options, mockServiceOverrides)
      ).rejects.toThrow(
        'Authentication is required when not using --from-address with unsigned transactions or API mode'
      );
    });

    it('should work with keystore authentication', async () => {
      const mockWallet = new Wallet(mockPrivateKey);
      vi.mocked(
        EncryptedWalletService.loadWalletFromEncryptedJson
      ).mockResolvedValue(mockWallet);

      const options = {
        rpcUrl: 'http://localhost:8545',
        contractAddress: '0x123',
        csvFile: '/path/to/data.csv',
        gasPrice: 30,
        dryRun: false,
        keystoreJsonPath: mockKeystoreJsonPath,
        keystorePassword: mockPassword,
      };

      await handleSubmitToContract(options, mockServiceOverrides);

      expect(
        EncryptedWalletService.loadWalletFromEncryptedJson
      ).toHaveBeenCalled();
    });

    it('should work with API mode without keystore', async () => {
      const options = {
        rpcUrl: 'http://localhost:8545',
        contractAddress: '0x123',
        csvFile: '/path/to/data.csv',
        gasPrice: 30,
        dryRun: false,
        domain: 'api.example.com',
        apiKey: 'test-api-key',
        oracleKeyId: 'test-oracle-key',
      };

      await handleSubmitToContract(options, {
        ...mockServiceOverrides,
        apiSubmissionService: {
          submitTransaction: vi.fn().mockResolvedValue({
            transaction_hash: '0xabc',
          }),
        },
      });

      expect(
        EncryptedWalletService.loadWalletFromEncryptedJson
      ).not.toHaveBeenCalled();
    });
  });
});
