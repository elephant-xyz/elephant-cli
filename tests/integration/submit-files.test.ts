import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { promises as fsPromises, readFileSync } from 'fs';

// Mock external dependencies and services
vi.mock('ethers', () => ({
  __esModule: true,
  Wallet: vi.fn().mockImplementation(() => ({
    address: 'mockWalletAddress',
    getNonce: vi.fn().mockResolvedValue(0),
  })),
  Contract: vi.fn().mockImplementation(() => ({
    [Symbol.asyncIterator]: vi.fn(), // Make it an async iterable
    estimateGas: {
      submitBatchData: vi.fn().mockResolvedValue(BigInt(200000)),
    },
    submitBatchData: vi.fn().mockResolvedValue({
      hash: '0xmocktxhash',
      wait: vi.fn().mockResolvedValue({
        status: 1,
        blockNumber: 123,
        gasUsed: BigInt(100000),
      }),
    }),
    getCurrentFieldDataCID: vi.fn().mockResolvedValue(null), // Default to not found
    getParticipantsForConsensusDataCID: vi.fn().mockResolvedValue([]),
  })),
  JsonRpcProvider: vi.fn().mockImplementation(() => ({})),
  ZeroHash:
    '0x0000000000000000000000000000000000000000000000000000000000000000',
  getAddress: vi.fn((addr) => addr),
  toUtf8Bytes: vi.fn((str) => new TextEncoder().encode(str)),
  toUtf8String: vi.fn((bytes) => new TextDecoder().decode(bytes)),
}));

vi.mock('fs', async (importOriginal) => {
  const actualFs = await importOriginal<typeof import('fs')>();
  return {
    ...actualFs,
    promises: {
      ...actualFs.promises,
      stat: vi.fn(),
      mkdir: vi.fn().mockResolvedValue(undefined),
    },
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    createWriteStream: vi.fn().mockReturnValue({
      write: vi.fn((_data, cb) => cb && cb()),
      once: vi.fn((_event, cb) => cb && cb()),
      end: vi.fn((cb) => cb && cb()),
      writable: true,
    }),
  };
});

vi.mock('../../src/utils/logger.ts');
vi.mock('../../src/services/file-scanner.service.ts');
vi.mock('../../src/services/schema-cache.service.ts');
vi.mock('../../src/services/json-validator.service.ts');
vi.mock('../../src/services/json-canonicalizer.service.ts');
vi.mock('../../src/services/cid-calculator.service.ts');
vi.mock('../../src/services/chain-state.service.ts');
vi.mock('../../src/services/pinata.service.ts');
vi.mock('../../src/services/transaction-batcher.service.ts');
vi.mock('../../src/services/csv-reporter.service.ts');
vi.mock('../../src/utils/progress-tracker.ts');
vi.mock('../../src/services/ipfs.service.ts');

import {
  handleSubmitFiles,
  SubmitFilesCommandOptions,
} from '../../src/commands/submit-files';
import { FileScannerService } from '../../src/services/file-scanner.service';
import { SchemaCacheService } from '../../src/services/schema-cache.service';
import { JsonValidatorService } from '../../src/services/json-validator.service';
import { JsonCanonicalizerService } from '../../src/services/json-canonicalizer.service';
import { CidCalculatorService } from '../../src/services/cid-calculator.service';
import { ChainStateService } from '../../src/services/chain-state.service';
import { PinataService } from '../../src/services/pinata.service';
import { TransactionBatcherService } from '../../src/services/transaction-batcher.service';
import { CsvReporterService } from '../../src/services/csv-reporter.service';
import {
  ProgressTracker,
  ProcessingPhase,
} from '../../src/utils/progress-tracker';
import { IPFSService } from '../../src/services/ipfs.service';
import { logger } from '../../src/utils/logger';
import { DEFAULT_SUBMIT_CONFIG } from '../../src/config/submit.config';
import { FileEntry, ProcessedFile } from '../../src/types/submit.types';

// Helper to mock fs.promises.stat
const mockFsStat = fsPromises.stat as vi.Mock;
const mockReadFileSync = readFileSync as vi.Mock;

const MockedFileScannerService = FileScannerService as vi.MockedClass<
  typeof FileScannerService
>;
const MockedSchemaCacheService = SchemaCacheService as vi.MockedClass<
  typeof SchemaCacheService
