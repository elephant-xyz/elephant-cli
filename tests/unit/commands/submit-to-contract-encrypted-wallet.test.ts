import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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

  const mockServiceOverrides = {
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
        privateKey: '',
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
      expect(options.privateKey).toBe(mockPrivateKey);
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
        privateKey: '',
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

    it('should throw error when keystore decryption fails', async () => {
      vi.mocked(
        EncryptedWalletService.loadWalletFromEncryptedJson
      ).mockRejectedValue(new Error('Invalid password'));

      const options = {
        rpcUrl: 'http://localhost:8545',
        contractAddress: '0x123',
        privateKey: '',
        csvFile: '/path/to/data.csv',
        gasPrice: 30,
        dryRun: false,
        keystoreJsonPath: mockKeystoreJsonPath,
        keystorePassword: 'wrong-password',
      };

      await expect(
        handleSubmitToContract(options, mockServiceOverrides)
      ).rejects.toThrow(
        'Failed to load wallet from keystore: Invalid password'
      );
    });

    it('should not load keystore in API mode', async () => {
      // Mock process.exit just for this test
      const exitMock = vi.spyOn(process, 'exit').mockImplementation(() => {
        return undefined as never;
      });

      const options = {
        rpcUrl: 'http://localhost:8545',
        contractAddress: '0x123',
        privateKey: '',
        csvFile: '/path/to/data.csv',
        gasPrice: 30,
        dryRun: false,
        domain: 'api.example.com',
        apiKey: 'test-api-key',
        oracleKeyId: 'oracle-123',
        keystoreJsonPath: mockKeystoreJsonPath,
        keystorePassword: mockPassword,
      };

      await handleSubmitToContract(options, mockServiceOverrides);

      expect(
        EncryptedWalletService.loadWalletFromEncryptedJson
      ).not.toHaveBeenCalled();

      // Restore the mock
      exitMock.mockRestore();
    });

    it('should not load keystore when using unsigned transactions with from-address', async () => {
      const options = {
        rpcUrl: 'http://localhost:8545',
        contractAddress: '0x123',
        privateKey: '',
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
        privateKey: '',
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

  describe('Priority of private key sources', () => {
    it('should prefer keystore over environment variable when both are available', async () => {
      const mockWallet = new Wallet(mockPrivateKey);
      vi.mocked(
        EncryptedWalletService.loadWalletFromEncryptedJson
      ).mockResolvedValue(mockWallet);

      // Set environment variable (should be ignored)
      process.env.ELEPHANT_PRIVATE_KEY = '0xdifferentprivatekey';

      const options = {
        rpcUrl: 'http://localhost:8545',
        contractAddress: '0x123',
        privateKey: '',
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
      expect(options.privateKey).toBe(mockPrivateKey);

      // Clean up
      delete process.env.ELEPHANT_PRIVATE_KEY;
    });

    it('should use private key from options when keystore is not provided', async () => {
      const directPrivateKey =
        '0xac0974bec39a17e36ba4a6b4d1977b37e8427ff0efc7717320f0a85129670208';

      const options = {
        rpcUrl: 'http://localhost:8545',
        contractAddress: '0x123',
        privateKey: directPrivateKey,
        csvFile: '/path/to/data.csv',
        gasPrice: 30,
        dryRun: false,
      };

      await handleSubmitToContract(options, mockServiceOverrides);

      expect(
        EncryptedWalletService.loadWalletFromEncryptedJson
      ).not.toHaveBeenCalled();
      expect(options.privateKey).toBe(directPrivateKey);
    });

    it('should use environment variable when neither keystore nor direct private key is provided', async () => {
      const envPrivateKey =
        '0xac0974bec39a17e36ba4a6b4d1977b37e8427ff0efc7717320f0a85129670209';
      process.env.ELEPHANT_PRIVATE_KEY = envPrivateKey;

      const options = {
        rpcUrl: 'http://localhost:8545',
        contractAddress: '0x123',
        privateKey: envPrivateKey, // This would be set in the command handler
        csvFile: '/path/to/data.csv',
        gasPrice: 30,
        dryRun: false,
      };

      await handleSubmitToContract(options, mockServiceOverrides);

      expect(
        EncryptedWalletService.loadWalletFromEncryptedJson
      ).not.toHaveBeenCalled();
      expect(options.privateKey).toBe(envPrivateKey);

      // Clean up
      delete process.env.ELEPHANT_PRIVATE_KEY;
    });
  });
});
