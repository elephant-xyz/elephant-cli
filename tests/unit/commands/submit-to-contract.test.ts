import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import {
  handleSubmitToContract,
  SubmitToContractCommandOptions,
} from '../../../src/commands/submit-to-contract.js';
import { ChainStateService } from '../../../src/services/chain-state.service.js';
import { TransactionBatcherService } from '../../../src/services/transaction-batcher.service.js';
import { CsvReporterService } from '../../../src/services/csv-reporter.service.js';
import { UnsignedTransactionJsonService } from '../../../src/services/unsigned-transaction-json.service.js';
import { SimpleProgress } from '../../../src/utils/simple-progress.js';
import { EncryptedWalletService } from '../../../src/services/encrypted-wallet.service.js';
import { TransactionStatusReporterService } from '../../../src/services/transaction-status-reporter.service.js';

vi.mock('fs', () => ({
  ...vi.importActual('fs'),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  existsSync: vi.fn().mockReturnValue(true),
}));

vi.mock('../../../src/services/transaction-batcher.service.js');
vi.mock('../../../src/services/chain-state.service.js');
vi.mock('../../../src/services/unsigned-transaction-json.service.js');
vi.mock('../../../src/services/transaction-status-reporter.service.js');

vi.mock('ethers', async () => {
  const actual = await vi.importActual('ethers');
  return {
    ...actual,
    Wallet: vi.fn().mockImplementation(() => ({
      address: '0x742d35Cc6634C0532925a3b844Bc9e7595f89ce0',
      privateKey:
        '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
    })),
  };
});

vi.mock('../../../src/services/encrypted-wallet.service.js');

