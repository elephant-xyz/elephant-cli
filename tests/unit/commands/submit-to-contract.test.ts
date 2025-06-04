import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import {
  handleSubmitToContract,
  SubmitToContractCommandOptions,
} from '../../../src/commands/submit-to-contract.js';
import { ChainStateService } from '../../../src/services/chain-state.service.js';
import { TransactionBatcherService } from '../../../src/services/transaction-batcher.service.js';
import { CsvReporterService } from '../../../src/services/csv-reporter.service.js';
import { SimpleProgress } from '../../../src/utils/simple-progress.js';

vi.mock('fs', () => ({
  ...vi.importActual('fs'),
  readFileSync: vi.fn(),
}));

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
    privateKey: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
    csvFile: 'test-input.csv',
    transactionBatchSize: 2,
    dryRun: false,
  };

  const mockCsvContent = `propertyCid,dataGroupCid,dataCid,filePath,uploadedAt
property1,dataGroup1,QmCid1,"/test/property1/dataGroup1.json",2024-01-01T00:00:00Z
property2,dataGroup2,QmCid2,"/test/property2/dataGroup2.json",2024-01-01T00:01:00Z
property3,dataGroup3,QmCid3,"/test/property3/dataGroup3.json",2024-01-01T00:02:00Z`;

  let mockChainStateService: ChainStateService;
  let mockTransactionBatcherService: TransactionBatcherService;
  let mockCsvReporterService: CsvReporterService;
  let mockProgressTracker: SimpleProgress;

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock CSV file read
    vi.mocked(fs.readFileSync).mockReturnValue(mockCsvContent);

    // Create mock services
    mockChainStateService = {
      getCurrentDataCid: vi.fn().mockResolvedValue(''),
      hasUserSubmittedData: vi.fn().mockResolvedValue(false),
    } as any;

    mockTransactionBatcherService = {
      submitAll: vi.fn().mockImplementation(async function* () {
        yield {
          transactionHash: '0xabc123',
          blockNumber: 12345,
          gasUsed: '50000',
          itemsSubmitted: 2,
        };
        yield {
          transactionHash: '0xdef456',
          blockNumber: 12346,
          gasUsed: '30000',
          itemsSubmitted: 1,
        };
      }),
      groupItemsIntoBatches: vi.fn().mockImplementation((items) => {
        const batches = [];
        for (let i = 0; i < items.length; i += 2) {
          batches.push(items.slice(i, i + 2));
        }
        return batches;
      }),
    } as any;

    mockCsvReporterService = {
      initialize: vi.fn(),
      finalize: vi.fn().mockResolvedValue({}),
      logError: vi.fn(),
      logWarning: vi.fn(),
    } as any;

    mockProgressTracker = {
      setPhase: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      increment: vi.fn(),
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

  it('should successfully submit eligible data items to contract', async () => {
    const serviceOverrides = {
      chainStateService: mockChainStateService,
      transactionBatcherService: mockTransactionBatcherService,
      csvReporterService: mockCsvReporterService,
      progressTracker: mockProgressTracker,
    };

    await handleSubmitToContract(mockOptions, serviceOverrides);

    // Verify CSV was read
    expect(fs.readFileSync).toHaveBeenCalledWith('test-input.csv', 'utf-8');

    // Verify eligibility checks
    expect(mockChainStateService.getCurrentDataCid).toHaveBeenCalledTimes(3);
    expect(mockChainStateService.hasUserSubmittedData).toHaveBeenCalledTimes(3);

    // Verify all items were submitted
    const submitAllCalls = vi.mocked(mockTransactionBatcherService.submitAll).mock.calls;
    expect(submitAllCalls).toHaveLength(1);
    expect(submitAllCalls[0][0]).toHaveLength(3);
    expect(submitAllCalls[0][0]).toEqual([
      { propertyCid: 'property1', dataGroupCID: 'dataGroup1', dataCID: 'QmCid1' },
      { propertyCid: 'property2', dataGroupCID: 'dataGroup2', dataCID: 'QmCid2' },
      { propertyCid: 'property3', dataGroupCID: 'dataGroup3', dataCID: 'QmCid3' },
    ]);
  });

  it('should handle dry run mode correctly', async () => {
    const dryRunOptions = { ...mockOptions, dryRun: true };
    const serviceOverrides = {
      chainStateService: mockChainStateService,
      transactionBatcherService: mockTransactionBatcherService,
      csvReporterService: mockCsvReporterService,
      progressTracker: mockProgressTracker,
    };

    await handleSubmitToContract(dryRunOptions, serviceOverrides);

    // Should perform eligibility checks
    expect(mockChainStateService.getCurrentDataCid).toHaveBeenCalledTimes(3);
    expect(mockChainStateService.hasUserSubmittedData).toHaveBeenCalledTimes(3);

    // Should not submit transactions in dry run
    expect(mockTransactionBatcherService.submitAll).not.toHaveBeenCalled();

    // Should group items into batches for display
    expect(mockTransactionBatcherService.groupItemsIntoBatches).toHaveBeenCalled();
  });

  it('should skip items that already exist on chain', async () => {
    // Mock that property2 already exists on chain
    mockChainStateService.getCurrentDataCid = vi
      .fn()
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce('QmCid2') // property2 already has this CID
      .mockResolvedValueOnce('');

    const serviceOverrides = {
      chainStateService: mockChainStateService,
      transactionBatcherService: mockTransactionBatcherService,
      csvReporterService: mockCsvReporterService,
      progressTracker: mockProgressTracker,
    };

    await handleSubmitToContract(mockOptions, serviceOverrides);

    // Should log warning for property2
    expect(mockCsvReporterService.logWarning).toHaveBeenCalledWith(
      expect.objectContaining({
        propertyCid: 'property2',
        reason: expect.stringContaining('already exists on chain'),
      })
    );

    // Should only submit property1 and property3
    const submitAllCalls = vi.mocked(mockTransactionBatcherService.submitAll).mock.calls;
    expect(submitAllCalls[0][0]).toHaveLength(2);
    expect(submitAllCalls[0][0]).toEqual([
      { propertyCid: 'property1', dataGroupCID: 'dataGroup1', dataCID: 'QmCid1' },
      { propertyCid: 'property3', dataGroupCID: 'dataGroup3', dataCID: 'QmCid3' },
    ]);
  });

  it('should skip items already submitted by user', async () => {
    // Mock that user already submitted property3
    mockChainStateService.hasUserSubmittedData = vi
      .fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true); // property3 already submitted

    const serviceOverrides = {
      chainStateService: mockChainStateService,
      transactionBatcherService: mockTransactionBatcherService,
      csvReporterService: mockCsvReporterService,
      progressTracker: mockProgressTracker,
    };

    await handleSubmitToContract(mockOptions, serviceOverrides);

    // Should log warning for property3
    expect(mockCsvReporterService.logWarning).toHaveBeenCalledWith(
      expect.objectContaining({
        propertyCid: 'property3',
        reason: expect.stringContaining('User has already submitted'),
      })
    );

    // Should only submit property1 and property2
    const submitAllCalls = vi.mocked(mockTransactionBatcherService.submitAll).mock.calls;
    expect(submitAllCalls[0][0]).toHaveLength(2);
    expect(submitAllCalls[0][0]).toEqual([
      { propertyCid: 'property1', dataGroupCID: 'dataGroup1', dataCID: 'QmCid1' },
      { propertyCid: 'property2', dataGroupCID: 'dataGroup2', dataCID: 'QmCid2' },
    ]);
  });

  it('should handle transaction submission errors', async () => {
    mockTransactionBatcherService.submitAll = vi
      .fn()
      .mockImplementation(async function* () {
        throw new Error('Transaction failed: insufficient funds');
      });

    const serviceOverrides = {
      chainStateService: mockChainStateService,
      transactionBatcherService: mockTransactionBatcherService,
      csvReporterService: mockCsvReporterService,
      progressTracker: mockProgressTracker,
    };

    await handleSubmitToContract(mockOptions, serviceOverrides);

    // Should log error
    expect(mockCsvReporterService.logError).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.stringContaining('Transaction failed'),
      })
    );
  });

  it('should handle empty CSV file', async () => {
    vi.mocked(fs.readFileSync).mockReturnValue(
      'propertyCid,dataGroupCid,dataCid,filePath,uploadedAt\n'
    );

    const serviceOverrides = {
      chainStateService: mockChainStateService,
      transactionBatcherService: mockTransactionBatcherService,
      csvReporterService: mockCsvReporterService,
      progressTracker: mockProgressTracker,
    };

    await handleSubmitToContract(mockOptions, serviceOverrides);

    // Should not perform any checks or submissions
    expect(mockChainStateService.getCurrentDataCid).not.toHaveBeenCalled();
    expect(mockTransactionBatcherService.submitAll).not.toHaveBeenCalled();
  });

  it('should handle CSV file read errors', async () => {
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error('File not found');
    });

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('Process exit');
    });

    const serviceOverrides = {
      chainStateService: mockChainStateService,
      transactionBatcherService: mockTransactionBatcherService,
      csvReporterService: mockCsvReporterService,
      progressTracker: mockProgressTracker,
    };

    await expect(
      handleSubmitToContract(mockOptions, serviceOverrides)
    ).rejects.toThrow('Process exit');

    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('should handle chain state service errors gracefully', async () => {
    mockChainStateService.getCurrentDataCid = vi
      .fn()
      .mockRejectedValueOnce(new Error('RPC connection error'))
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce('');

    const serviceOverrides = {
      chainStateService: mockChainStateService,
      transactionBatcherService: mockTransactionBatcherService,
      csvReporterService: mockCsvReporterService,
      progressTracker: mockProgressTracker,
    };

    await handleSubmitToContract(mockOptions, serviceOverrides);

    // Should log warning for property1
    expect(mockCsvReporterService.logWarning).toHaveBeenCalledWith(
      expect.objectContaining({
        propertyCid: 'property1',
        reason: expect.stringContaining('Error checking submission eligibility'),
      })
    );

    // Should still process property2 and property3
    const submitAllCalls = vi.mocked(mockTransactionBatcherService.submitAll).mock.calls;
    expect(submitAllCalls[0][0]).toHaveLength(2);
    expect(submitAllCalls[0][0]).toEqual([
      { propertyCid: 'property2', dataGroupCID: 'dataGroup2', dataCID: 'QmCid2' },
      { propertyCid: 'property3', dataGroupCID: 'dataGroup3', dataCID: 'QmCid3' },
    ]);
  });
});