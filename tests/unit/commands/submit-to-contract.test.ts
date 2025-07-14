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

vi.mock('fs', () => ({
  ...vi.importActual('fs'),
  readFileSync: vi.fn(),
}));

vi.mock('../../../src/services/transaction-batcher.service.js');
vi.mock('../../../src/services/chain-state.service.js');
vi.mock('../../../src/services/unsigned-transaction-json.service.js');

vi.mock('ethers', async () => {
  const actual = await vi.importActual('ethers');
  return {
    ...actual,
    Wallet: vi.fn().mockImplementation((privateKey: string) => ({
      address: '0x742d35Cc6634C0532925a3b844Bc9e7595f89ce0',
    })),
  };
});

describe('SubmitToContractCommand', () => {
  const mockOptions: SubmitToContractCommandOptions = {
    rpcUrl: 'https://test-rpc.com',
    contractAddress: '0x1234567890123456789012345678901234567890',
    privateKey:
      '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
    csvFile: 'test-input.csv',
    transactionBatchSize: 2,
    gasPrice: 30,
    dryRun: false,
  };

  const mockCsvContent = `propertyCid,dataGroupCid,dataCid,filePath,uploadedAt
property1,dataGroup1,QmCid1,"/test/property1/dataGroup1.json",2024-01-01T00:00:00Z
property2,dataGroup2,QmCid2,"/test/property2/dataGroup2.json",2024-01-01T00:01:00Z
property3,dataGroup3,QmCid3,"/test/property3/dataGroup3.json",2024-01-01T00:02:00Z`;

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

    vi.mocked(fs.readFileSync).mockReturnValue(mockCsvContent);

    vi.mocked(TransactionBatcherService).mockImplementation(() => ({
      submitAll: vi.fn().mockImplementation(async function* () {
        yield { itemsSubmitted: 3, transactionHash: '0x123' };
      }),
      groupItemsIntoBatches: vi.fn().mockImplementation((items: any[]) => {
        const batches = [];
        for (let i = 0; i < items.length; i += 2) {
          batches.push(items.slice(i, i + 2));
        }
        return batches;
      }),
    }));

    vi.mocked(ChainStateService).mockImplementation(() => ({
      getCurrentDataCid: vi.fn().mockResolvedValue(''),
      hasUserSubmittedData: vi.fn().mockResolvedValue(false),
      getUserSubmissions: vi.fn().mockResolvedValue(new Set<string>()),
      prepopulateConsensusCache: vi.fn().mockResolvedValue(undefined),
    }));

    mockChainStateService = new (vi.mocked(ChainStateService))('', '', '', []);

    mockCsvReporterService = {
      initialize: vi.fn(),
      finalize: vi.fn().mockResolvedValue({}),
      logError: vi.fn(),
      logWarning: vi.fn(),
    } as any;

    mockUnsignedTransactionJsonService = {
      generateUnsignedTransactionsJson: vi.fn(),
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
      optionsWithGasPrice.privateKey,
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
      optionsWithAutoGas.privateKey,
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
    expect(mockChainStateService.getCurrentDataCid).toHaveBeenCalledTimes(3);
    expect(mockChainStateService.hasUserSubmittedData).toHaveBeenCalledTimes(3);

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

  it('should skip items that already exist on chain', async () => {
    mockChainStateService.getCurrentDataCid = vi
      .fn()
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce('QmCid2') // property2 already has this CID
      .mockResolvedValueOnce('');

    const serviceOverrides = {
      chainStateService: mockChainStateService,
      csvReporterService: mockCsvReporterService,
      progressTracker: mockProgressTracker,
    };

    await handleSubmitToContract(mockOptions, serviceOverrides);

    expect(mockCsvReporterService.logWarning).toHaveBeenCalledWith(
      expect.objectContaining({
        propertyCid: 'property2',
        reason: expect.stringContaining('already exists on chain'),
      })
    );
    const MockedTransactionBatcher = vi.mocked(TransactionBatcherService);
    const mockSubmitAll =
      MockedTransactionBatcher.mock.results[0].value.submitAll;
    const submitAllCalls = vi.mocked(mockSubmitAll).mock.calls;
    expect(submitAllCalls[0][0]).toHaveLength(2);
  });

  it('should skip items already submitted by user', async () => {
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

    await handleSubmitToContract(mockOptions, serviceOverrides);

    expect(mockCsvReporterService.logWarning).toHaveBeenCalledWith(
      expect.objectContaining({
        propertyCid: 'property3',
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

      const callArgs =
        mockUnsignedTransactionJsonService.generateUnsignedTransactionsJson.mock
          .calls[0];
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
});
