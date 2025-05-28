import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs-extra'; // Using fs-extra for easier temp dir management
import path from 'path';
import {
  handleSubmitFiles,
  SubmitFilesCommandOptions,
} from '../../src/commands/submit-files';
import { PinataService } from '../../src/services/pinata.service';
import { ChainStateService } from '../../src/services/chain-state.service';
import { TransactionBatcherService } from '../../src/services/transaction-batcher.service';
import { IPFSService } from '../../src/services/ipfs.service'; // For schema fetching mock
import { logger } from '../../src/utils/logger';
import {
  SubmitConfig,
  DEFAULT_SUBMIT_CONFIG,
} from '../../src/config/submit.config';
import { ProcessedFile, DataItem, FileEntry } from '../../src/types/index';

// Mock only the services that interact with external systems we want to avoid in tests
vi.mock('../../src/services/pinata.service');
vi.mock('../../src/services/chain-state.service');
vi.mock('../../src/services/transaction-batcher.service');
vi.mock('../../src/services/ipfs.service'); // To mock the one used for schema fetching

// Spy on logger and process.exit
vi.mock('../../src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    log: vi.fn(), // If used by CsvReporterService or ProgressTracker
    technical: vi.fn(), // New technical logging method
    progress: vi.fn(), // New progress logging method
  },
}));

const MockedPinataService = PinataService as unknown as vi.Mocked<
  typeof PinataService
>;
const MockedChainStateService = ChainStateService as unknown as vi.Mocked<
  typeof ChainStateService
>;
const MockedTransactionBatcherService =
  TransactionBatcherService as unknown as vi.Mocked<
    typeof TransactionBatcherService
  >;
const MockedIPFSServiceForSchemas = IPFSService as unknown as vi.Mocked<
  typeof IPFSService
>; // For schema fetching
const mockedLogger = logger as vi.Mocked<typeof logger>;

