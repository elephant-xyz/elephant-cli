import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { promises as fsPromises } from 'fs';
import * as fs from 'fs';
import path from 'path';
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
import { AssignmentCheckerService } from '../../../src/services/assignment-checker.service.js';
import { IPFSService } from '../../../src/services/ipfs.service.js';

vi.mock('fs', () => ({
  ...vi.importActual('fs'),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  promises: {
    stat: vi.fn(),
  },
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

describe('ValidateAndUploadCommand', () => {
  const mockOptions: ValidateAndUploadCommandOptions = {
    rpcUrl: 'https://test-rpc.com',
    contractAddress: '0x1234567890123456789012345678901234567890',
    privateKey: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
    pinataJwt: 'test-jwt',
    inputDir: '/test/input',
    outputCsv: 'test-output.csv',
    maxConcurrentUploads: 5,
    fromBlock: 1000,
    dryRun: false,
  };

  let mockFileScannerService: FileScannerService;
  let mockSchemaCacheService: SchemaCacheService;
  let mockJsonValidatorService: JsonValidatorService;
  let mockJsonCanonicalizerService: JsonCanonicalizerService;
  let mockCidCalculatorService: CidCalculatorService;
  let mockPinataService: PinataService;
  let mockCsvReporterService: CsvReporterService;
  let mockProgressTracker: SimpleProgress;
  let mockAssignmentCheckerService: AssignmentCheckerService;
  let mockIpfsService: IPFSService;

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock file system operations
    vi.mocked(fsPromises.stat).mockResolvedValue({
      isDirectory: () => true,
    } as any);

    // Create mock services
    mockFileScannerService = {
      validateStructure: vi.fn().mockResolvedValue({ isValid: true, errors: [] }),
      countTotalFiles: vi.fn().mockResolvedValue(2),
      scanDirectory: vi.fn().mockImplementation(async function* () {
        yield [
          {
            propertyCid: 'property1',
            dataGroupCid: 'dataGroup1',
            filePath: '/test/input/property1/dataGroup1.json',
          },
          {
            propertyCid: 'property2',
            dataGroupCid: 'dataGroup2',
            filePath: '/test/input/property2/dataGroup2.json',
          },
        ];
      }),
    } as any;

    mockSchemaCacheService = {
      getSchema: vi.fn().mockResolvedValue({
        type: 'object',
        properties: { name: { type: 'string' } },
      }),
    } as any;

    mockJsonValidatorService = {
      validate: vi.fn().mockResolvedValue({ valid: true }),
      getErrorMessage: vi.fn(),
    } as any;

    mockJsonCanonicalizerService = {
      canonicalize: vi.fn().mockImplementation((data) => JSON.stringify(data)),
    } as any;

    mockCidCalculatorService = {
      calculateCidV0: vi.fn().mockResolvedValue('QmTestCid12345'),
    } as any;

    mockPinataService = {
      uploadBatch: vi.fn().mockResolvedValue([
        {
          success: true,
          cid: 'QmUploadedCid1',
          propertyCid: 'property1',
          dataGroupCid: 'dataGroup1',
        },
        {
          success: true,
          cid: 'QmUploadedCid2',
          propertyCid: 'property2',
          dataGroupCid: 'dataGroup2',
        },
      ]),
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
        processed: 2,
        skipped: 0,
        errors: 0,
        startTime: Date.now() - 1000,
      }),
    } as any;

    mockAssignmentCheckerService = {
      fetchAssignedCids: vi
        .fn()
        .mockResolvedValue(new Set(['property1', 'property2'])),
    } as any;

    mockIpfsService = {} as any;

    // Mock file reads
    vi.mocked(fs.readFileSync).mockImplementation((filePath: any) => {
      if (filePath.includes('property1')) {
        return JSON.stringify({ name: 'Test Property 1' });
      } else if (filePath.includes('property2')) {
        return JSON.stringify({ name: 'Test Property 2' });
      }
      return '';
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should successfully validate and upload files', async () => {
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
      assignmentCheckerService: mockAssignmentCheckerService,
    };

    await handleValidateAndUpload(mockOptions, serviceOverrides);

    // Verify directory validation
    expect(mockFileScannerService.validateStructure).toHaveBeenCalledWith(
      '/test/input'
    );
    expect(mockFileScannerService.countTotalFiles).toHaveBeenCalledWith(
      '/test/input'
    );

    // Verify assignment checking
    expect(mockAssignmentCheckerService.fetchAssignedCids).toHaveBeenCalledWith(
      '0x742d35Cc6634C0532925a3b844Bc9e7595f89ce0',
      1000
    );

    // Verify file processing
    expect(mockSchemaCacheService.getSchema).toHaveBeenCalledTimes(2);
    expect(mockJsonValidatorService.validate).toHaveBeenCalledTimes(2);
    expect(mockJsonCanonicalizerService.canonicalize).toHaveBeenCalledTimes(2);
    expect(mockCidCalculatorService.calculateCidV0).toHaveBeenCalledTimes(2);

    // Verify upload
    expect(mockPinataService.uploadBatch).toHaveBeenCalledWith([
      {
        propertyCid: 'property1',
        dataGroupCid: 'dataGroup1',
        filePath: '/test/input/property1/dataGroup1.json',
        canonicalJson: '{"name":"Test Property 1"}',
        calculatedCid: 'QmTestCid12345',
        validationPassed: true,
      },
      {
        propertyCid: 'property2',
        dataGroupCid: 'dataGroup2',
        filePath: '/test/input/property2/dataGroup2.json',
        canonicalJson: '{"name":"Test Property 2"}',
        calculatedCid: 'QmTestCid12345',
        validationPassed: true,
      },
    ]);

    // Verify CSV output
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      'test-output.csv',
      expect.stringContaining('propertyCid,dataGroupCid,dataCid,filePath,uploadedAt')
    );
  });

  it('should handle dry run mode correctly', async () => {
    const dryRunOptions = { ...mockOptions, dryRun: true };
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
      assignmentCheckerService: mockAssignmentCheckerService,
    };

    await handleValidateAndUpload(dryRunOptions, serviceOverrides);

    // Should not upload in dry run mode
    expect(mockPinataService.uploadBatch).not.toHaveBeenCalled();

    // Should still write CSV with calculated CIDs
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      'test-output.csv',
      expect.stringContaining('QmTestCid12345')
    );
  });

  it('should skip files not assigned to user', async () => {
    // Mock assignment checker to return only property1
    mockAssignmentCheckerService.fetchAssignedCids = vi
      .fn()
      .mockResolvedValue(new Set(['property1']));

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
      assignmentCheckerService: mockAssignmentCheckerService,
    };

    await handleValidateAndUpload(mockOptions, serviceOverrides);

    // Should only process property1
    expect(mockJsonValidatorService.validate).toHaveBeenCalledTimes(1);
    expect(mockPinataService.uploadBatch).toHaveBeenCalledWith([
      expect.objectContaining({ propertyCid: 'property1' }),
    ]);

    // Should log warning for property2
    expect(mockCsvReporterService.logWarning).toHaveBeenCalledWith(
      expect.objectContaining({
        propertyCid: 'property2',
        reason: expect.stringContaining('not assigned to your address'),
      })
    );
  });

  it('should handle validation errors', async () => {
    mockJsonValidatorService.validate = vi
      .fn()
      .mockResolvedValueOnce({ valid: false, errors: ['Invalid data'] })
      .mockResolvedValueOnce({ valid: true });

    mockJsonValidatorService.getErrorMessage = vi
      .fn()
      .mockReturnValue('Invalid data format');

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
      assignmentCheckerService: mockAssignmentCheckerService,
    };

    await handleValidateAndUpload(mockOptions, serviceOverrides);

    // Should log error for property1
    expect(mockCsvReporterService.logError).toHaveBeenCalledWith(
      expect.objectContaining({
        propertyCid: 'property1',
        error: expect.stringContaining('Validation failed'),
      })
    );

    // Should only upload property2
    expect(mockPinataService.uploadBatch).toHaveBeenCalledWith([
      expect.objectContaining({ propertyCid: 'property2' }),
    ]);
  });

  it('should handle upload failures', async () => {
    mockPinataService.uploadBatch = vi.fn().mockResolvedValue([
      {
        success: true,
        cid: 'QmUploadedCid1',
        propertyCid: 'property1',
        dataGroupCid: 'dataGroup1',
      },
      {
        success: false,
        error: 'Network error',
        propertyCid: 'property2',
        dataGroupCid: 'dataGroup2',
      },
    ]);

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
      assignmentCheckerService: mockAssignmentCheckerService,
    };

    await handleValidateAndUpload(mockOptions, serviceOverrides);

    // Should log error for property2
    expect(mockCsvReporterService.logError).toHaveBeenCalledWith(
      expect.objectContaining({
        propertyCid: 'property2',
        error: expect.stringContaining('Upload failed'),
      })
    );

    // CSV should only contain successful upload
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      'test-output.csv',
      expect.not.stringContaining('property2')
    );
  });

  it('should handle invalid directory structure', async () => {
    mockFileScannerService.validateStructure = vi.fn().mockResolvedValue({
      isValid: false,
      errors: ['Invalid directory structure', 'Missing required files'],
    });

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
      assignmentCheckerService: mockAssignmentCheckerService,
    };

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('Process exit');
    });

    await expect(
      handleValidateAndUpload(mockOptions, serviceOverrides)
    ).rejects.toThrow('Process exit');

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(mockPinataService.uploadBatch).not.toHaveBeenCalled();
  });
});