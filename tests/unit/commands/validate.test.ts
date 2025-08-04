import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  MockInstance,
} from 'vitest';
import { promises as fsPromises } from 'fs';
import * as fs from 'fs';
import path from 'path';
import * as child_process from 'child_process';
import * as os from 'os';
import { logger } from '../../../src/utils/logger.js';
import {
  handleValidate,
  ValidateCommandOptions,
} from '../../../src/commands/validate.js';
import { FileScannerService } from '../../../src/services/file-scanner.service.js';
import { SchemaCacheService } from '../../../src/services/schema-cache.service.js';
import {
  JsonValidatorService,
  ValidationError,
} from '../../../src/services/json-validator.service.js';
import { CsvReporterService } from '../../../src/services/csv-reporter.service.js';
import { SimpleProgress } from '../../../src/utils/simple-progress.js';
import { IPFSService } from '../../../src/services/ipfs.service.js';
import { ReportSummary, FileEntry } from '../../../src/types/submit.types.js';
import { DEFAULT_IPFS_GATEWAY } from '../../../src/config/constants.js';
import { SEED_DATAGROUP_SCHEMA_CID } from '../../../src/config/constants.js';

// Mock built-in modules first
vi.mock('child_process', async () => {
  const actual =
    await vi.importActual<typeof import('child_process')>('child_process');
  return {
    ...actual,
    execSync: vi.fn(() => '1024\n'),
  };
});

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return {
    ...actual,
    cpus: vi.fn(() => new Array(4)),
  };
});

// Mock console methods to prevent test output noise
vi.spyOn(console, 'log').mockImplementation(() => {});
vi.spyOn(console, 'error').mockImplementation(() => {});

// Mock logger
vi.mock('../../../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    debug: vi.fn(),
    technical: vi.fn(),
  },
}));