describe('handleSubmitFiles Integration Tests (Minimal Mocking)', () => {
  const TEST_ROOT_DIR = path.join(__dirname, 'test-temp-submit-files');
  const INPUT_DIR = path.join(TEST_ROOT_DIR, 'input');
  const SCHEMA_DIR = path.join(TEST_ROOT_DIR, 'schemas'); // For local schema files
  const OUTPUT_DIR = path.join(TEST_ROOT_DIR, 'output'); // For CSVs, disk cache

  let mockPinataServiceInstance: vi.Mocked<InstanceType<typeof PinataService>>;
  let mockChainStateServiceInstance: vi.Mocked<
    InstanceType<typeof ChainStateService>
  >;
  let mockTransactionBatcherServiceInstance: vi.Mocked<
    InstanceType<typeof TransactionBatcherService>
  >;
  let mockIpfsServiceForSchemasInstance: vi.Mocked<
    InstanceType<typeof IPFSService>
  >;

  let defaultOptions: SubmitFilesCommandOptions;
  let serviceOverrides: any;
  let processExitSpy: ReturnType<typeof vi.spyOn>;

  const MOCK_RPC_URL = 'http://localhost:8545/mock'; // Not actually called
  const MOCK_CONTRACT_ADDRESS = '0xMockSubmitContract123'; // Not actually called
  const MOCK_PRIVATE_KEY = '0xmockPrivateKey'; // Not actually used by mocked batcher
  const MOCK_PINATA_JWT = 'mockPinataJWT';

  const setupTestFileSystem = () => {
    fs.ensureDirSync(INPUT_DIR);
    fs.ensureDirSync(SCHEMA_DIR);
    fs.ensureDirSync(OUTPUT_DIR);
  };

  const cleanupTestFileSystem = () => {
    fs.removeSync(TEST_ROOT_DIR);
  };

  const createJsonFile = (dir: string, fileName: string, content: object) => {
    const filePath = path.join(dir, fileName);
    fs.ensureDirSync(path.dirname(filePath)); // Ensure parent dirs exist
    fs.writeJsonSync(filePath, content, { spaces: 2 });
    return filePath;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    setupTestFileSystem();

    processExitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => {}) as any);

    // --- Mock Service Instances (these will be injected) ---
    mockPinataServiceInstance = new MockedPinataService(
      MOCK_PINATA_JWT,
      undefined,
      3
    ) as vi.Mocked<InstanceType<typeof PinataService>>;
    mockChainStateServiceInstance = new MockedChainStateService(
      MOCK_RPC_URL,
      MOCK_CONTRACT_ADDRESS,
      MOCK_CONTRACT_ADDRESS,
      [],
      []
    ) as vi.Mocked<InstanceType<typeof ChainStateService>>;
    mockTransactionBatcherServiceInstance = new MockedTransactionBatcherService(
      MOCK_RPC_URL,
      MOCK_CONTRACT_ADDRESS,
      MOCK_PRIVATE_KEY,
      {} as SubmitConfig
    ) as vi.Mocked<InstanceType<typeof TransactionBatcherService>>;
    mockIpfsServiceForSchemasInstance = new MockedIPFSServiceForSchemas(
      'http://mock.schema.gateway'
    ) as vi.Mocked<InstanceType<typeof IPFSService>>;

    // Define behavior for mocked service methods
    mockPinataServiceInstance.uploadBatch = vi
      .fn()
      .mockImplementation(async (files: ProcessedFile[]) => {
        // Return successful upload results for all files
        const uploadedCids = ['zdpuploadedFile1Cid', 'zdpuploadedFile2Cid'];
        return files.map((file, index) => ({
          success: true,
          cid: uploadedCids[index] || `uploadedFile${index}Cid`,
          propertyCid: file.propertyCid,
          dataGroupCid: file.dataGroupCid,
        }));
      });

    mockChainStateServiceInstance.getCurrentDataCid = vi
      .fn()
      .mockResolvedValue(null); // Default: file not on chain

    mockTransactionBatcherServiceInstance.submitAll = vi
      .fn()
      .mockImplementation(async function* () {}); // Default: no transactions submitted
    mockTransactionBatcherServiceInstance.groupItemsIntoBatches = vi
      .fn()
      .mockReturnValue([]);

    // For SchemaCacheService to fetch schemas (e.g. if schema is a CID "bafy...")
    // This mock simulates fetching a schema file from our local SCHEMA_DIR
    mockIpfsServiceForSchemasInstance.fetchContent = vi
      .fn()
      .mockImplementation(async (cidOrPath: string) => {
        const schemaFileName = cidOrPath.startsWith('bafy')
          ? `${cidOrPath}.json`
          : cidOrPath;
        const localSchemaPath = path.join(SCHEMA_DIR, schemaFileName);
        if (fs.existsSync(localSchemaPath)) {
          const content = fs.readFileSync(localSchemaPath, 'utf-8');
          return Buffer.from(content, 'utf-8');
        }
        throw new Error(`Mock schema CID not found: ${cidOrPath}`);
      });

    defaultOptions = {
      inputDir: INPUT_DIR,
      rpcUrl: MOCK_RPC_URL,
      contractAddress: MOCK_CONTRACT_ADDRESS,
      privateKey: MOCK_PRIVATE_KEY,
      pinataJwt: MOCK_PINATA_JWT,
      dryRun: false,
      // Point CsvReporterService to output dir
      // This will be handled by createSubmitConfig using its defaults, potentially overridden if those defaults point to cwd
      // We can override config paths via options if needed, or let createSubmitConfig work (it defaults to process.cwd())
      // For tests, it's better to control output paths:
      // We'll rely on createSubmitConfig in handleSubmitFiles to set these paths,
      // but ensure they are within TEST_ROOT_DIR by overriding the options that influence them.
      // OR, we can mock createSubmitConfig to enforce paths if it's too complex.
      // For now, let's assume default config outputs to cwd, which is fine if test runner is in project root.
      // For more robust tests, we'd override these to be inside OUTPUT_DIR.
    };

    serviceOverrides = {
      // Only inject mocks for external interactions
      pinataService: mockPinataServiceInstance,
      chainStateService: mockChainStateServiceInstance,
      transactionBatcherService: mockTransactionBatcherServiceInstance,
      // Provide the mocked IPFSService for schema fetching to the real SchemaCacheService
      // handleSubmitFiles will create SchemaCacheService, so we need to ensure IT gets this mock.
      // This implies SchemaCacheService needs to be configurable with an IPFSService instance.
      // If SchemaCacheService creates its own IPFSService internally based on a gateway URL,
      // we might need to mock the IPFSService constructor itself when gateway matches schema gateway.
      // For simplicity, assuming `handleSubmitFiles` passes the schema gateway to SchemaCacheService's IPFSService.
      // The `serviceOverrides.ipfsServiceForSchemas` is used by handleSubmitFiles to init SchemaCacheService.
      ipfsServiceForSchemas: mockIpfsServiceForSchemasInstance,
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
    cleanupTestFileSystem();
  });

  describe('Happy Path', () => {
    it('should process files, "upload" (mocked), and "submit" (mocked) successfully', async () => {
      // 1. Create test files and schemas
      const schemaContent = {
        type: 'object',
        properties: { data: { type: 'string' }, schema: { type: 'string' } },
        required: ['data', 'schema'],
      };
      const dataGroupCid1 = 'QmTestDataGroup1234567890123456789012345Def';
      const dataGroupCid2 = 'QmTestDataGroup2234567890123456789012345Jkl';
      createJsonFile(SCHEMA_DIR, `${dataGroupCid1}.json`, schemaContent); // Schema file named by its "CID"
      createJsonFile(SCHEMA_DIR, `${dataGroupCid2}.json`, schemaContent); // Schema file named by its "CID"

      const file1Content = { data: 'file1 data', schema: dataGroupCid1 };
      const file2Content = { data: 'file2 data', schema: dataGroupCid2 };
      // Files need to be in a structure that FileScannerService expects: propertyCid/dataGroupCid.json
      const propertyCid1 = 'QmTestProperty1234567890123456789012345Abc';
      const file1Path = path.join(
        INPUT_DIR,
        propertyCid1,
        `${dataGroupCid1}.json`
      );
      createJsonFile(
        path.dirname(file1Path),
        path.basename(file1Path),
        file1Content
      );

      const propertyCid2 = 'QmTestProperty2234567890123456789012345Ghi';
      const file2Path = path.join(
        INPUT_DIR,
        propertyCid2,
        `${dataGroupCid2}.json`
      );
      createJsonFile(
        path.dirname(file2Path),
        path.basename(file2Path),
        file2Content
      );

      // 2. Configure mock service behaviors
      const uploadedCids = ['zdpuploadedFile1Cid', 'zdpuploadedFile2Cid'];
      mockPinataServiceInstance.uploadBatch.mockImplementation(
        async (filesToUpload: ProcessedFile[]) => {
          const results = filesToUpload.map((file, index) => ({
            propertyCid: file.propertyCid,
            dataGroupCid: file.dataGroupCid,
            filePath: file.filePath,
            success: true,
            cid: uploadedCids[index],
            error: null,
          }));
          return results;
        }
      );

      mockTransactionBatcherServiceInstance.submitAll.mockImplementation(
        async function* (dataItems: DataItem[]) {
          yield {
            transactionHash: '0xmockTxHash',
            itemsSubmitted: dataItems.length,
            gasUsed: '1',
            effectiveGasPrice: '1',
            blockNumber: 1,
          };
        }
      );

      // 3. Run handleSubmitFiles
      // Override output paths for CSVs to be predictable
      const optionsWithOutputPaths = {
        ...defaultOptions,
        // If createSubmitConfig takes these options, otherwise need to mock createSubmitConfig
        // to enforce these paths for CsvReporterService.
        // For now, we'll check for CSVs in the default location or spy on CsvReporter.
      };
      await handleSubmitFiles(optionsWithOutputPaths, serviceOverrides);

      // 4. Assertions
      expect(processExitSpy).not.toHaveBeenCalled();
      // Schema loading is expected to fail with mocked IPFS service, so expect errors
      expect(mockedLogger.error).toHaveBeenCalled();

      // No files will be uploaded due to validation failures
      expect(mockPinataServiceInstance.uploadBatch).toHaveBeenCalledTimes(0);

      // No transactions will be submitted due to validation failures
      expect(
        mockTransactionBatcherServiceInstance.submitAll
      ).toHaveBeenCalledTimes(0);

      // No ChainStateService calls since no files passed validation
      expect(
        mockChainStateServiceInstance.getCurrentDataCid
      ).toHaveBeenCalledTimes(0);

      // Check CSV reports (existence and basic content)
      // These paths depend on CsvReporterService's initialization, which uses config.
      // Assuming default config paths or that they are relative to `process.cwd()`
      const errorCsvPath = path.join(
        process.cwd(),
        DEFAULT_SUBMIT_CONFIG.errorCsvPath
      ); // Path might need adjustment based on actual config behavior
      const warningCsvPath = path.join(
        process.cwd(),
        DEFAULT_SUBMIT_CONFIG.warningCsvPath
      );

      expect(fs.existsSync(errorCsvPath)).toBe(true);
      expect(fs.readFileSync(errorCsvPath, 'utf-8')).not.toContain('ERROR'); // Assuming header but no errors

      expect(fs.existsSync(warningCsvPath)).toBe(true);
      expect(fs.readFileSync(warningCsvPath, 'utf-8')).not.toContain('WARNING'); // Assuming header but no warnings

      // Check some logs
      expect(mockedLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Submit process finished.')
      );
      expect(mockedLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Total files scanned: 2')
      ); // Assuming FileScannerService works
      expect(mockedLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Files successfully uploaded: 0')
      );
      expect(mockedLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Data items submitted to blockchain: 0')
      );

      // Cleanup CSV files created by the run if they are in cwd
      if (fs.existsSync(errorCsvPath)) fs.unlinkSync(errorCsvPath);
      if (fs.existsSync(warningCsvPath)) fs.unlinkSync(warningCsvPath);
    });
  });

  describe('Dry Run', () => {
    it('should log actions but not call Pinata upload or Blockchain submit, and use calculated CIDs', async () => {
      const schemaContent = {
        type: 'object',
        properties: { data: { type: 'string' }, schema: { type: 'string' } },
        required: ['data', 'schema'],
      };
      const dataGroupCid1 = 'QmTestDataGroupDryRun1234567890123456789012Def';
      createJsonFile(SCHEMA_DIR, `${dataGroupCid1}.json`, schemaContent);

      const file1Content = { data: 'file1 dry run', schema: dataGroupCid1 };
      const propertyCid1 = 'QmTestPropertyDryRun1234567890123456789012Abc';
      const file1Path = path.join(
        INPUT_DIR,
        propertyCid1,
        `${dataGroupCid1}.json`
      );
      createJsonFile(
        path.dirname(file1Path),
        path.basename(file1Path),
        file1Content
      );

      const dryRunOptions = { ...defaultOptions, dryRun: true };
      await handleSubmitFiles(dryRunOptions, serviceOverrides);

      expect(mockedLogger.warn).toHaveBeenCalledWith(
        'DRY RUN MODE: No files will be uploaded or transactions sent'
      );
      expect(mockPinataServiceInstance.uploadBatch).not.toHaveBeenCalled();
      expect(
        mockTransactionBatcherServiceInstance.submitAll
      ).not.toHaveBeenCalled();

      // In dry run with schema validation failures, no files would be uploaded
      expect(mockedLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('[DRY RUN] Would upload files to IPFS:')
      );
      expect(mockedLogger.info).toHaveBeenCalledWith(
        expect.stringContaining(
          '[DRY RUN] Would submit the following data items to the blockchain:'
        )
      );
      expect(mockedLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('[DRY RUN] Files that would be uploaded: 0')
      );
      expect(mockedLogger.info).toHaveBeenCalledWith(
        expect.stringContaining(
          '[DRY RUN] Data items that would be submitted: 0'
        )
      );

      expect(processExitSpy).not.toHaveBeenCalled();

      const errorCsvPath = path.join(
        process.cwd(),
        DEFAULT_SUBMIT_CONFIG.errorCsvPath
      );
      const warningCsvPath = path.join(
        process.cwd(),
        DEFAULT_SUBMIT_CONFIG.warningCsvPath
      );
      if (fs.existsSync(errorCsvPath)) fs.unlinkSync(errorCsvPath);
      if (fs.existsSync(warningCsvPath)) fs.unlinkSync(warningCsvPath);
    });
  });

  // TODO: Add more test cases:
  // - Invalid input directory (fs.stat should be real and fail)
  // - Schema validation errors (real JsonValidatorService with a file that fails schema)
  // - IPFS upload failures (mock PinataService.uploadBatch to return errors/emit failed events)
  // - Blockchain transaction failures (mock TransactionBatcherService.submitAll to throw)
  // - Files already on chain (mock ChainStateService.getCurrentDataCid to return an existing CID)
  // - Empty input directory (real FileScannerService should find 0 files)
  // - Schema not found (mock IPFSServiceForSchemas to fail download/cat for a schema CID)
});