>;
const MockedJsonValidatorService = JsonValidatorService as vi.MockedClass<
  typeof JsonValidatorService
>;
const MockedJsonCanonicalizerService =
  JsonCanonicalizerService as vi.MockedClass<typeof JsonCanonicalizerService>;
const MockedCidCalculatorService = CidCalculatorService as vi.MockedClass<
  typeof CidCalculatorService
>;
const MockedChainStateService = ChainStateService as vi.MockedClass<
  typeof ChainStateService
>;
const MockedPinataService = PinataService as vi.MockedClass<
  typeof PinataService
>;
const MockedTransactionBatcherService =
  TransactionBatcherService as vi.MockedClass<typeof TransactionBatcherService>;
const MockedCsvReporterService = CsvReporterService as vi.MockedClass<
  typeof CsvReporterService
>;
const MockedProgressTracker = ProgressTracker as vi.MockedClass<
  typeof ProgressTracker
>;
const MockedIPFSService = IPFSService as vi.MockedClass<typeof IPFSService>;

describe('submit-files integration tests', () => {
  let processExitSpy: vi.SpyInstance;
  let mockProgressTrackerInstance: any;

  const defaultOptions: SubmitFilesCommandOptions = {
    rpcUrl: 'mock-rpc-url',
    contractAddress: '0xMockSubmitContractAddress',
    privateKey: '0xmockPrivateKey',
    pinataJwt: 'mockPinataJwt',
    inputDir: '/fake/input/dir',
    dryRun: false,
  };

  const mockFileEntries: FileEntry[] = [
    {
      propertyCid: 'propCid1',
      dataGroupCid: 'dgCid1',
      filePath: '/fake/input/dir/propCid1/dgCid1.json',
    },
    {
      propertyCid: 'propCid1',
      dataGroupCid: 'dgCid2',
      filePath: '/fake/input/dir/propCid1/dgCid2.json',
    },
  ];

  const mockSchema = {
    type: 'object',
    properties: { test: { type: 'string' } },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    processExitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => {}) as any);

    // Mock fs.promises.stat to simulate a directory
    mockFsStat.mockResolvedValue({ isDirectory: () => true });
    mockReadFileSync.mockImplementation((filePath: string) => {
      if (filePath.includes('dgCid1.json'))
        return JSON.stringify({ schema: 'schemaCid1', test: 'value1' });
      if (filePath.includes('dgCid2.json'))
        return JSON.stringify({ schema: 'schemaCid2', test: 'value2' });
      return '{}';
    });

    // Mock service instances
    MockedFileScannerService.prototype.validateStructure = vi
      .fn()
      .mockResolvedValue({ isValid: true, errors: [] });
    MockedFileScannerService.prototype.countTotalFiles = vi
      .fn()
      .mockResolvedValue(mockFileEntries.length);
    MockedFileScannerService.prototype.scanDirectory = vi
      .fn()
      .mockImplementation(async function* () {
        yield mockFileEntries;
      });

    MockedSchemaCacheService.prototype.getSchema = vi
      .fn()
      .mockResolvedValue(mockSchema);
    MockedJsonValidatorService.prototype.validate = vi
      .fn()
      .mockReturnValue({ valid: true });
    MockedJsonValidatorService.prototype.getErrorMessage = vi
      .fn()
      .mockReturnValue('mock validation error');
    MockedJsonCanonicalizerService.prototype.canonicalize = vi.fn((json) =>
      JSON.stringify(json)
    ); // Simple mock
    MockedCidCalculatorService.prototype.calculateCidV0 = vi
      .fn()
      .mockImplementation(
        async (buffer) => `mockCalculatedCid_${buffer.toString().slice(0, 10)}`
      );

    MockedChainStateService.prototype.getCurrentDataCid = vi
      .fn()
      .mockResolvedValue(null); // Default: not on chain

    // Simulate uploadQueue event emission for testability
    let uploadQueueHandlers: Record<string, Function[]> = {};
    // Patch: Synchronously push to dataItemsForTransaction for test reliability
    MockedPinataService.prototype.uploadBatch = vi
      .fn()
      .mockImplementation(async (filesToUpload: ProcessedFile[]) => {
        // Simulate successful uploads and push to dataItemsForTransaction
        // Find the test's dataItemsForTransaction by monkey-patching global
        if (globalThis.__test_dataItemsForTransaction) {
          filesToUpload.forEach((f) => {
            globalThis.__test_dataItemsForTransaction.push({
              propertyCid: f.propertyCid,
              dataGroupCID: f.dataGroupCid,
              dataCID: `mockIpfsCid_${f.calculatedCid}`,
            });
          });
        }
        return filesToUpload.map((f) => ({
          success: true,
          cid: `mockIpfsCid_${f.calculatedCid}`,
          propertyCid: f.propertyCid,
          dataGroupCid: f.dataGroupCid,
        }));
      });
    MockedPinataService.prototype.getQueueStats = vi.fn().mockReturnValue({
      pending: 0,
      active: 0,
      completed: 0,
      failed: 0,
      total: 0,
    });
    MockedPinataService.prototype.drainQueue = vi
      .fn()
      .mockResolvedValue(undefined);
    // @ts-ignore
    MockedPinataService.prototype.uploadQueue = {
      on: (event: string, handler: Function) => {
        if (!uploadQueueHandlers[event]) uploadQueueHandlers[event] = [];
        uploadQueueHandlers[event].push(handler);
      },
      start: vi.fn(),
    };

    MockedTransactionBatcherService.prototype.submitAll = vi
      .fn()
      .mockImplementation(async function* (items) {
        yield {
          transactionHash: '0xmockTxHash',
          itemsSubmitted: items.length,
          blockNumber: 123,
          gasUsed: '100000',
        };
      });
    MockedTransactionBatcherService.prototype.groupItemsIntoBatches = vi.fn(
      (items) => [items]
    );

    MockedCsvReporterService.prototype.initialize = vi
      .fn()
      .mockResolvedValue(undefined);
    MockedCsvReporterService.prototype.logError = vi
      .fn()
      .mockResolvedValue(undefined);
    MockedCsvReporterService.prototype.logWarning = vi
      .fn()
      .mockResolvedValue(undefined);
    MockedCsvReporterService.prototype.finalize = vi.fn().mockResolvedValue({
      totalFiles: 0,
      processedFiles: 0,
      errorCount: 0,
      warningCount: 0,
      uploadedFiles: 0,
      submittedBatches: 0,
      startTime: new Date(),
      endTime: new Date(),
      duration: 0,
    });

    mockProgressTrackerInstance = {
      start: vi.fn(),
      stop: vi.fn(),
      setPhase: vi.fn(),
      reset: vi.fn(),
      incrementProcessed: vi.fn(),
      incrementValid: vi.fn(),
      incrementInvalid: vi.fn(),
      incrementUploaded: vi.fn(),
      incrementSkipped: vi.fn(),
      incrementErrors: vi.fn(),
      incrementWarnings: vi.fn(),
      updateQueues: vi.fn(),
      getMetrics: vi.fn().mockReturnValue({
        validFiles: mockFileEntries.length,
        invalidFiles: 0,
        skippedFiles: 0,
        uploadedFiles: mockFileEntries.length,
        errorCount: 0,
        warningCount: 0,
        elapsedTime: 1000,
      }),
      formatTime: vi.fn().mockReturnValue('1s'),
    };
    MockedProgressTracker.mockImplementation(() => mockProgressTrackerInstance);

    MockedIPFSService.prototype.downloadFile = vi
      .fn()
      .mockResolvedValue({ success: true, path: 'mockPath' });
  });

  afterEach(() => {
    processExitSpy.mockRestore();
  });

  it('should run the full submission process successfully', async () => {
    // Patch: Provide a global array for the mock to push to
    globalThis.__test_dataItemsForTransaction = [];
    await handleSubmitFiles(defaultOptions, {
      fileScannerService: new MockedFileScannerService(),
      ipfsServiceForSchemas: undefined,
      schemaCacheService: new MockedSchemaCacheService(),
      jsonValidatorService: new MockedJsonValidatorService(),
      jsonCanonicalizerService: new MockedJsonCanonicalizerService(),
      cidCalculatorService: new MockedCidCalculatorService(),
      chainStateService: new MockedChainStateService(),
      pinataService: new MockedPinataService(),
      transactionBatcherService: new MockedTransactionBatcherService(),
      csvReporterService: new MockedCsvReporterService(),
      progressTracker: mockProgressTrackerInstance,
    });
    delete globalThis.__test_dataItemsForTransaction;

    expect(logger.info).toHaveBeenCalledWith(
      'Starting submit-files process...'
    );
    expect(mockFsStat).toHaveBeenCalledWith(defaultOptions.inputDir);
    expect(
      MockedFileScannerService.prototype.validateStructure
    ).toHaveBeenCalledWith(defaultOptions.inputDir);
    expect(
      MockedFileScannerService.prototype.countTotalFiles
    ).toHaveBeenCalledWith(defaultOptions.inputDir);
    expect(MockedFileScannerService.prototype.scanDirectory).toHaveBeenCalled();

    // Check validation phase calls for each file
    for (const fileEntry of mockFileEntries) {
      expect(mockReadFileSync).toHaveBeenCalledWith(
        fileEntry.filePath,
        'utf-8'
      );
      expect(MockedSchemaCacheService.prototype.getSchema).toHaveBeenCalled(); // Schema CID would be dynamic
      expect(MockedJsonValidatorService.prototype.validate).toHaveBeenCalled();
    }

    // Check processing phase calls for each file
    for (const fileEntry of mockFileEntries) {
      expect(
        MockedJsonCanonicalizerService.prototype.canonicalize
      ).toHaveBeenCalled();
      expect(
        MockedCidCalculatorService.prototype.calculateCidV0
      ).toHaveBeenCalled();
      expect(
        MockedChainStateService.prototype.getCurrentDataCid
      ).toHaveBeenCalledWith(fileEntry.propertyCid, fileEntry.dataGroupCid);
    }

    // Check upload phase
    expect(MockedPinataService.prototype.uploadBatch).toHaveBeenCalled();
    expect(MockedPinataService.prototype.drainQueue).toHaveBeenCalled();

    // Check transaction phase
    expect(
      MockedTransactionBatcherService.prototype.submitAll
    ).toHaveBeenCalled();

    expect(logger.info).toHaveBeenCalledWith('Submit process finished.');
    expect(MockedCsvReporterService.prototype.finalize).toHaveBeenCalled();
    expect(processExitSpy).not.toHaveBeenCalled();
  });

  it('should handle --dry-run correctly', async () => {
    await handleSubmitFiles({ ...defaultOptions, dryRun: true });

    expect(logger.warn).toHaveBeenCalledWith(
      'DRY RUN active: No files will be uploaded, no transactions will be sent.'
    );
    expect(MockedPinataService.prototype.uploadBatch).not.toHaveBeenCalled();
    expect(
      MockedTransactionBatcherService.prototype.submitAll
    ).not.toHaveBeenCalled();

    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('[DRY RUN] Would upload files to IPFS:')
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining(
        '[DRY RUN] Would submit the following data items to the blockchain:'
      )
    );

    expect(processExitSpy).not.toHaveBeenCalled();
  });

  it('should exit if input directory is not a directory', async () => {
    mockFsStat.mockResolvedValue({ isDirectory: () => false });
    await handleSubmitFiles(defaultOptions);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('is not a directory')
    );
    expect(processExitSpy).toHaveBeenCalledWith(1);
  });

  it('should exit if input directory structure validation fails', async () => {
    MockedFileScannerService.prototype.validateStructure = vi
      .fn()
      .mockResolvedValue({ isValid: false, errors: ['mock structure error'] });
    await handleSubmitFiles(defaultOptions);
    expect(logger.error).toHaveBeenCalledWith(
      'Input directory structure is invalid. Errors:'
    );
    expect(logger.error).toHaveBeenCalledWith('- mock structure error');
    expect(processExitSpy).toHaveBeenCalledWith(1);
  });

  it('should handle a file failing JSON schema validation', async () => {
    MockedJsonValidatorService.prototype.validate = vi
      .fn()
      .mockReturnValueOnce({ valid: true }) // First file passes
      .mockReturnValueOnce({
        valid: false,
        errors: [
          {
            path: '/test',
            message: 'is required',
            keyword: 'required',
            params: {},
          },
        ],
      }); // Second file fails

    globalThis.__test_dataItemsForTransaction = [];
    await handleSubmitFiles(defaultOptions, {
      fileScannerService: new MockedFileScannerService(),
      ipfsServiceForSchemas: undefined,
      schemaCacheService: new MockedSchemaCacheService(),
      jsonValidatorService: new MockedJsonValidatorService(),
      jsonCanonicalizerService: new MockedJsonCanonicalizerService(),
      cidCalculatorService: new MockedCidCalculatorService(),
      chainStateService: new MockedChainStateService(),
      pinataService: new MockedPinataService(),
      transactionBatcherService: new MockedTransactionBatcherService(),
      csvReporterService: new MockedCsvReporterService(),
      progressTracker: mockProgressTrackerInstance,
    });
    delete globalThis.__test_dataItemsForTransaction;

    expect(MockedCsvReporterService.prototype.logError).toHaveBeenCalledTimes(
      1
    );
    expect(MockedCsvReporterService.prototype.logError).toHaveBeenCalledWith(
      expect.objectContaining({
        filePath: mockFileEntries[1].filePath,
        error: expect.stringContaining('mock validation error'),
      })
    );
    expect(mockProgressTrackerInstance.incrementInvalid).toHaveBeenCalledTimes(
      1
    );
    expect(mockProgressTrackerInstance.incrementErrors).toHaveBeenCalledTimes(
      1
    );

    // Ensure only the valid file proceeds to upload and transaction
    expect(MockedPinataService.prototype.uploadBatch).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ filePath: mockFileEntries[0].filePath }),
      ])
    );
    expect(MockedPinataService.prototype.uploadBatch).toHaveBeenCalledWith(
      expect.not.arrayContaining([
        // Ensure the failing file is NOT in the batch
        expect.objectContaining({ filePath: mockFileEntries[1].filePath }),
      ])
    );
    // TransactionBatcher should be called with data derived from successfully uploaded files
    // This means if a file fails validation, it shouldn't even reach the upload stage,
    // and thus not the transaction stage.
    expect(
      MockedTransactionBatcherService.prototype.submitAll
    ).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          propertyCid: mockFileEntries[0].propertyCid,
        }),
      ])
    );
    expect(
      MockedTransactionBatcherService.prototype.submitAll
    ).toHaveBeenCalledWith(
      expect.not.arrayContaining([
        expect.objectContaining({
          propertyCid: mockFileEntries[1].propertyCid,
        }),
      ])
    );
  });

  it('should skip upload and submission if data CID already exists on chain', async () => {
    // Mock chain state to return an existing CID that matches the calculated one for the first file
    MockedChainStateService.prototype.getCurrentDataCid = vi
      .fn()
      .mockResolvedValueOnce('mockCalculatedCid_dgCid1.json') // First file exists
      .mockResolvedValueOnce(null); // Second file does not exist

    globalThis.__test_dataItemsForTransaction = [];
    await handleSubmitFiles(defaultOptions, {
      fileScannerService: new MockedFileScannerService(),
      ipfsServiceForSchemas: undefined,
      schemaCacheService: new MockedSchemaCacheService(),
      jsonValidatorService: new MockedJsonValidatorService(),
      jsonCanonicalizerService: new MockedJsonCanonicalizerService(),
      cidCalculatorService: new MockedCidCalculatorService(),
      chainStateService: new MockedChainStateService(),
      pinataService: new MockedPinataService(),
      transactionBatcherService: new MockedTransactionBatcherService(),
      csvReporterService: new MockedCsvReporterService(),
      progressTracker: mockProgressTrackerInstance,
    });
    delete globalThis.__test_dataItemsForTransaction;

    expect(MockedCsvReporterService.prototype.logWarning).toHaveBeenCalledWith(
      expect.objectContaining({
        filePath: mockFileEntries[0].filePath,
        reason: expect.stringContaining('already exists on chain'),
      })
    );
    expect(mockProgressTrackerInstance.incrementSkipped).toHaveBeenCalledTimes(
      1
    );

    // Only the second file should be uploaded and submitted
    expect(MockedPinataService.prototype.uploadBatch).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ filePath: mockFileEntries[1].filePath }),
      ])
    );
    expect(MockedPinataService.prototype.uploadBatch).toHaveBeenCalledWith(
      expect.not.arrayContaining([
        expect.objectContaining({ filePath: mockFileEntries[0].filePath }),
      ])
    );

    expect(
      MockedTransactionBatcherService.prototype.submitAll
    ).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          propertyCid: mockFileEntries[1].propertyCid,
        }),
      ])
    );
    expect(
      MockedTransactionBatcherService.prototype.submitAll
    ).toHaveBeenCalledWith(
      expect.not.arrayContaining([
        expect.objectContaining({
          propertyCid: mockFileEntries[0].propertyCid,
        }),
      ])
    );
  });
});
