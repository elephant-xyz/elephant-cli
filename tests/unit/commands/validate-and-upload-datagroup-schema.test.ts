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
import { logger } from '../../../src/utils/logger.js';
import {
  handleValidateAndUpload,
  ValidateAndUploadCommandOptions,
} from '../../../src/commands/validate-and-upload.js';
import { FileScannerService } from '../../../src/services/file-scanner.service.js';
import { SchemaCacheService } from '../../../src/services/schema-cache.service.js';
import { JsonValidatorService } from '../../../src/services/json-validator.service.js';
import { JsonCanonicalizerService } from '../../../src/services/json-canonicalizer.service.cjs';
import { CidCalculatorService } from '../../../src/services/cid-calculator.service.js';
import { PinataService } from '../../../src/services/pinata.service.js';
import { CsvReporterService } from '../../../src/services/csv-reporter.service.js';
import { SimpleProgress } from '../../../src/utils/simple-progress.js';
import { IPFSService } from '../../../src/services/ipfs.service.js';
import { ReportSummary } from '../../../src/types/submit.types.js';

vi.mock('fs', () => ({
  ...vi.importActual('fs'),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  promises: {
    stat: vi.fn(),
    readFile: vi.fn(),
  },
}));

describe('ValidateAndUploadCommand - Data Group Schema Validation', () => {
  const mockOptions: ValidateAndUploadCommandOptions = {
    pinataJwt: 'test-jwt',
    inputDir: '/test/input',
    outputCsv: 'test-output.csv',
    maxConcurrentUploads: 5,
    dryRun: true, // Use dry run to avoid upload complications
  };

  let mockFileScannerService: FileScannerService;
  let mockSchemaCacheService: SchemaCacheService;
  let mockJsonValidatorService: JsonValidatorService;
  let mockJsonCanonicalizerService: JsonCanonicalizerService;
  let mockCidCalculatorService: CidCalculatorService;
  let mockPinataService: PinataService;
  let mockCsvReporterService: CsvReporterService;
  let mockProgressTracker: SimpleProgress;
  let mockIpfsService: IPFSService;
  let loggerErrorSpy: MockInstance;

  beforeEach(() => {
    vi.clearAllMocks();

    loggerErrorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
    vi.spyOn(logger, 'warn').mockImplementation(() => {});
    vi.spyOn(logger, 'info').mockImplementation(() => {});
    vi.spyOn(logger, 'technical').mockImplementation(() => {});
    vi.spyOn(logger, 'success').mockImplementation(() => {});

    vi.mocked(fsPromises.stat).mockResolvedValue({
      isDirectory: () => true,
    } as any);

    vi.mocked(fs.promises.readFile).mockResolvedValue(
      JSON.stringify({ name: 'Test Data' })
    );

    mockFileScannerService = {
      validateStructure: vi
        .fn()
        .mockResolvedValue({ isValid: true, errors: [] }),
      countTotalFiles: vi.fn().mockResolvedValue(1),
      scanDirectory: vi.fn().mockImplementation(async function* () {
        yield [
          {
            propertyCid: 'property1',
            dataGroupCid: 'dataGroup1',
            filePath: '/test/input/property1/dataGroup1.json',
          },
        ];
      }),
      getAllDataGroupCids: vi.fn().mockResolvedValue(new Set()),
    } as any;

    mockJsonValidatorService = {
      validate: vi.fn().mockResolvedValue({ valid: true }),
      getErrorMessages: vi.fn(),
    } as any;

    mockJsonCanonicalizerService = {
      canonicalize: vi.fn().mockImplementation((data) => JSON.stringify(data)),
    } as any;

    mockCidCalculatorService = {
      calculateCidAutoFormat: vi.fn().mockResolvedValue('QmTestCid12345'),
      calculateCidFromCanonicalJson: vi
        .fn()
        .mockResolvedValue('QmTestCid12345'),
    } as any;

    mockPinataService = {} as any;

    mockCsvReporterService = {
      initialize: vi.fn().mockResolvedValue(undefined),
      finalize: vi.fn().mockResolvedValue({
        errorCount: 0,
        warningCount: 0,
        startTime: new Date(),
        endTime: new Date(),
        duration: 0,
        totalFiles: 0,
        processedFiles: 0,
        uploadedFiles: 0,
        submittedBatches: 0,
      } as ReportSummary),
      logError: vi.fn(),
    } as any;

    mockProgressTracker = {
      setPhase: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      increment: vi.fn(),
      getMetrics: vi.fn().mockReturnValue({
        processed: 0,
        skipped: 0,
        errors: 0,
        startTime: Date.now() - 1000,
        total: 1,
      }),
    } as any;

    mockIpfsService = {} as any;

    vi.mocked(fs.writeFileSync).mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('validateDataGroupSchema', () => {
    it('should accept valid data group schema with label and relationships', async () => {
      const validSchema = {
        type: 'object',
        properties: {
          label: { type: 'string' },
          relationships: { type: 'array' },
        },
      };

      mockSchemaCacheService = {
        getSchema: vi.fn().mockResolvedValue(validSchema),
      } as any;

      const serviceOverrides = {
        fileScannerService: mockFileScannerService,
        ipfsServiceForSchemas: mockIpfsService,
        schemaCacheService: mockSchemaCacheService,
        jsonValidatorService: mockJsonValidatorService,
        jsonCanonicalizerService: mockJsonCanonicalizerService,
        cidCalculatorService: mockCidCalculatorService,
        pinataService: mockPinataService,
        csvReporterService: mockCsvReporterService,
        progressTracker: mockProgressTracker,
      };

      await handleValidateAndUpload(mockOptions, serviceOverrides);

      expect(mockCsvReporterService.logError).not.toHaveBeenCalled();
      expect(mockJsonValidatorService.validate).toHaveBeenCalled();
    });

    it('should reject schema that is not an object', async () => {
      const invalidSchema = {
        type: 'string', // Not an object
      };

      mockSchemaCacheService = {
        getSchema: vi.fn().mockResolvedValue(invalidSchema),
      } as any;

      const serviceOverrides = {
        fileScannerService: mockFileScannerService,
        ipfsServiceForSchemas: mockIpfsService,
        schemaCacheService: mockSchemaCacheService,
        jsonValidatorService: mockJsonValidatorService,
        jsonCanonicalizerService: mockJsonCanonicalizerService,
        cidCalculatorService: mockCidCalculatorService,
        pinataService: mockPinataService,
        csvReporterService: mockCsvReporterService,
        progressTracker: mockProgressTracker,
      };

      await handleValidateAndUpload(mockOptions, serviceOverrides);

      expect(mockCsvReporterService.logError).toHaveBeenCalledWith(
        expect.objectContaining({
          errorMessage: expect.stringContaining(
            'Schema CID dataGroup1 is not a valid data group schema'
          ),
        })
      );
      expect(mockCsvReporterService.logError).toHaveBeenCalledWith(
        expect.objectContaining({
          errorMessage: expect.stringContaining('https://lexicon.elephant.xyz'),
        })
      );
    });

    it('should reject schema without properties', async () => {
      const invalidSchema = {
        type: 'object',
        // Missing properties
      };

      mockSchemaCacheService = {
        getSchema: vi.fn().mockResolvedValue(invalidSchema),
      } as any;

      const serviceOverrides = {
        fileScannerService: mockFileScannerService,
        ipfsServiceForSchemas: mockIpfsService,
        schemaCacheService: mockSchemaCacheService,
        jsonValidatorService: mockJsonValidatorService,
        jsonCanonicalizerService: mockJsonCanonicalizerService,
        cidCalculatorService: mockCidCalculatorService,
        pinataService: mockPinataService,
        csvReporterService: mockCsvReporterService,
        progressTracker: mockProgressTracker,
      };

      await handleValidateAndUpload(mockOptions, serviceOverrides);

      expect(mockCsvReporterService.logError).toHaveBeenCalledWith(
        expect.objectContaining({
          errorMessage: expect.stringContaining(
            'Schema CID dataGroup1 is not a valid data group schema'
          ),
        })
      );
    });

    it('should reject schema missing label property', async () => {
      const invalidSchema = {
        type: 'object',
        properties: {
          relationships: { type: 'array' },
          // Missing label
        },
      };

      mockSchemaCacheService = {
        getSchema: vi.fn().mockResolvedValue(invalidSchema),
      } as any;

      const serviceOverrides = {
        fileScannerService: mockFileScannerService,
        ipfsServiceForSchemas: mockIpfsService,
        schemaCacheService: mockSchemaCacheService,
        jsonValidatorService: mockJsonValidatorService,
        jsonCanonicalizerService: mockJsonCanonicalizerService,
        cidCalculatorService: mockCidCalculatorService,
        pinataService: mockPinataService,
        csvReporterService: mockCsvReporterService,
        progressTracker: mockProgressTracker,
      };

      await handleValidateAndUpload(mockOptions, serviceOverrides);

      expect(mockCsvReporterService.logError).toHaveBeenCalledWith(
        expect.objectContaining({
          errorMessage: expect.stringContaining(
            'Schema CID dataGroup1 is not a valid data group schema'
          ),
        })
      );
    });

    it('should reject schema missing relationships property', async () => {
      const invalidSchema = {
        type: 'object',
        properties: {
          label: { type: 'string' },
          // Missing relationships
        },
      };

      mockSchemaCacheService = {
        getSchema: vi.fn().mockResolvedValue(invalidSchema),
      } as any;

      const serviceOverrides = {
        fileScannerService: mockFileScannerService,
        ipfsServiceForSchemas: mockIpfsService,
        schemaCacheService: mockSchemaCacheService,
        jsonValidatorService: mockJsonValidatorService,
        jsonCanonicalizerService: mockJsonCanonicalizerService,
        cidCalculatorService: mockCidCalculatorService,
        pinataService: mockPinataService,
        csvReporterService: mockCsvReporterService,
        progressTracker: mockProgressTracker,
      };

      await handleValidateAndUpload(mockOptions, serviceOverrides);

      expect(mockCsvReporterService.logError).toHaveBeenCalledWith(
        expect.objectContaining({
          errorMessage: expect.stringContaining(
            'Schema CID dataGroup1 is not a valid data group schema'
          ),
        })
      );
    });

    it('should reject schema with more than 2 properties', async () => {
      const invalidSchema = {
        type: 'object',
        properties: {
          label: { type: 'string' },
          relationships: { type: 'array' },
          extra: { type: 'string' }, // Extra property
        },
      };

      mockSchemaCacheService = {
        getSchema: vi.fn().mockResolvedValue(invalidSchema),
      } as any;

      const serviceOverrides = {
        fileScannerService: mockFileScannerService,
        ipfsServiceForSchemas: mockIpfsService,
        schemaCacheService: mockSchemaCacheService,
        jsonValidatorService: mockJsonValidatorService,
        jsonCanonicalizerService: mockJsonCanonicalizerService,
        cidCalculatorService: mockCidCalculatorService,
        pinataService: mockPinataService,
        csvReporterService: mockCsvReporterService,
        progressTracker: mockProgressTracker,
      };

      await handleValidateAndUpload(mockOptions, serviceOverrides);

      expect(mockCsvReporterService.logError).toHaveBeenCalledWith(
        expect.objectContaining({
          errorMessage: expect.stringContaining(
            'Schema CID dataGroup1 is not a valid data group schema'
          ),
        })
      );
    });

    it('should reject null or undefined schema', async () => {
      mockSchemaCacheService = {
        getSchema: vi.fn().mockResolvedValue(null),
      } as any;

      const serviceOverrides = {
        fileScannerService: mockFileScannerService,
        ipfsServiceForSchemas: mockIpfsService,
        schemaCacheService: mockSchemaCacheService,
        jsonValidatorService: mockJsonValidatorService,
        jsonCanonicalizerService: mockJsonCanonicalizerService,
        cidCalculatorService: mockCidCalculatorService,
        pinataService: mockPinataService,
        csvReporterService: mockCsvReporterService,
        progressTracker: mockProgressTracker,
      };

      await handleValidateAndUpload(mockOptions, serviceOverrides);

      expect(mockCsvReporterService.logError).toHaveBeenCalledWith(
        expect.objectContaining({
          errorMessage: expect.stringContaining(
            'Could not load schema dataGroup1'
          ),
        })
      );
    });

    it('should reject non-object schema', async () => {
      const invalidSchema = 'not an object';

      mockSchemaCacheService = {
        getSchema: vi.fn().mockResolvedValue(invalidSchema),
      } as any;

      const serviceOverrides = {
        fileScannerService: mockFileScannerService,
        ipfsServiceForSchemas: mockIpfsService,
        schemaCacheService: mockSchemaCacheService,
        jsonValidatorService: mockJsonValidatorService,
        jsonCanonicalizerService: mockJsonCanonicalizerService,
        cidCalculatorService: mockCidCalculatorService,
        pinataService: mockPinataService,
        csvReporterService: mockCsvReporterService,
        progressTracker: mockProgressTracker,
      };

      await handleValidateAndUpload(mockOptions, serviceOverrides);

      expect(mockCsvReporterService.logError).toHaveBeenCalledWith(
        expect.objectContaining({
          errorMessage: expect.stringContaining(
            'Schema CID dataGroup1 is not a valid data group schema'
          ),
        })
      );
    });

    it('should include lexicon URL in error message', async () => {
      const invalidSchema = {
        type: 'object',
        properties: {
          wrongProperty: { type: 'string' },
        },
      };

      mockSchemaCacheService = {
        getSchema: vi.fn().mockResolvedValue(invalidSchema),
      } as any;

      const serviceOverrides = {
        fileScannerService: mockFileScannerService,
        ipfsServiceForSchemas: mockIpfsService,
        schemaCacheService: mockSchemaCacheService,
        jsonValidatorService: mockJsonValidatorService,
        jsonCanonicalizerService: mockJsonCanonicalizerService,
        cidCalculatorService: mockCidCalculatorService,
        pinataService: mockPinataService,
        csvReporterService: mockCsvReporterService,
        progressTracker: mockProgressTracker,
      };

      await handleValidateAndUpload(mockOptions, serviceOverrides);

      expect(mockCsvReporterService.logError).toHaveBeenCalledWith(
        expect.objectContaining({
          errorMessage: expect.stringContaining(
            'For valid data group schemas, please visit https://lexicon.elephant.xyz'
          ),
        })
      );
    });

    it('should increment error count when schema validation fails', async () => {
      const invalidSchema = {
        type: 'string', // Invalid type
      };

      mockSchemaCacheService = {
        getSchema: vi.fn().mockResolvedValue(invalidSchema),
      } as any;

      const serviceOverrides = {
        fileScannerService: mockFileScannerService,
        ipfsServiceForSchemas: mockIpfsService,
        schemaCacheService: mockSchemaCacheService,
        jsonValidatorService: mockJsonValidatorService,
        jsonCanonicalizerService: mockJsonCanonicalizerService,
        cidCalculatorService: mockCidCalculatorService,
        pinataService: mockPinataService,
        csvReporterService: mockCsvReporterService,
        progressTracker: mockProgressTracker,
      };

      await handleValidateAndUpload(mockOptions, serviceOverrides);

      expect(mockProgressTracker.increment).toHaveBeenCalledWith('errors');
    });

    it('should not proceed to data validation when schema validation fails', async () => {
      const invalidSchema = {
        type: 'string',
      };

      mockSchemaCacheService = {
        getSchema: vi.fn().mockResolvedValue(invalidSchema),
      } as any;

      const serviceOverrides = {
        fileScannerService: mockFileScannerService,
        ipfsServiceForSchemas: mockIpfsService,
        schemaCacheService: mockSchemaCacheService,
        jsonValidatorService: mockJsonValidatorService,
        jsonCanonicalizerService: mockJsonCanonicalizerService,
        cidCalculatorService: mockCidCalculatorService,
        pinataService: mockPinataService,
        csvReporterService: mockCsvReporterService,
        progressTracker: mockProgressTracker,
      };

      await handleValidateAndUpload(mockOptions, serviceOverrides);

      // Should not proceed to data validation
      expect(mockJsonValidatorService.validate).not.toHaveBeenCalled();
      expect(mockJsonCanonicalizerService.canonicalize).not.toHaveBeenCalled();
      expect(
        mockCidCalculatorService.calculateCidAutoFormat
      ).not.toHaveBeenCalled();
    });
  });
});
