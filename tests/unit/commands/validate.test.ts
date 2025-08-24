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
import * as child_process from 'child_process';
import * as os_module from 'os';
import { logger } from '../../../src/utils/logger.js';
import {
  handleValidate,
  ValidateCommandOptions,
} from '../../../src/commands/validate.js';
import { FileScannerService } from '../../../src/services/file-scanner.service.js';
import { SchemaCacheService } from '../../../src/services/schema-cache.service.js';
import { JsonValidatorService } from '../../../src/services/json-validator.service.js';
import { CsvReporterService } from '../../../src/services/csv-reporter.service.js';
import { SimpleProgress } from '../../../src/utils/simple-progress.js';
import { IPFSService } from '../../../src/services/ipfs.service.js';
import { SEED_DATAGROUP_SCHEMA_CID } from '../../../src/config/constants.js';

// Mock the single-property-processor module
vi.mock('../../../src/utils/single-property-processor.js', () => ({
  processSinglePropertyInput: vi.fn(),
  validateDataGroupSchema: vi.fn((schema) => {
    if (!schema || typeof schema !== 'object') {
      return { valid: false, error: 'Schema must be a valid JSON object' };
    }
    if (!schema.properties?.label || !schema.properties?.relationships) {
      return { valid: false, error: 'is not a valid data group schema' };
    }
    if (Object.keys(schema.properties).length !== 2) {
      return { valid: false, error: 'is not a valid data group schema' };
    }
    return { valid: true };
  }),
}));

// Mock the single-property-file-scanner-v2 module
vi.mock('../../../src/utils/single-property-file-scanner-v2.js', () => ({
  scanSinglePropertyDirectoryV2: vi.fn(),
}));

// Mock the schema-manifest service
vi.mock('../../../src/services/schema-manifest.service.js', () => ({
  SchemaManifestService: vi.fn().mockImplementation(() => ({
    loadSchemaManifest: vi.fn().mockResolvedValue({}),
    getDataGroupCidByLabel: vi.fn().mockReturnValue(null),
    getAllDataGroups: vi.fn().mockReturnValue([]),
  })),
}));

// Mock the concurrency-calculator module
vi.mock('../../../src/utils/concurrency-calculator.js', () => ({
  calculateEffectiveConcurrency: vi.fn(() => ({
    effectiveConcurrency: 10,
    reason: 'Test concurrency',
  })),
}));

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
    tmpdir: vi.fn(() => '/tmp'),
  };
});