describe('SubmitToContractCommand', () => {
  const mockOptions: SubmitToContractCommandOptions = {
    rpcUrl: 'https://test-rpc.com',
    contractAddress: '0x1234567890123456789012345678901234567890',
    keystoreJsonPath: '/path/to/keystore.json',
    keystorePassword: 'testPassword123',
    csvFile: 'test-input.csv',
    transactionBatchSize: 2,
    gasPrice: 30,
    dryRun: false,
    checkEligibility: false,
  };

  const mockCsvContent = `propertyCid,dataGroupCid,dataCid,filePath,uploadedAt
bafkreigpfi4pqur43wj3x2dwm43hnbtrxabgwsi3hobzbtqrs3iytohevu,bafkreigpfi4pqur43wj3x2dwm43hnbtrxabgwsi3hobzbtqrs3iytohevu,bafkreigpfi4pqur43wj3x2dwm43hnbtrxabgwsi3hobzbtqrs3iytohevu,"/test/property1/dataGroup1.json",2024-01-01T00:00:00Z
bafkreigd6yhp5dfcdrtfubtdq76cnstxehqvpjgmrpuhj7jnwtf3syx3ma,bafkreigd6yhp5dfcdrtfubtdq76cnstxehqvpjgmrpuhj7jnwtf3syx3ma,bafkreigd6yhp5dfcdrtfubtdq76cnstxehqvpjgmrpuhj7jnwtf3syx3ma,"/test/property2/dataGroup2.json",2024-01-01T00:01:00Z
bafkreiac4j3s4xhz2ej6qcz6w2xjrcqyhqpmlc5u6l4jy4yk7vfqktkvr4,bafkreiac4j3s4xhz2ej6qcz6w2xjrcqyhqpmlc5u6l4jy4yk7vfqktkvr4,bafkreiac4j3s4xhz2ej6qcz6w2xjrcqyhqpmlc5u6l4jy4yk7vfqktkvr4,"/test/property3/dataGroup3.json",2024-01-01T00:02:00Z`;

  let mockCsvReporterService: CsvReporterService;
  let mockProgressTracker: SimpleProgress;
  let mockChainStateService: ChainStateService;
  let mockUnsignedTransactionJsonService: UnsignedTransactionJsonService;

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock process.exit to prevent actual process termination
    vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });

    // Mock EncryptedWalletService
    vi.mocked(
      EncryptedWalletService.loadWalletFromEncryptedJson
    ).mockResolvedValue({
      address: '0x742d35Cc6634C0532925a3b844Bc9e7595f89ce0',
      privateKey:
        '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
    } as any);

    vi.mocked(fs.readFileSync).mockImplementation((path: any) => {
      if (typeof path === 'string' && path.includes('.csv')) {
        return mockCsvContent;
      }
      // Return valid keystore JSON for keystore files
      return JSON.stringify({
        address: '742d35cc6634c0532925a3b844bc9e7595f89ce0',
        id: 'test-id',
        version: 3,
        crypto: {
          cipher: 'aes-128-ctr',
          cipherparams: { iv: 'test-iv' },
          ciphertext: 'test-ciphertext',
          kdf: 'scrypt',
          kdfparams: {
            dklen: 32,
            n: 262144,
            p: 1,
            r: 8,
            salt: 'test-salt',
          },
          mac: 'test-mac',
        },
      });
    });

    vi.mocked(TransactionBatcherService).mockImplementation(
      () =>
        ({
          submitAll: vi.fn().mockImplementation(async function* () {
            yield { itemsSubmitted: 3, transactionHash: '0x123' };
          }),
          groupItemsIntoBatches: vi.fn().mockImplementation((items: any) => {
            const batches = [];
            for (let i = 0; i < items.length; i += 2) {
              batches.push(items.slice(i, i + 2));
            }
            return batches;
          }),
        }) as any
    );

    vi.mocked(ChainStateService).mockImplementation(
      () =>
        ({
          getCurrentDataCid: vi.fn().mockResolvedValue(''),
          hasUserSubmittedData: vi.fn().mockResolvedValue(false),
          getUserSubmissions: vi.fn().mockResolvedValue(new Set<string>()),
          prepopulateConsensusCache: vi.fn().mockResolvedValue(undefined),
        }) as any
    );

    vi.mocked(TransactionStatusReporterService).mockImplementation(
      () =>
        ({
          initialize: vi.fn().mockResolvedValue(undefined),
          logTransaction: vi.fn().mockResolvedValue(undefined),
          finalize: vi.fn().mockResolvedValue(undefined),
        }) as any
    );

    mockChainStateService = new (vi.mocked(ChainStateService))('', '', '', []);

    mockCsvReporterService = {
      initialize: vi.fn(),
      finalize: vi.fn().mockResolvedValue({}),
      logError: vi.fn(),
      logWarning: vi.fn(),
    } as any;

    mockUnsignedTransactionJsonService = {
      generateUnsignedTransactionsJson: vi.fn().mockResolvedValue(undefined),
    } as any;

    mockProgressTracker = {
      setPhase: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      increment: vi.fn(),
      increase: vi.fn(),
      getMetrics: vi.fn().mockReturnValue({
        processed: 3,
        skipped: 0,
        errors: 0,
        startTime: Date.now() - 1000,
      }),
    } as any;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should instantiate TransactionBatcherService with custom numeric gasPrice', async () => {
    const optionsWithGasPrice = { ...mockOptions, gasPrice: 50 };

    await handleSubmitToContract(optionsWithGasPrice, {
      chainStateService: mockChainStateService,
      csvReporterService: mockCsvReporterService,
      progressTracker: mockProgressTracker,
    });

    expect(TransactionBatcherService).toHaveBeenCalledWith(
      optionsWithGasPrice.rpcUrl,
      optionsWithGasPrice.contractAddress,
      '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890', // From the mocked wallet
      expect.any(Object),
      50
    );
  });

  it('should instantiate TransactionBatcherService with "auto" gasPrice', async () => {
    const optionsWithAutoGas = { ...mockOptions, gasPrice: 'auto' };

    await handleSubmitToContract(optionsWithAutoGas, {
      chainStateService: mockChainStateService,
      csvReporterService: mockCsvReporterService,
      progressTracker: mockProgressTracker,
    });

    expect(TransactionBatcherService).toHaveBeenCalledWith(
      optionsWithAutoGas.rpcUrl,
      optionsWithAutoGas.contractAddress,
      '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890', // From the mocked wallet
      expect.any(Object),
      'auto'
    );
  });

  it('should successfully submit eligible data items to contract', async () => {
    await handleSubmitToContract(mockOptions, {
      chainStateService: mockChainStateService,
      csvReporterService: mockCsvReporterService,
      progressTracker: mockProgressTracker,
    });

    expect(fs.readFileSync).toHaveBeenCalledWith('test-input.csv', 'utf-8');
    // Should not check eligibility by default
    expect(mockChainStateService.getCurrentDataCid).toHaveBeenCalledTimes(0);
    expect(mockChainStateService.hasUserSubmittedData).toHaveBeenCalledTimes(0);

    const MockedTransactionBatcher = vi.mocked(TransactionBatcherService);
    const mockSubmitAll =
      MockedTransactionBatcher.mock.results[0].value.submitAll;
    expect(mockSubmitAll).toHaveBeenCalledTimes(1);
  });

  it('should handle dry run mode correctly', async () => {
    const dryRunOptions = { ...mockOptions, dryRun: true };
    const serviceOverrides = {
      chainStateService: mockChainStateService,
      csvReporterService: mockCsvReporterService,
      progressTracker: mockProgressTracker,
    };

    await handleSubmitToContract(dryRunOptions, serviceOverrides);

    expect(mockChainStateService.getCurrentDataCid).toHaveBeenCalledTimes(0);
    expect(mockChainStateService.hasUserSubmittedData).toHaveBeenCalledTimes(0);
  });

  it('should skip eligibility checks by default', async () => {
    const serviceOverrides = {
      chainStateService: mockChainStateService,
      csvReporterService: mockCsvReporterService,
      progressTracker: mockProgressTracker,
    };

    await handleSubmitToContract(mockOptions, serviceOverrides);

    // Should not call chain state methods when checkEligibility is false (default)
    expect(mockChainStateService.getCurrentDataCid).toHaveBeenCalledTimes(0);
    expect(mockChainStateService.hasUserSubmittedData).toHaveBeenCalledTimes(0);
    expect(
      mockChainStateService.prepopulateConsensusCache
    ).toHaveBeenCalledTimes(0);
  });

  it('should perform eligibility checks when checkEligibility is true', async () => {
    const optionsWithChecks = { ...mockOptions, checkEligibility: true };
    const serviceOverrides = {
      chainStateService: mockChainStateService,
      csvReporterService: mockCsvReporterService,
      progressTracker: mockProgressTracker,
    };

    await handleSubmitToContract(optionsWithChecks, serviceOverrides);

    // Should call chain state methods when checkEligibility is true
    expect(
      mockChainStateService.prepopulateConsensusCache
    ).toHaveBeenCalledTimes(1);
    expect(mockChainStateService.getCurrentDataCid).toHaveBeenCalledTimes(3); // 3 records
    expect(mockChainStateService.hasUserSubmittedData).toHaveBeenCalledTimes(3); // 3 records
  });

  it('should skip items that already exist on chain when checkEligibility is true', async () => {
    const optionsWithChecks = { ...mockOptions, checkEligibility: true };
    mockChainStateService.getCurrentDataCid = vi
      .fn()
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce(
        'bafkreigd6yhp5dfcdrtfubtdq76cnstxehqvpjgmrpuhj7jnwtf3syx3ma'
      ) // property2 already has this CID
      .mockResolvedValueOnce('');

    const serviceOverrides = {
      chainStateService: mockChainStateService,
      csvReporterService: mockCsvReporterService,
      progressTracker: mockProgressTracker,
    };

    await handleSubmitToContract(optionsWithChecks, serviceOverrides);

    expect(mockCsvReporterService.logWarning).toHaveBeenCalledWith(
      expect.objectContaining({
        propertyCid:
          'bafkreigd6yhp5dfcdrtfubtdq76cnstxehqvpjgmrpuhj7jnwtf3syx3ma',
        reason: expect.stringContaining('already exists on chain'),
      })
    );
    const MockedTransactionBatcher = vi.mocked(TransactionBatcherService);
    const mockSubmitAll =
      MockedTransactionBatcher.mock.results[0].value.submitAll;
    const submitAllCalls = vi.mocked(mockSubmitAll).mock.calls;
    expect(submitAllCalls[0][0]).toHaveLength(2);
  });

  it('should skip items already submitted by user when checkEligibility is true', async () => {
    const optionsWithChecks = { ...mockOptions, checkEligibility: true };
    mockChainStateService.hasUserSubmittedData = vi
      .fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true); // property3 already submitted

    const serviceOverrides = {
      chainStateService: mockChainStateService,
      csvReporterService: mockCsvReporterService,
      progressTracker: mockProgressTracker,
    };

    await handleSubmitToContract(optionsWithChecks, serviceOverrides);

    expect(mockCsvReporterService.logWarning).toHaveBeenCalledWith(
      expect.objectContaining({
        propertyCid:
          'bafkreiac4j3s4xhz2ej6qcz6w2xjrcqyhqpmlc5u6l4jy4yk7vfqktkvr4',
        reason: expect.stringContaining('User has already submitted'),
      })
    );

    const MockedTransactionBatcher = vi.mocked(TransactionBatcherService);
    const mockSubmitAll =
      MockedTransactionBatcher.mock.results[0].value.submitAll;
    const submitAllCalls = vi.mocked(mockSubmitAll).mock.calls;
    expect(submitAllCalls[0][0]).toHaveLength(2);
  });

  describe('unsigned transactions feature', () => {
    it('should generate unsigned transactions JSON in dry-run mode when option is provided', async () => {
      const dryRunOptions = {
        ...mockOptions,
        dryRun: true,
        unsignedTransactionsJson: '/path/to/unsigned-transactions.json',
      };

      const serviceOverrides = {
        chainStateService: mockChainStateService,
        csvReporterService: mockCsvReporterService,
        progressTracker: mockProgressTracker,
        unsignedTransactionJsonService: mockUnsignedTransactionJsonService,
      };

      await handleSubmitToContract(dryRunOptions, serviceOverrides);

      // Verify the service was called correctly
      expect(
        mockUnsignedTransactionJsonService.generateUnsignedTransactionsJson
      ).toHaveBeenCalledTimes(1);

      const callArgs = (
        mockUnsignedTransactionJsonService.generateUnsignedTransactionsJson as any
      ).mock.calls[0];
      expect(callArgs[0]).toEqual(expect.any(Array)); // batches
      expect(callArgs[1]).toBe(dryRunOptions.rpcUrl); // rpcUrl
      // callArgs[2] is userAddress which might be undefined in test environment
    });

    it('should not generate unsigned transactions JSON in dry-run mode when option is not provided', async () => {
      const dryRunOptions = {
        ...mockOptions,
        dryRun: true,
        // unsignedTransactionsJson not provided
      };

      const serviceOverrides = {
        chainStateService: mockChainStateService,
        csvReporterService: mockCsvReporterService,
        progressTracker: mockProgressTracker,
      };

      await handleSubmitToContract(dryRunOptions, serviceOverrides);

      // Service should not be called if option not provided
      expect(
        mockUnsignedTransactionJsonService.generateUnsignedTransactionsJson
      ).not.toHaveBeenCalled();
    });

    it('should handle unsigned transaction JSON generation errors gracefully', async () => {
      const dryRunOptions = {
        ...mockOptions,
        dryRun: true,
        unsignedTransactionsJson: '/path/to/unsigned-transactions.json',
      };

      // Mock the service to throw an error
      mockUnsignedTransactionJsonService.generateUnsignedTransactionsJson = vi
        .fn()
        .mockRejectedValue(new Error('Failed to write JSON file'));

      const serviceOverrides = {
        chainStateService: mockChainStateService,
        csvReporterService: mockCsvReporterService,
        progressTracker: mockProgressTracker,
        unsignedTransactionJsonService: mockUnsignedTransactionJsonService,
      };

      await handleSubmitToContract(dryRunOptions, serviceOverrides);

      // Should log error to CSV reporter
      expect(mockCsvReporterService.logError).toHaveBeenCalledWith(
        expect.objectContaining({
          errorMessage: expect.stringContaining(
            'Failed to generate unsigned transactions JSON'
          ),
        })
      );
    });

    it('should not generate unsigned transactions JSON in non-dry-run mode even if option is provided', async () => {
      const nonDryRunOptions = {
        ...mockOptions,
        dryRun: false, // Not dry run
        unsignedTransactionsJson: '/path/to/unsigned-transactions.json',
      };

      const serviceOverrides = {
        chainStateService: mockChainStateService,
        csvReporterService: mockCsvReporterService,
        progressTracker: mockProgressTracker,
        unsignedTransactionJsonService: mockUnsignedTransactionJsonService,
      };

      await handleSubmitToContract(nonDryRunOptions, serviceOverrides);

      // Should not generate JSON in non-dry-run mode
      expect(
        mockUnsignedTransactionJsonService.generateUnsignedTransactionsJson
      ).not.toHaveBeenCalled();
    });

    it('should pass correct batches to unsigned transaction JSON service', async () => {
      const dryRunOptions = {
        ...mockOptions,
        dryRun: true,
        unsignedTransactionsJson: '/path/to/unsigned-transactions.json',
        transactionBatchSize: 1, // Force each item into separate batch
      };

      const serviceOverrides = {
        chainStateService: mockChainStateService,
        csvReporterService: mockCsvReporterService,
        progressTracker: mockProgressTracker,
        unsignedTransactionJsonService: mockUnsignedTransactionJsonService,
      };

      await handleSubmitToContract(dryRunOptions, serviceOverrides);

      // Should be called with 3 batches (since batch size is 1)
      const generateCall = vi.mocked(
        mockUnsignedTransactionJsonService.generateUnsignedTransactionsJson
      ).mock.calls[0];

      const batches = generateCall[0];
      expect(batches).toHaveLength(3); // 3 items with batch size 1 = 3 batches
      expect(batches[0]).toHaveLength(1);
      expect(batches[1]).toHaveLength(1);
      expect(batches[2]).toHaveLength(1);
    });
  });

  describe('--from-address feature', () => {
    it('should use provided from-address when generating unsigned transactions in dry-run mode', async () => {
      const fromAddress = '0x742d35Cc6634C0532925a3b844Bc9e7595f89ce0';
      const dryRunOptions = {
        ...mockOptions,
        dryRun: true,
        unsignedTransactionsJson: '/path/to/unsigned-transactions.json',
        fromAddress,
        keystoreJsonPath: undefined, // No keystore provided
        keystorePassword: undefined,
      };

      const serviceOverrides = {
        chainStateService: mockChainStateService,
        csvReporterService: mockCsvReporterService,
        progressTracker: mockProgressTracker,
        unsignedTransactionJsonService: mockUnsignedTransactionJsonService,
      };

      await handleSubmitToContract(dryRunOptions, serviceOverrides);

      // Verify the service was called with the provided from address
      expect(
        mockUnsignedTransactionJsonService.generateUnsignedTransactionsJson
      ).toHaveBeenCalledTimes(1);

      const callArgs = (
        mockUnsignedTransactionJsonService.generateUnsignedTransactionsJson as any
      ).mock.calls[0];
      expect(callArgs[2]).toBe(fromAddress); // userAddress should be the provided fromAddress
    });

    it('should derive address from private key when from-address is not provided', async () => {
      // For this test, we'll verify that the Wallet constructor is called with the private key
      const dryRunOptions = {
        ...mockOptions,
        dryRun: true,
        unsignedTransactionsJson: '/path/to/unsigned-transactions.json',
        // fromAddress not provided
      };

      const serviceOverrides = {
        chainStateService: mockChainStateService,
        csvReporterService: mockCsvReporterService,
        progressTracker: mockProgressTracker,
        unsignedTransactionJsonService: mockUnsignedTransactionJsonService,
      };

      await handleSubmitToContract(dryRunOptions, serviceOverrides);

      // Verify that wallet was loaded from keystore
      expect(
        EncryptedWalletService.loadWalletFromEncryptedJson
      ).toHaveBeenCalled();
    });

    it('should allow missing private key when using from-address in unsigned transaction mode', async () => {
      const fromAddress = '0x742d35Cc6634C0532925a3b844Bc9e7595f89ce0';
      const dryRunOptions = {
        ...mockOptions,
        dryRun: true,
        unsignedTransactionsJson: '/path/to/unsigned-transactions.json',
        fromAddress,
        keystoreJsonPath: undefined, // No keystore provided
        keystorePassword: undefined,
      };

      const serviceOverrides = {
        chainStateService: mockChainStateService,
        csvReporterService: mockCsvReporterService,
        progressTracker: mockProgressTracker,
        unsignedTransactionJsonService: mockUnsignedTransactionJsonService,
      };

      // Should not throw an error about missing private key
      await expect(
        handleSubmitToContract(dryRunOptions, serviceOverrides)
      ).resolves.not.toThrow();
    });

    it('should not use from-address when not in unsigned transaction mode', async () => {
      const fromAddress = '0x742d35Cc6634C0532925a3b844Bc9e7595f89ce0';
      const normalOptions = {
        ...mockOptions,
        dryRun: false, // Not dry run
        fromAddress,
        // No unsignedTransactionsJson
      };

      const serviceOverrides = {
        chainStateService: mockChainStateService,
        csvReporterService: mockCsvReporterService,
        progressTracker: mockProgressTracker,
      };

      await handleSubmitToContract(normalOptions, serviceOverrides);

      // Should use address from wallet, not from-address
      // This is verified by the fact that TransactionBatcherService is called with wallet's private key
      expect(TransactionBatcherService).toHaveBeenCalledWith(
        normalOptions.rpcUrl,
        normalOptions.contractAddress,
        '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890', // From mocked wallet
        expect.any(Object),
        normalOptions.gasPrice
      );
    });

    it('should not use from-address when unsignedTransactionsJson is not provided', async () => {
      const fromAddress = '0x742d35Cc6634C0532925a3b844Bc9e7595f89ce0';
      const dryRunOptions = {
        ...mockOptions,
        dryRun: true,
        fromAddress,
        // No unsignedTransactionsJson
      };

      const serviceOverrides = {
        chainStateService: mockChainStateService,
        csvReporterService: mockCsvReporterService,
        progressTracker: mockProgressTracker,
      };

      await handleSubmitToContract(dryRunOptions, serviceOverrides);

      // Should use address from wallet, not from-address
      // Verified by checking that EncryptedWalletService was called
      expect(
        EncryptedWalletService.loadWalletFromEncryptedJson
      ).toHaveBeenCalled();
    });
  });

  describe('transaction ID CSV functionality', () => {
    it('should write transaction IDs to CSV file when transactions are submitted', async () => {
      const mockTransactionBatcher = {
        submitAll: vi.fn().mockImplementation(async function* () {
          yield { itemsSubmitted: 2, transactionHash: '0xabc123' };
          yield { itemsSubmitted: 1, transactionHash: '0xdef456' };
        }),
        groupItemsIntoBatches: vi.fn().mockImplementation((items: any) => {
          const batches = [];
          for (let i = 0; i < items.length; i += 2) {
            batches.push(items.slice(i, i + 2));
          }
          return batches;
        }),
      };

      vi.mocked(TransactionBatcherService).mockImplementation(
        () => mockTransactionBatcher as any
      );

      const optionsWithTransactionCsv = {
        ...mockOptions,
        transactionIdsCsv: '/tmp/transaction-ids.csv',
      };

      await handleSubmitToContract(optionsWithTransactionCsv, {
        chainStateService: mockChainStateService,
        csvReporterService: mockCsvReporterService,
        progressTracker: mockProgressTracker,
      });

      // Verify writeFileSync was called with correct CSV content
      expect(vi.mocked(fs.writeFileSync)).toHaveBeenCalledWith(
        '/tmp/transaction-ids.csv',
        expect.stringContaining(
          'transactionHash,batchIndex,itemCount,timestamp,status'
        )
      );
      expect(vi.mocked(fs.writeFileSync)).toHaveBeenCalledWith(
        '/tmp/transaction-ids.csv',
        expect.stringContaining('0xabc123,0,2,')
      );
      expect(vi.mocked(fs.writeFileSync)).toHaveBeenCalledWith(
        '/tmp/transaction-ids.csv',
        expect.stringContaining('0xdef456,1,1,')
      );
    });

    it('should display transaction IDs in console when less than 5 transactions', async () => {
      const consoleSpy = vi.spyOn(console, 'log');

      const mockTransactionBatcher = {
        submitAll: vi.fn().mockImplementation(async function* () {
          yield { itemsSubmitted: 2, transactionHash: '0xabc123' };
          yield { itemsSubmitted: 1, transactionHash: '0xdef456' };
        }),
        groupItemsIntoBatches: vi.fn().mockImplementation((items: any) => {
          const batches = [];
          for (let i = 0; i < items.length; i += 2) {
            batches.push(items.slice(i, i + 2));
          }
          return batches;
        }),
      };

      vi.mocked(TransactionBatcherService).mockImplementation(
        () => mockTransactionBatcher as any
      );

      await handleSubmitToContract(mockOptions, {
        chainStateService: mockChainStateService,
        csvReporterService: mockCsvReporterService,
        progressTracker: mockProgressTracker,
      });

      // Verify transaction IDs were displayed
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('📝 Transaction IDs:')
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('0xabc123')
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('0xdef456')
      );
    });

    it('should not display transaction IDs in console when 5 or more transactions', async () => {
      const consoleSpy = vi.spyOn(console, 'log');

      const mockTransactionBatcher = {
        submitAll: vi.fn().mockImplementation(async function* () {
          for (let i = 0; i < 5; i++) {
            yield { itemsSubmitted: 1, transactionHash: `0x${i}00000` };
          }
        }),
        groupItemsIntoBatches: vi.fn().mockImplementation((items: any) => {
          return items.map((item) => [item]);
        }),
      };

      vi.mocked(TransactionBatcherService).mockImplementation(
        () => mockTransactionBatcher as any
      );

      await handleSubmitToContract(mockOptions, {
        chainStateService: mockChainStateService,
        csvReporterService: mockCsvReporterService,
        progressTracker: mockProgressTracker,
      });

      // Verify transaction IDs header was NOT displayed
      expect(consoleSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('📝 Transaction IDs:')
      );
    });

    it('should track progress by number of transactions, not items', async () => {
      const mockCsvWith6Items = `propertyCid,dataGroupCid,dataCid,filePath,uploadedAt
item1,group1,data1,/test/1.json,2024-01-01T00:00:00Z
item2,group2,data2,/test/2.json,2024-01-01T00:00:00Z
item3,group3,data3,/test/3.json,2024-01-01T00:00:00Z
item4,group4,data4,/test/4.json,2024-01-01T00:00:00Z
item5,group5,data5,/test/5.json,2024-01-01T00:00:00Z
item6,group6,data6,/test/6.json,2024-01-01T00:00:00Z`;

      vi.mocked(fs.readFileSync).mockReturnValue(mockCsvWith6Items);

      const optionsWithBatchSize = {
        ...mockOptions,
        transactionBatchSize: 2, // 6 items / 2 = 3 transactions
      };

      await handleSubmitToContract(optionsWithBatchSize, {
        chainStateService: mockChainStateService,
        csvReporterService: mockCsvReporterService,
        progressTracker: mockProgressTracker,
      });

      // Verify setPhase was called with 3 transactions, not 6 items
      expect(mockProgressTracker.setPhase).toHaveBeenCalledWith(
        'Submitting Transactions',
        3 // 3 transactions, not 6 items
      );
    });

    it('should generate default transaction CSV filename when not provided', async () => {
      const mockTransactionBatcher = {
        submitAll: vi.fn().mockImplementation(async function* () {
          yield { itemsSubmitted: 1, transactionHash: '0xabc123' };
        }),
        groupItemsIntoBatches: vi.fn().mockImplementation((items: any) => {
          return [items];
        }),
      };

      vi.mocked(TransactionBatcherService).mockImplementation(
        () => mockTransactionBatcher as any
      );

      // Options without transactionIdsCsv
      const optionsWithoutCsvPath = { ...mockOptions };

      await handleSubmitToContract(optionsWithoutCsvPath, {
        chainStateService: mockChainStateService,
        csvReporterService: mockCsvReporterService,
        progressTracker: mockProgressTracker,
      });

      // Verify writeFileSync was called with a generated filename
      expect(vi.mocked(fs.writeFileSync)).toHaveBeenCalledWith(
        expect.stringMatching(
          /transaction-ids-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.csv$/
        ),
        expect.any(String)
      );
    });

    it('should not write transaction CSV in dry-run mode', async () => {
      const dryRunOptions = {
        ...mockOptions,
        dryRun: true,
        transactionIdsCsv: '/tmp/transaction-ids.csv',
      };

      await handleSubmitToContract(dryRunOptions, {
        chainStateService: mockChainStateService,
        csvReporterService: mockCsvReporterService,
        progressTracker: mockProgressTracker,
      });

      // Verify writeFileSync was NOT called for transaction IDs
      expect(vi.mocked(fs.writeFileSync)).not.toHaveBeenCalledWith(
        expect.stringContaining('transaction-ids'),
        expect.any(String)
      );
    });

    it('should collect transaction IDs from API submission mode', async () => {
      // Clear writeFileSync mock to ensure clean state
      vi.mocked(fs.writeFileSync).mockClear();

      const apiOptions = {
        ...mockOptions,
        domain: 'test.api.com',
        apiKey: 'test-key',
        oracleKeyId: 'oracle-123',
        transactionIdsCsv: '/tmp/api-transaction-ids.csv',
      };

      // Need to mock TransactionBatcherService for API mode to group items
      const mockTransactionBatcher = {
        groupItemsIntoBatches: vi.fn().mockImplementation((items: any) => {
          const batches = [];
          for (let i = 0; i < items.length; i += 2) {
            batches.push(items.slice(i, i + 2));
          }
          return batches;
        }),
      };

      vi.mocked(TransactionBatcherService).mockImplementation(
        () => mockTransactionBatcher as any
      );

      const mockApiSubmissionService = {
        submitTransaction: vi
          .fn()
          .mockResolvedValueOnce({ transaction_hash: '0xapi123' })
          .mockResolvedValueOnce({ transaction_hash: '0xapi456' }),
      };

      const mockTransactionStatusService = {
        waitForTransaction: vi
          .fn()
          .mockResolvedValueOnce({ hash: '0xapi123', status: 'success' })
          .mockResolvedValueOnce({ hash: '0xapi456', status: 'success' }),
      };

      const mockTransactionStatusReporter = {
        initialize: vi.fn(),
        logTransaction: vi.fn(),
        finalize: vi.fn(),
      };

      // Mock UnsignedTransactionJsonService for API mode
      const mockUnsignedTxService = {
        generateUnsignedTransactions: vi.fn().mockResolvedValue([
          { data: '0x123', to: '0xcontract', from: '0xuser' },
          { data: '0x456', to: '0xcontract', from: '0xuser' },
        ]),
      };

      vi.mocked(UnsignedTransactionJsonService).mockImplementation(
        () => mockUnsignedTxService as any
      );

      await handleSubmitToContract(apiOptions, {
        chainStateService: mockChainStateService,
        csvReporterService: mockCsvReporterService,
        progressTracker: mockProgressTracker,
        apiSubmissionService: mockApiSubmissionService as any,
        transactionStatusService: mockTransactionStatusService as any,
        transactionStatusReporter: mockTransactionStatusReporter as any,
      });

      // Verify transaction IDs CSV was written with API transactions
      expect(vi.mocked(fs.writeFileSync)).toHaveBeenCalledWith(
        '/tmp/api-transaction-ids.csv',
        expect.stringContaining('0xapi123,0,')
      );
      expect(vi.mocked(fs.writeFileSync)).toHaveBeenCalledWith(
        '/tmp/api-transaction-ids.csv',
        expect.stringContaining('0xapi456,1,')
      );
    });
  });
});