describe('handleValidate', () => {
  let mockFileScannerService: Partial<FileScannerService>;
  let mockSchemaCacheService: Partial<SchemaCacheService>;
  let mockJsonValidatorService: Partial<JsonValidatorService>;
  let mockCsvReporterService: Partial<CsvReporterService>;
  let mockProgressTracker: Partial<SimpleProgress>;
  let mockIpfsService: Partial<IPFSService>;

  let exitSpy: MockInstance;

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock process.exit
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: number) => {
      throw new Error(`process.exit(${code})`);
    });

    // Mock execSync to return a valid ulimit value
    vi.mocked(child_process.execSync).mockReturnValue('1024\n');

    // Mock os.cpus to return a standard CPU count
    vi.mocked(os.cpus).mockReturnValue(new Array(4));

    // Initialize mock services
    mockFileScannerService = {
      validateStructure: vi.fn().mockResolvedValue({
        isValid: true,
        errors: [],
      }),
      countTotalFiles: vi.fn().mockResolvedValue(2),
      getAllDataGroupCids: vi.fn().mockResolvedValue(new Set(['schema-cid-1'])),
      scanDirectory: vi.fn().mockImplementation(async function* () {
        yield [
          {
            propertyCid: 'property-1',
            dataGroupCid: 'schema-cid-1',
            filePath: '/test/property-1/data.json',
          },
          {
            propertyCid: 'property-2',
            dataGroupCid: 'schema-cid-1',
            filePath: '/test/property-2/data.json',
          },
        ];
      }),
    };

    mockSchemaCacheService = {
      getSchema: vi.fn().mockResolvedValue({
        type: 'object',
        properties: {
          label: { type: 'string' },
          relationships: { type: 'object' },
        },
      }),
    };

    mockJsonValidatorService = {
      validate: vi.fn().mockResolvedValue({ valid: true }),
      getErrorMessages: vi.fn().mockReturnValue([]),
    };

    mockCsvReporterService = {
      initialize: vi.fn().mockResolvedValue(undefined),
      logError: vi.fn().mockResolvedValue(undefined),
      logWarning: vi.fn().mockResolvedValue(undefined),
      finalize: vi.fn().mockResolvedValue({
        totalFiles: 2,
        processedFiles: 2,
        errorCount: 0,
        warningCount: 0,
        uploadedFiles: 0,
        submittedBatches: 0,
        startTime: new Date(),
        endTime: new Date(),
        duration: 1000,
      }),
      getErrorCount: vi.fn().mockReturnValue(0),
      getWarningCount: vi.fn().mockReturnValue(0),
    };

    mockProgressTracker = {
      start: vi.fn(),
      stop: vi.fn(),
      increment: vi.fn(),
      setPhase: vi.fn(),
      getMetrics: vi.fn().mockReturnValue({
        startTime: Date.now(),
        errors: 0,
        processed: 2,
        skipped: 0,
        total: 2,
      }),
    };

    mockIpfsService = {
      downloadFile: vi.fn(),
    };

    // Mock fs.promises.stat
    vi.spyOn(fsPromises, 'stat').mockResolvedValue({
      isDirectory: () => true,
    } as any);

    // Mock fs.promises.readFile
    vi.spyOn(fsPromises, 'readFile').mockResolvedValue(
      JSON.stringify({ label: 'test', relationships: {} })
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should validate files successfully when all validations pass', async () => {
    const options: ValidateCommandOptions = {
      inputDir: '/test/input',
      outputCsv: 'test_errors.csv',
    };

    await handleValidate(options, {
      fileScannerService: mockFileScannerService as FileScannerService,
      schemaCacheService: mockSchemaCacheService as SchemaCacheService,
      jsonValidatorService: mockJsonValidatorService as JsonValidatorService,
      csvReporterService: mockCsvReporterService as CsvReporterService,
      progressTracker: mockProgressTracker as SimpleProgress,
      ipfsServiceForSchemas: mockIpfsService as IPFSService,
    });

    expect(mockFileScannerService.validateStructure).toHaveBeenCalledWith(
      '/test/input'
    );
    expect(mockFileScannerService.countTotalFiles).toHaveBeenCalledWith(
      '/test/input'
    );
    expect(mockCsvReporterService.initialize).toHaveBeenCalled();
    expect(mockCsvReporterService.finalize).toHaveBeenCalled();
    expect(mockProgressTracker.start).toHaveBeenCalled();
    expect(mockProgressTracker.stop).toHaveBeenCalled();
    expect(mockJsonValidatorService.validate).toHaveBeenCalledTimes(2);
    expect(mockCsvReporterService.getErrorCount).toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('✅ All files passed validation!')
    );
  });

  it('should handle validation errors and write them to CSV', async () => {
    mockJsonValidatorService.validate = vi.fn().mockResolvedValue({
      valid: false,
      errors: [{ message: 'Invalid data' }],
    });
    mockJsonValidatorService.getErrorMessages = vi
      .fn()
      .mockReturnValue([{ path: '/label', message: 'Label is required' }]);
    mockCsvReporterService.getErrorCount = vi.fn().mockReturnValue(2);
    mockProgressTracker.getMetrics = vi.fn().mockReturnValue({
      startTime: Date.now(),
      errors: 2,
      processed: 0,
      skipped: 0,
      total: 2,
    });

    const options: ValidateCommandOptions = {
      inputDir: '/test/input',
      outputCsv: 'test_errors.csv',
    };

    await handleValidate(options, {
      fileScannerService: mockFileScannerService as FileScannerService,
      schemaCacheService: mockSchemaCacheService as SchemaCacheService,
      jsonValidatorService: mockJsonValidatorService as JsonValidatorService,
      csvReporterService: mockCsvReporterService as CsvReporterService,
      progressTracker: mockProgressTracker as SimpleProgress,
      ipfsServiceForSchemas: mockIpfsService as IPFSService,
    });

    expect(mockCsvReporterService.logError).toHaveBeenCalledWith(
      expect.objectContaining({
        errorMessage: 'Label is required',
        errorPath: '/label',
      })
    );
    expect(mockProgressTracker.increment).toHaveBeenCalledWith('errors');
    expect(logger.technical).toHaveBeenCalledWith(
      'Validation errors will be saved to: test_errors.csv'
    );
  });

  it('should handle invalid directory structure', async () => {
    mockFileScannerService.validateStructure = vi.fn().mockResolvedValue({
      isValid: false,
      errors: ['Invalid directory structure'],
    });

    const options: ValidateCommandOptions = {
      inputDir: '/test/input',
    };

    await expect(
      handleValidate(options, {
        fileScannerService: mockFileScannerService as FileScannerService,
        schemaCacheService: mockSchemaCacheService as SchemaCacheService,
        jsonValidatorService: mockJsonValidatorService as JsonValidatorService,
        csvReporterService: mockCsvReporterService as CsvReporterService,
        progressTracker: mockProgressTracker as SimpleProgress,
        ipfsServiceForSchemas: mockIpfsService as IPFSService,
      })
    ).rejects.toThrow('process.exit(1)');

    expect(mockFileScannerService.validateStructure).toHaveBeenCalled();
    expect(mockCsvReporterService.finalize).toHaveBeenCalled();
  });

  it('should handle seed files validation', async () => {
    mockFileScannerService.scanDirectory = vi
      .fn()
      .mockImplementation(async function* () {
        yield [
          {
            propertyCid: 'seed-dir',
            dataGroupCid: SEED_DATAGROUP_SCHEMA_CID,
            filePath: '/test/seed-dir/seed.json',
          },
          {
            propertyCid: 'SEED_PENDING:seed-dir',
            dataGroupCid: 'schema-cid-1',
            filePath: '/test/seed-dir/data.json',
          },
        ];
      });

    const options: ValidateCommandOptions = {
      inputDir: '/test/input',
    };

    await handleValidate(options, {
      fileScannerService: mockFileScannerService as FileScannerService,
      schemaCacheService: mockSchemaCacheService as SchemaCacheService,
      jsonValidatorService: mockJsonValidatorService as JsonValidatorService,
      csvReporterService: mockCsvReporterService as CsvReporterService,
      progressTracker: mockProgressTracker as SimpleProgress,
      ipfsServiceForSchemas: mockIpfsService as IPFSService,
    });

    expect(mockJsonValidatorService.validate).toHaveBeenCalledTimes(2);
    expect(logger.info).toHaveBeenCalledWith(
      'Validating 1 seed files first...'
    );
  });

  it('should skip files in directories with failed seed validation', async () => {
    mockFileScannerService.scanDirectory = vi
      .fn()
      .mockImplementation(async function* () {
        yield [
          {
            propertyCid: 'seed-dir',
            dataGroupCid: SEED_DATAGROUP_SCHEMA_CID,
            filePath: '/test/seed-dir/seed.json',
          },
          {
            propertyCid: 'SEED_PENDING:seed-dir',
            dataGroupCid: 'schema-cid-1',
            filePath: '/test/seed-dir/data.json',
          },
        ];
      });

    // Make seed validation fail
    let callCount = 0;
    mockJsonValidatorService.validate = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // First call (seed file) fails
        return Promise.resolve({
          valid: false,
          errors: [{ message: 'Invalid seed' }],
        });
      }
      // Subsequent calls succeed (but shouldn't be called due to skip)
      return Promise.resolve({ valid: true });
    });

    mockProgressTracker.getMetrics = vi
      .fn()
      .mockReturnValueOnce({ errors: 0 }) // Before seed validation
      .mockReturnValueOnce({ errors: 1 }) // After seed validation (failed)
      .mockReturnValue({
        startTime: Date.now(),
        errors: 1,
        processed: 0,
        skipped: 1,
        total: 2,
      });

    const options: ValidateCommandOptions = {
      inputDir: '/test/input',
    };

    await handleValidate(options, {
      fileScannerService: mockFileScannerService as FileScannerService,
      schemaCacheService: mockSchemaCacheService as SchemaCacheService,
      jsonValidatorService: mockJsonValidatorService as JsonValidatorService,
      csvReporterService: mockCsvReporterService as CsvReporterService,
      progressTracker: mockProgressTracker as SimpleProgress,
      ipfsServiceForSchemas: mockIpfsService as IPFSService,
    });

    expect(mockJsonValidatorService.validate).toHaveBeenCalledTimes(1); // Only seed file
    expect(mockProgressTracker.increment).toHaveBeenCalledWith('skipped');
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Skipping file /test/seed-dir/data.json')
    );
  });

  it('should handle invalid data group schema', async () => {
    mockSchemaCacheService.getSchema = vi.fn().mockResolvedValue({
      type: 'object',
      properties: {
        // Missing required properties
        label: { type: 'string' },
      },
    });

    const options: ValidateCommandOptions = {
      inputDir: '/test/input',
    };

    await handleValidate(options, {
      fileScannerService: mockFileScannerService as FileScannerService,
      schemaCacheService: mockSchemaCacheService as SchemaCacheService,
      jsonValidatorService: mockJsonValidatorService as JsonValidatorService,
      csvReporterService: mockCsvReporterService as CsvReporterService,
      progressTracker: mockProgressTracker as SimpleProgress,
      ipfsServiceForSchemas: mockIpfsService as IPFSService,
    });

    expect(mockCsvReporterService.logError).toHaveBeenCalledWith(
      expect.objectContaining({
        errorMessage: expect.stringContaining(
          'is not a valid data group schema'
        ),
      })
    );
  });

  it('should handle file read errors', async () => {
    vi.spyOn(fsPromises, 'readFile').mockRejectedValue(
      new Error('File not found')
    );

    const options: ValidateCommandOptions = {
      inputDir: '/test/input',
    };

    await handleValidate(options, {
      fileScannerService: mockFileScannerService as FileScannerService,
      schemaCacheService: mockSchemaCacheService as SchemaCacheService,
      jsonValidatorService: mockJsonValidatorService as JsonValidatorService,
      csvReporterService: mockCsvReporterService as CsvReporterService,
      progressTracker: mockProgressTracker as SimpleProgress,
      ipfsServiceForSchemas: mockIpfsService as IPFSService,
    });

    expect(mockCsvReporterService.logError).toHaveBeenCalledWith(
      expect.objectContaining({
        errorMessage: expect.stringContaining('File read/parse error'),
      })
    );
  });

  it('should handle schema loading errors', async () => {
    mockSchemaCacheService.getSchema = vi.fn().mockResolvedValue(null);

    const options: ValidateCommandOptions = {
      inputDir: '/test/input',
    };

    await handleValidate(options, {
      fileScannerService: mockFileScannerService as FileScannerService,
      schemaCacheService: mockSchemaCacheService as SchemaCacheService,
      jsonValidatorService: mockJsonValidatorService as JsonValidatorService,
      csvReporterService: mockCsvReporterService as CsvReporterService,
      progressTracker: mockProgressTracker as SimpleProgress,
      ipfsServiceForSchemas: mockIpfsService as IPFSService,
    });

    expect(mockCsvReporterService.logError).toHaveBeenCalledWith(
      expect.objectContaining({
        errorMessage: expect.stringContaining('Could not load schema'),
      })
    );
  });

  it('should handle concurrency limits on Unix systems', async () => {
    vi.mocked(child_process.execSync).mockReturnValue('2048\n');
    Object.defineProperty(process, 'platform', {
      value: 'darwin',
      configurable: true,
    });

    const options: ValidateCommandOptions = {
      inputDir: '/test/input',
      maxConcurrentTasks: 3000, // Higher than OS limit
    };

    await handleValidate(options, {
      fileScannerService: mockFileScannerService as FileScannerService,
      schemaCacheService: mockSchemaCacheService as SchemaCacheService,
      jsonValidatorService: mockJsonValidatorService as JsonValidatorService,
      csvReporterService: mockCsvReporterService as CsvReporterService,
      progressTracker: mockProgressTracker as SimpleProgress,
      ipfsServiceForSchemas: mockIpfsService as IPFSService,
    });

    expect(logger.technical).toHaveBeenCalledWith(
      expect.stringContaining('Capped by OS/heuristic limit')
    );
  });

  it('should handle concurrency limits on Windows systems', async () => {
    Object.defineProperty(process, 'platform', {
      value: 'win32',
      configurable: true,
    });
    vi.mocked(os.cpus).mockReturnValue(new Array(8));

    const options: ValidateCommandOptions = {
      inputDir: '/test/input',
    };

    await handleValidate(options, {
      fileScannerService: mockFileScannerService as FileScannerService,
      schemaCacheService: mockSchemaCacheService as SchemaCacheService,
      jsonValidatorService: mockJsonValidatorService as JsonValidatorService,
      csvReporterService: mockCsvReporterService as CsvReporterService,
      progressTracker: mockProgressTracker as SimpleProgress,
      ipfsServiceForSchemas: mockIpfsService as IPFSService,
    });

    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('Windows system detected')
    );
    expect(logger.technical).toHaveBeenCalledWith(
      expect.stringContaining('Derived from OS/heuristic limit')
    );
  });

  it('should handle no files to validate', async () => {
    mockFileScannerService.countTotalFiles = vi.fn().mockResolvedValue(0);
    mockFileScannerService.scanDirectory = vi
      .fn()
      .mockImplementation(async function* () {
        // yield nothing
      });

    const options: ValidateCommandOptions = {
      inputDir: '/test/input',
    };

    await handleValidate(options, {
      fileScannerService: mockFileScannerService as FileScannerService,
      schemaCacheService: mockSchemaCacheService as SchemaCacheService,
      jsonValidatorService: mockJsonValidatorService as JsonValidatorService,
      csvReporterService: mockCsvReporterService as CsvReporterService,
      progressTracker: mockProgressTracker as SimpleProgress,
      ipfsServiceForSchemas: mockIpfsService as IPFSService,
    });

    expect(logger.warn).toHaveBeenCalledWith('No files found to validate');
    expect(mockCsvReporterService.finalize).toHaveBeenCalled();
  });

  it('should handle critical errors during validation', async () => {
    mockCsvReporterService.initialize = vi
      .fn()
      .mockRejectedValue(new Error('CSV initialization failed'));

    const options: ValidateCommandOptions = {
      inputDir: '/test/input',
    };

    await expect(
      handleValidate(options, {
        fileScannerService: mockFileScannerService as FileScannerService,
        schemaCacheService: mockSchemaCacheService as SchemaCacheService,
        jsonValidatorService: mockJsonValidatorService as JsonValidatorService,
        csvReporterService: mockCsvReporterService as CsvReporterService,
        progressTracker: mockProgressTracker as SimpleProgress,
        ipfsServiceForSchemas: mockIpfsService as IPFSService,
      })
    ).rejects.toThrow('process.exit(1)');

    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('CRITICAL_ERROR_VALIDATE')
    );
  });

  it('should handle non-existent input directory', async () => {
    vi.spyOn(fsPromises, 'stat').mockRejectedValue(
      new Error('ENOENT: no such file or directory')
    );

    const options: ValidateCommandOptions = {
      inputDir: '/non/existent/path',
    };

    await expect(
      handleValidate(options, {
        fileScannerService: mockFileScannerService as FileScannerService,
        schemaCacheService: mockSchemaCacheService as SchemaCacheService,
        jsonValidatorService: mockJsonValidatorService as JsonValidatorService,
        csvReporterService: mockCsvReporterService as CsvReporterService,
        progressTracker: mockProgressTracker as SimpleProgress,
        ipfsServiceForSchemas: mockIpfsService as IPFSService,
      })
    ).rejects.toThrow('process.exit(1)');

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Error accessing input directory')
    );
  });

  it('should handle input path that is not a directory', async () => {
    vi.spyOn(fsPromises, 'stat').mockResolvedValue({
      isDirectory: () => false,
    } as any);

    const options: ValidateCommandOptions = {
      inputDir: '/test/file.txt',
    };

    await expect(
      handleValidate(options, {
        fileScannerService: mockFileScannerService as FileScannerService,
        schemaCacheService: mockSchemaCacheService as SchemaCacheService,
        jsonValidatorService: mockJsonValidatorService as JsonValidatorService,
        csvReporterService: mockCsvReporterService as CsvReporterService,
        progressTracker: mockProgressTracker as SimpleProgress,
        ipfsServiceForSchemas: mockIpfsService as IPFSService,
      })
    ).rejects.toThrow('process.exit(1)');

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('is not a directory')
    );
  });
});
