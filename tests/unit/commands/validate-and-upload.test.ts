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
  handleValidateAndUpload,
  ValidateAndUploadCommandOptions,
} from '../../../src/commands/validate-and-upload.js';
import { FileScannerService } from '../../../src/services/file-scanner.service.js';
import { SchemaCacheService } from '../../../src/services/schema-cache.service.js';
import {
  JsonValidatorService,
  ValidationError,
} from '../../../src/services/json-validator.service.js';
import { JsonCanonicalizerService } from '../../../src/services/json-canonicalizer.service.cjs';
import { CidCalculatorService } from '../../../src/services/cid-calculator.service.js';
import { PinataService } from '../../../src/services/pinata.service.js';
import { CsvReporterService } from '../../../src/services/csv-reporter.service.js';
import { SimpleProgress } from '../../../src/utils/simple-progress.js';
import { IPFSService } from '../../../src/services/ipfs.service.js';
import { ReportSummary, FileEntry } from '../../../src/types/submit.types.js';
import { DEFAULT_IPFS_GATEWAY } from '../../../src/config/constants.js';
import { ProgressTracker } from '../../../src/utils/progress-tracker.js';

// Define local WalletService interface HERE, before it's used.
interface WalletService {
  getWallet: () => { address: string; provider: any; privateKey: string };
}

// Mock built-in modules first
vi.mock('child_process', async () => {
  const actual =
    await vi.importActual<typeof import('child_process')>('child_process');
  return {
    ...actual,
    execSync: vi.fn(),
  };
});

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return {
    ...actual,
    cpus: vi.fn(() => [
      {
        model: 'Mocked CPU',
        speed: 2500,
        times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 },
      },
      {
        model: 'Mocked CPU',
        speed: 2500,
        times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 },
      },
    ]),
  };
});

// Now import the mocked functions specifically
import { execSync } from 'child_process';
import { cpus } from 'os';