// Mock fs module
vi.mock('fs', async () => {
  const actual = await vi.importActual('fs');
  return {
    ...actual,
    promises: {
      ...actual.promises,
      stat: vi.fn(),
      readFile: vi.fn(),
      readdir: vi.fn(),
    },
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

// Import the mocked functions
import { processSinglePropertyInput } from '../../../src/utils/single-property-processor.js';
import { calculateEffectiveConcurrency } from '../../../src/utils/concurrency-calculator.js';
import { scanSinglePropertyDirectoryV2 } from '../../../src/utils/single-property-file-scanner-v2.js';

describe('handleValidate', () => {
  let mockFileScannerService: Partial<FileScannerService>;
  let mockSchemaCacheService: Partial<SchemaCacheService>;
  let mockJsonValidatorService: Partial<JsonValidatorService>;
  let mockCsvReporterService: Partial<CsvReporterService>;
  let mockProgressTracker: Partial<SimpleProgress>;
  let mockIpfsService: Partial<IPFSService>;
  let mockCleanup: vi.Mock;

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock execSync to return a valid ulimit value
    vi.mocked(child_process.execSync).mockReturnValue('1024\n');

    // Mock os.cpus to return a standard CPU count
    vi.mocked(os_module.cpus).mockReturnValue(new Array(4));

    // Setup mock cleanup function
    mockCleanup = vi.fn().mockResolvedValue(undefined);

    // Mock processSinglePropertyInput to return a valid input
    // The actualInputDir should now point to the single property directory
    vi.mocked(processSinglePropertyInput).mockResolvedValue({
      actualInputDir: '/tmp/extracted/property-dir',
      tempDir: '/tmp/temp123',
      cleanup: mockCleanup,
    });

    // Mock fsPromises.stat to return directory
    vi.mocked(fsPromises.stat).mockResolvedValue({
      isDirectory: () => true,
      isFile: () => false,
    } as any);

    // Mock fsPromises.readdir to return JSON files for single property
    // Use valid CID names for test files
    vi.mocked(fsPromises.readdir).mockResolvedValue([
      {
        name: 'bafkreigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi.json',
        isDirectory: () => false,
        isFile: () => true,
      },
      {
        name: 'bafkreihqjagfsqpsozsqcrnvhc3kqvhxwzp7p3dhsxdnhqcwjeqtpumiry.json',
        isDirectory: () => false,
        isFile: () => true,
      },
    ] as any);

    // Initialize mock services
    mockFileScannerService = {
      validateStructure: vi.fn().mockResolvedValue({
        isValid: true,
        errors: [],
      }),
      countTotalFiles: vi.fn().mockResolvedValue(2),
      getAllDataGroupCids: vi
        .fn()
        .mockResolvedValue(
          new Set([
            'bafkreigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi',
          ])
        ),
      scanDirectory: vi.fn().mockImplementation(async function* () {
        yield [
          {
            propertyCid: 'property-1',
            dataGroupCid:
              'bafkreigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi',
            filePath: '/test/property-1/data.json',
          },
          {
            propertyCid: 'property-2',
            dataGroupCid:
              'bafkreigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi',
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

    // Mock fs.promises.readFile
    vi.spyOn(fsPromises, 'readFile').mockResolvedValue(
      JSON.stringify({ label: 'test', relationships: {} })
    );

    // Mock scanSinglePropertyDirectoryV2 to return test data
    // This will be overridden in individual tests as needed
    vi.mocked(scanSinglePropertyDirectoryV2).mockImplementation(async () => {
      // Check what files were mocked in readdir to determine what to return
      const readdirResult = await vi.mocked(fsPromises.readdir).mock.results[0]
        ?.value;
      const files = readdirResult || [];

      const hasSeedFile = files.some((f: any) =>
        f?.name?.includes(SEED_DATAGROUP_SCHEMA_CID)
      );

      const allFiles = files
        .filter((f: any) => f?.name?.endsWith('.json'))
        .map((f: any) => {
          const dataGroupCid = f.name.replace('.json', '');
          const isSeed = dataGroupCid === SEED_DATAGROUP_SCHEMA_CID;
          return {
            propertyCid:
              hasSeedFile && !isSeed
                ? 'SEED_PENDING:property-dir'
                : 'property-dir',
            dataGroupCid,
            filePath: `/tmp/extracted/property-dir/${f.name}`,
          };
        });

      return {
        allFiles,
        validFilesCount: allFiles.length,
        descriptiveFilesCount: 0,
        hasSeedFile,
        propertyCid: hasSeedFile ? 'SEED_PENDING:property-dir' : 'property-dir',
        schemaCids: new Set(allFiles.map((f) => f.dataGroupCid)),
      };
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should validate files successfully when all validations pass', async () => {
    const options: ValidateCommandOptions = {
      input: '/test/input.zip',
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

    // validateStructure and countTotalFiles are no longer called for single property
    expect(mockFileScannerService.validateStructure).not.toHaveBeenCalled();
    expect(mockFileScannerService.countTotalFiles).not.toHaveBeenCalled();
    expect(mockCsvReporterService.initialize).toHaveBeenCalled();
    expect(mockCsvReporterService.finalize).toHaveBeenCalled();
    expect(mockProgressTracker.start).toHaveBeenCalled();
    expect(mockProgressTracker.stop).toHaveBeenCalled();
    expect(mockJsonValidatorService.validate).toHaveBeenCalledTimes(2);
    expect(mockCsvReporterService.getErrorCount).toHaveBeenCalled();
    expect(mockCleanup).toHaveBeenCalled();
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
      input: '/test/input.zip',
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
    // Mock no JSON files found - this will trigger the error
    vi.mocked(fsPromises.readdir).mockResolvedValue([]);

    const options: ValidateCommandOptions = {
      input: '/test/input.zip',
    };

    // Now returns gracefully when no files found instead of exiting
    await handleValidate(options, {
      fileScannerService: mockFileScannerService as FileScannerService,
      schemaCacheService: mockSchemaCacheService as SchemaCacheService,
      jsonValidatorService: mockJsonValidatorService as JsonValidatorService,
      csvReporterService: mockCsvReporterService as CsvReporterService,
      progressTracker: mockProgressTracker as SimpleProgress,
      ipfsServiceForSchemas: mockIpfsService as IPFSService,
    });

    // validateStructure is no longer called for single property processing
    expect(mockCsvReporterService.finalize).toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      'No JSON files found in the property directory'
    );
  });

  it('should handle seed files validation', async () => {
    // Mock readdir to include seed file
    vi.mocked(fsPromises.readdir).mockResolvedValue([
      {
        name: `${SEED_DATAGROUP_SCHEMA_CID}.json`,
        isDirectory: () => false,
        isFile: () => true,
      },
      {
        name: 'bafkreigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi.json',
        isDirectory: () => false,
        isFile: () => true,
      },
    ] as any);

    const options: ValidateCommandOptions = {
      input: '/test/input.zip',
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
    // Mock readdir to include seed file with validation that will fail
    vi.mocked(fsPromises.readdir).mockResolvedValue([
      {
        name: `${SEED_DATAGROUP_SCHEMA_CID}.json`,
        isDirectory: () => false,
        isFile: () => true,
      },
      {
        name: 'bafkreigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi.json',
        isDirectory: () => false,
        isFile: () => true,
      },
    ] as any);

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
      input: '/test/input.zip',
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
      expect.stringContaining('Skipping file')
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
      input: '/test/input.zip',
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
      input: '/test/input.zip',
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
      input: '/test/input.zip',
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

  it('should handle concurrency limits', async () => {
    vi.mocked(calculateEffectiveConcurrency).mockReturnValue({
      effectiveConcurrency: 1536,
      reason: 'User specified: 3000. Capped by OS/heuristic limit to 1536.',
    });

    const options: ValidateCommandOptions = {
      input: '/test/input.zip',
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

    expect(calculateEffectiveConcurrency).toHaveBeenCalledWith({
      userSpecified: 3000,
      fallback: 10,
      windowsFactor: 4,
    });
  });

  it('should handle no files to validate', async () => {
    // Mock no files to process
    vi.mocked(fsPromises.readdir).mockResolvedValue([]);

    const options: ValidateCommandOptions = {
      input: '/test/input.zip',
    };

    await handleValidate(options, {
      fileScannerService: mockFileScannerService as FileScannerService,
      schemaCacheService: mockSchemaCacheService as SchemaCacheService,
      jsonValidatorService: mockJsonValidatorService as JsonValidatorService,
      csvReporterService: mockCsvReporterService as CsvReporterService,
      progressTracker: mockProgressTracker as SimpleProgress,
      ipfsServiceForSchemas: mockIpfsService as IPFSService,
    });

    expect(logger.warn).toHaveBeenCalledWith(
      'No JSON files found in the property directory'
    );
    expect(mockCsvReporterService.finalize).toHaveBeenCalled();
  });

  it('should handle critical errors during validation', async () => {
    mockCsvReporterService.initialize = vi
      .fn()
      .mockRejectedValue(new Error('CSV initialization failed'));

    const options: ValidateCommandOptions = {
      input: '/test/input.zip',
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

  it('should handle invalid ZIP input', async () => {
    vi.mocked(processSinglePropertyInput).mockRejectedValue(
      new Error('Input must be a valid ZIP file')
    );

    const options: ValidateCommandOptions = {
      input: '/test/not-a-zip.txt',
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
      expect.stringContaining('Failed to process input')
    );
  });
});