vi.mock('fs', () => ({
  ...vi.importActual('fs'),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  promises: {
    stat: vi.fn(),
    readFile: vi.fn(),
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

vi.mock('../../../src/services/file-scanner.service');

const mockExit = vi.fn();
vi.stubGlobal('process', { ...process, exit: mockExit });

describe('ValidateAndUploadCommand', () => {
  const mockOptions: ValidateAndUploadCommandOptions = {
    pinataJwt: 'test-jwt',
    inputDir: '/test/input',
    outputCsv: 'test-output.csv',
    maxConcurrentUploads: 5,
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
  let mockIpfsService: IPFSService;
  let mockWalletService: WalletService;
  let loggerErrorSpy: MockInstance;
  let loggerWarnSpy: MockInstance;
  let loggerInfoSpy: MockInstance;
  let loggerTechnicalSpy: MockInstance;
  let loggerSuccessSpy: MockInstance;

  beforeEach(() => {
    vi.clearAllMocks();

    // Initialize logger spies
    loggerErrorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
    loggerWarnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    loggerInfoSpy = vi.spyOn(logger, 'info').mockImplementation(() => {});
    loggerTechnicalSpy = vi
      .spyOn(logger, 'technical')
      .mockImplementation(() => {});
    loggerSuccessSpy = vi.spyOn(logger, 'success').mockImplementation(() => {});

    vi.mocked(fsPromises.stat).mockResolvedValue({
      isDirectory: () => true,
    } as any);

    vi.mocked(fs.promises.readFile).mockImplementation(
      async (filePath: any) => {
        if (filePath.includes('property1')) {
          return JSON.stringify({ name: 'Test Property 1' });
        } else if (filePath.includes('property2')) {
          return JSON.stringify({ name: 'Test Property 2' });
        }
        return '';
      }
    );

    mockFileScannerService = {
      validateStructure: vi
        .fn()
        .mockResolvedValue({ isValid: true, errors: [] }),
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
      getAllDataGroupCids: vi.fn().mockResolvedValue(new Set()),
    } as any;

    mockSchemaCacheService = {
      getSchema: vi.fn().mockResolvedValue({
        type: 'object',
        properties: { name: { type: 'string' } },
      }),
    } as any;

    mockJsonValidatorService = {
      validate: vi.fn().mockResolvedValue({ valid: true }),
      getErrorMessages: vi.fn(),
    } as any;

    mockJsonCanonicalizerService = {
      canonicalize: vi.fn().mockImplementation((data) => JSON.stringify(data)),
    } as any;

    mockCidCalculatorService = {
      calculateCidV0: vi.fn().mockResolvedValue('QmTestCid12345'),
      calculateCidAutoFormat: vi.fn().mockResolvedValue('QmTestCid12345'),
    } as any;

    mockPinataService = {
      uploadBatch: vi
        .fn()
        .mockResolvedValueOnce([
          {
            success: true,
            cid: 'QmUploadedCid1',
            propertyCid: 'property1',
            dataGroupCid: 'dataGroup1',
          },
        ])
        .mockResolvedValueOnce([
          {
            success: true,
            cid: 'QmUploadedCid2',
            propertyCid: 'property2',
            dataGroupCid: 'dataGroup2',
          },
        ]),
    } as any;

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
      logWarning: vi.fn(),
      addError: vi.fn(),
      addUploadRecord: vi.fn(),
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
        total: 2,
      }),
    } as any;

    mockIpfsService = {} as any;

    vi.mocked(fs.readFileSync).mockImplementation((filePath: any) => {
      if (filePath.includes('property1')) {
        return JSON.stringify({ name: 'Test Property 1' });
      } else if (filePath.includes('property2')) {
        return JSON.stringify({ name: 'Test Property 2' });
      }
      return '';
    });

    mockWalletService = {
      getWallet: vi.fn().mockReturnValue({
        address: '0xUserAddress',
        provider: {},
        privateKey: 'testKey',
      }),
    } as WalletService;
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
    };

    await handleValidateAndUpload(mockOptions, serviceOverrides);

    expect(mockFileScannerService.validateStructure).toHaveBeenCalledWith(
      '/test/input'
    );
    expect(mockFileScannerService.countTotalFiles).toHaveBeenCalledWith(
      '/test/input'
    );

    expect(mockSchemaCacheService.getSchema).toHaveBeenCalledTimes(2);
    expect(mockJsonValidatorService.validate).toHaveBeenCalledTimes(2);
    expect(mockJsonCanonicalizerService.canonicalize).toHaveBeenCalledTimes(2);
    expect(
      mockCidCalculatorService.calculateCidAutoFormat
    ).toHaveBeenCalledTimes(2);

    expect(mockPinataService.uploadBatch).toHaveBeenCalledTimes(2);
    expect(mockPinataService.uploadBatch).toHaveBeenNthCalledWith(1, [
      expect.objectContaining({ propertyCid: 'property1' }),
    ]);
    expect(mockPinataService.uploadBatch).toHaveBeenNthCalledWith(2, [
      expect.objectContaining({ propertyCid: 'property2' }),
    ]);

    expect(fs.writeFileSync).toHaveBeenCalledWith(
      'test-output.csv',
      expect.stringContaining(
        'propertyCid,dataGroupCid,dataCid,filePath,uploadedAt'
      )
    );

    expect(fs.writeFileSync).toHaveBeenCalledWith(
      'test-output.csv',
      expect.stringContaining('QmUploadedCid1')
    );
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      'test-output.csv',
      expect.stringContaining('QmUploadedCid2')
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
    };

    await handleValidateAndUpload(dryRunOptions, serviceOverrides);

    expect(mockPinataService.uploadBatch).not.toHaveBeenCalled();

    expect(fs.writeFileSync).toHaveBeenCalledWith(
      'test-output.csv',
      expect.stringContaining('QmTestCid12345')
    );
  });

  it('should handle dry run mode without Pinata JWT', async () => {
    const dryRunOptionsWithoutJWT: ValidateAndUploadCommandOptions = {
      inputDir: '/test/input',
      outputCsv: 'test-output.csv',
      maxConcurrentUploads: 5,
      dryRun: true,
      // pinataJwt not provided for dry run
    };
    const serviceOverrides = {
      fileScannerService: mockFileScannerService,
      ipfsServiceForSchemas: mockIpfsService,
      schemaCacheService: mockSchemaCacheService,
      jsonValidatorService: mockJsonValidatorService,
      jsonCanonicalizerService: mockJsonCanonicalizerService,
      cidCalculatorService: mockCidCalculatorService,
      csvReporterService: mockCsvReporterService,
      progressTracker: mockProgressTracker,
      // No pinataService override - should use undefined when dry run
    };

    await handleValidateAndUpload(dryRunOptionsWithoutJWT, serviceOverrides);

    // Should not attempt any uploads in dry run mode
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      'test-output.csv',
      expect.stringContaining('QmTestCid12345')
    );

    // Should have processed both files
    expect(mockSchemaCacheService.getSchema).toHaveBeenCalledTimes(2);
    expect(mockJsonValidatorService.validate).toHaveBeenCalledTimes(2);
  });

  it('should handle validation errors', async () => {
    vi.mocked(mockJsonValidatorService.validate)
      .mockResolvedValueOnce({
        valid: false,
        errors: [
          {
            path: 'instance.field',
            message: 'is required',
            keyword: 'required',
            params: { missingProperty: 'field' },
          } as ValidationError,
        ],
      })
      .mockResolvedValueOnce({ valid: true });

    vi.mocked(mockJsonValidatorService.getErrorMessages).mockReturnValue([
      'instance.field: is required',
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
    };

    await handleValidateAndUpload(mockOptions, serviceOverrides);

    expect(mockCsvReporterService.logError).toHaveBeenCalledWith(
      expect.objectContaining({
        propertyCid: 'property1',
        error: expect.stringContaining(
          'Validation failed against schema dataGroup1: instance.field: is required'
        ),
      })
    );

    expect(mockPinataService.uploadBatch).toHaveBeenCalledTimes(1);
    expect(mockPinataService.uploadBatch).toHaveBeenCalledWith([
      expect.objectContaining({ propertyCid: 'property2' }),
    ]);
  });

  it('should handle upload failures', async () => {
    const mockFiles: FileEntry[] = [
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
    vi.mocked(mockFileScannerService.scanDirectory).mockImplementation(
      async function* () {
        yield mockFiles;
      }
    );
    vi.mocked(mockFileScannerService.countTotalFiles).mockResolvedValue(
      mockFiles.length
    );

    vi.mocked(mockPinataService.uploadBatch)
      .mockResolvedValueOnce([
        {
          success: true,
          cid: 'QmUploadedCid1',
          propertyCid: 'property1',
          dataGroupCid: 'dataGroup1',
        },
      ])
      .mockRejectedValueOnce(new Error('Pinata upload failed intentionally'));

    const writeFileSyncSpy = vi
      .spyOn(fs, 'writeFileSync')
      .mockImplementation(() => {});

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

    const mainCsvCall = writeFileSyncSpy.mock.calls.find(
      (call) => call[0] === mockOptions.outputCsv
    );
    expect(mainCsvCall).toBeDefined();
    if (mainCsvCall) {
      const csvContent = mainCsvCall[1] as string;
      expect(csvContent).toContain(
        'property1,dataGroup1,QmUploadedCid1,"/test/input/property1/dataGroup1.json",'
      );
      expect(csvContent).not.toContain(
        'property2,dataGroup2,Qm[A-Za-z0-9]{44},'
      );
    }

    writeFileSyncSpy.mockRestore();
  });

  it('should handle invalid directory structure', async () => {
    const EXIT_ERROR_MESSAGE = 'PROCESS_EXIT_INTENTIONALLY_CALLED';
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error(EXIT_ERROR_MESSAGE);
    }) as any);

    const specificMockFileScannerService = {
      scanDirectory: async function* () {
        yield* [];
      },
      validateStructure: vi.fn().mockResolvedValue({
        isValid: false,
        message: 'Custom invalid structure message',
      }),
      countTotalFiles: vi.fn().mockResolvedValue(0),
    } as any;

    const serviceOverrides = {
      fileScannerService: specificMockFileScannerService,
      ipfsServiceForSchemas: mockIpfsService,
      schemaCacheService: mockSchemaCacheService,
      jsonValidatorService: mockJsonValidatorService,
      jsonCanonicalizerService: mockJsonCanonicalizerService,
      cidCalculatorService: mockCidCalculatorService,
      pinataService: mockPinataService,
      csvReporterService: mockCsvReporterService,
      progressTracker: mockProgressTracker,
    };

    await expect(
      handleValidateAndUpload(
        { ...mockOptions, inputDir: '/invalid/structure' },
        serviceOverrides
      )
    ).rejects.toThrowError(EXIT_ERROR_MESSAGE);

    expect(
      specificMockFileScannerService.validateStructure
    ).toHaveBeenCalledWith('/invalid/structure');
    expect(loggerWarnSpy).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(mockPinataService.uploadBatch).not.toHaveBeenCalled();

    exitSpy.mockRestore();
  });

  describe('Concurrency Logic', () => {
    let originalPlatform: NodeJS.Platform;
    const FALLBACK_CONCURRENCY = 10;
    const WINDOWS_DEFAULT_FACTOR = 4;

    beforeEach(() => {
      originalPlatform = process.platform;
      vi.mocked(execSync).mockReset();
      vi.mocked(cpus).mockReset();

      vi.mocked(fsPromises.stat).mockResolvedValue({
        isDirectory: () => true,
      } as any);
      vi.mocked(mockFileScannerService.validateStructure).mockResolvedValue({
        isValid: true,
        errors: [],
      });
      vi.mocked(mockFileScannerService.countTotalFiles).mockResolvedValue(0);
      vi.mocked(mockFileScannerService.scanDirectory).mockImplementation(
        async function* () {
          yield [];
        }
      );
      vi.mocked(mockFileScannerService.getAllDataGroupCids).mockResolvedValue(
        new Set()
      );

      vi.mocked(mockCsvReporterService.initialize).mockResolvedValue(undefined);
      vi.mocked(mockCsvReporterService.finalize).mockResolvedValue({
        errorCount: 0,
        warningCount: 0,
        startTime: new Date(),
        endTime: new Date(),
        duration: 0,
        totalFiles: 0,
        processedFiles: 0,
        uploadedFiles: 0,
        submittedBatches: 0,
      } as ReportSummary);
    });

    afterEach(() => {
      Object.defineProperty(process, 'platform', { value: originalPlatform });
      vi.mocked(execSync).mockReset();
      vi.mocked(cpus).mockReset();
    });

    const getMinimalOverrides = () => ({
      fileScannerService: mockFileScannerService,
      csvReporterService: mockCsvReporterService,
      schemaCacheService: mockSchemaCacheService,
      jsonValidatorService: mockJsonValidatorService,
      jsonCanonicalizerService: mockJsonCanonicalizerService,
      cidCalculatorService: mockCidCalculatorService,
      pinataService: mockPinataService,
      ipfsServiceForSchemas: mockIpfsService,
      progressTracker: mockProgressTracker,
    });

    it('should use ulimit on Unix-like systems if available', async () => {
      Object.defineProperty(process, 'platform', { value: 'linux' });
      vi.mocked(execSync).mockReturnValue('2048');
      const loggerTechnicalSpy = vi
        .spyOn(logger, 'technical')
        .mockImplementation(() => {});

      await handleValidateAndUpload(
        { ...mockOptions, maxConcurrentUploads: undefined },
        getMinimalOverrides()
      );

      expect(execSync).toHaveBeenCalledWith('ulimit -n', expect.any(Object));
      const expectedCap = Math.floor(2048 * 0.75);
      expect(loggerTechnicalSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          `Effective max concurrent local processing tasks: ${expectedCap}`
        )
      );
      loggerTechnicalSpy.mockRestore();
    });

    it('should use fallback on Unix-like systems if ulimit fails', async () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' });
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error('ulimit failed');
      });
      const loggerTechnicalSpy = vi
        .spyOn(logger, 'technical')
        .mockImplementation(() => {});

      await handleValidateAndUpload(
        { ...mockOptions, maxConcurrentUploads: undefined },
        getMinimalOverrides()
      );

      expect(loggerTechnicalSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          `Effective max concurrent local processing tasks: ${FALLBACK_CONCURRENCY}`
        )
      );
      loggerTechnicalSpy.mockRestore();
    });

    it('should use CPU count heuristic on Windows if no user value is provided', async () => {
      Object.defineProperty(process, 'platform', { value: 'win32' });
      vi.mocked(cpus).mockReturnValue(new Array(4) as any);
      const loggerTechnicalSpy = vi
        .spyOn(logger, 'technical')
        .mockImplementation(() => {});

      await handleValidateAndUpload(
        { ...mockOptions, maxConcurrentUploads: undefined },
        getMinimalOverrides()
      );

      expect(cpus).toHaveBeenCalled();
      const expectedCap = 4 * WINDOWS_DEFAULT_FACTOR;
      expect(loggerTechnicalSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          `Effective max concurrent local processing tasks: ${expectedCap}`
        )
      );
      loggerTechnicalSpy.mockRestore();
    });

    it('should use user-specified concurrency if provided, capped by OS/heuristic limit (Unix)', async () => {
      Object.defineProperty(process, 'platform', { value: 'linux' });
      vi.mocked(execSync).mockReturnValue('100');
      const loggerTechnicalSpy = vi
        .spyOn(logger, 'technical')
        .mockImplementation(() => {});

      await handleValidateAndUpload(
        { ...mockOptions, maxConcurrentUploads: 150 },
        getMinimalOverrides()
      );
      expect(loggerTechnicalSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          `Effective max concurrent local processing tasks: 75`
        )
      );
      loggerTechnicalSpy.mockRestore();
    });

    it('should use user-specified concurrency if provided and within OS/heuristic limit (Windows)', async () => {
      Object.defineProperty(process, 'platform', { value: 'win32' });
      vi.mocked(cpus).mockReturnValue(new Array(8) as any);
      const loggerTechnicalSpy = vi
        .spyOn(logger, 'technical')
        .mockImplementation(() => {});

      await handleValidateAndUpload(
        { ...mockOptions, maxConcurrentUploads: 20 },
        getMinimalOverrides()
      );
      expect(loggerTechnicalSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          `Effective max concurrent local processing tasks: 20`
        )
      );
      loggerTechnicalSpy.mockRestore();
    });

    it('should use user-specified concurrency on Windows if OS heuristic is not used (e.g. user value provided and less than heuristic)', async () => {
      // Correctly mock process.platform as a property
      Object.defineProperty(process, 'platform', {
        value: 'win32',
        configurable: true,
      });
      vi.mocked(os.cpus).mockReturnValue(new Array(8) as any); // Mock 8 CPUs for heuristic

      const loggerTechnicalSpy = vi
        .spyOn(logger, 'technical')
        .mockImplementation(() => {});

      await handleValidateAndUpload(
        { ...mockOptions, maxConcurrentUploads: 5 },
        getMinimalOverrides()
      );

      expect(loggerTechnicalSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          'Effective max concurrent local processing tasks: 5'
        )
      );
      expect(loggerTechnicalSpy).toHaveBeenCalledWith(
        expect.stringContaining('User specified: 5')
      );
      // Corrected assertion: OS/heuristic limit is not applicable here because user specified a value.
      expect(loggerTechnicalSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          'OS/heuristic limit not determined or applicable'
        )
      );
      loggerTechnicalSpy.mockRestore();
    });

    it('should use FALLBACK_CONCURRENCY if user specifies nothing and all OS detection fails (e.g. ulimit errors on Unix)', async () => {
      Object.defineProperty(process, 'platform', { value: 'linux' });
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error('Command failed');
      });
      const loggerTechnicalSpy = vi
        .spyOn(logger, 'technical')
        .mockImplementation(() => {});

      await handleValidateAndUpload(
        { ...mockOptions, maxConcurrentUploads: undefined },
        getMinimalOverrides()
      );

      expect(loggerTechnicalSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          `Effective max concurrent local processing tasks: ${FALLBACK_CONCURRENCY}`
        )
      );
      expect(loggerTechnicalSpy).toHaveBeenCalledWith(
        expect.stringContaining('Using fallback value')
      );
      loggerTechnicalSpy.mockRestore();
    });
  });
});
