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
import * as child_process from 'child_process';
import {
  handleValidateAndUpload,
  ValidateAndUploadCommandOptions,
} from '../../../src/commands/validate-and-upload.js';
import { FileScannerService } from '../../../src/services/file-scanner.service.js';
import { SchemaCacheService } from '../../../src/services/schema-cache.service.js';
import { JsonValidatorService } from '../../../src/services/json-validator.service.js';
import { IPLDCanonicalizerService } from '../../../src/services/ipld-canonicalizer.service.js';
import { CidCalculatorService } from '../../../src/services/cid-calculator.service.js';
import { PinataService } from '../../../src/services/pinata.service.js';
import { CsvReporterService } from '../../../src/services/csv-reporter.service.js';
import { SimpleProgress } from '../../../src/utils/simple-progress.js';
import { IPFSService } from '../../../src/services/ipfs.service.js';
import { FileEntry } from '../../../src/types/submit.types.js';

// Mock modules
vi.mock('child_process', async () => {
  const actual =
    await vi.importActual<typeof import('child_process')>('child_process');
  return {
    ...actual,
    execSync: vi.fn(),
  };
});

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    writeFileSync: vi.fn(),
    existsSync: vi.fn(),
  };
});

vi.mock('../../../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    technical: vi.fn(),
  },
}));

describe('validate-and-upload HTML generation', () => {
  let mockFileScannerService: FileScannerService;
  let mockSchemaCacheService: SchemaCacheService;
  let mockJsonValidatorService: JsonValidatorService;
  let mockCanonicalizerService: IPLDCanonicalizerService;
  let mockCidCalculatorService: CidCalculatorService;
  let mockPinataService: PinataService;
  let mockCsvReporterService: CsvReporterService;
  let mockProgressTracker: SimpleProgress;
  let mockIpfsService: IPFSService;

  const mockExecSync = child_process.execSync as unknown as MockInstance;
  const mockWriteFileSync = fs.writeFileSync as unknown as MockInstance;
  const mockExistsSync = fs.existsSync as unknown as MockInstance;

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock services
    mockFileScannerService = {
      validateStructure: vi
        .fn()
        .mockResolvedValue({ isValid: true, errors: [] }),
      countTotalFiles: vi.fn().mockResolvedValue(2),
      scanDirectory: vi.fn(),
      getAllDataGroupCids: vi.fn().mockResolvedValue(new Set(['bafkreitest'])),
    } as unknown as FileScannerService;

    mockSchemaCacheService = {
      getSchema: vi.fn().mockResolvedValue({
        type: 'object',
        properties: {
          label: { type: 'string' },
          relationships: { type: 'object' },
        },
      }),
    } as unknown as SchemaCacheService;

    mockJsonValidatorService = {
      validate: vi.fn().mockResolvedValue({ valid: true }),
      getErrorMessages: vi.fn().mockReturnValue([]),
    } as unknown as JsonValidatorService;

    mockCanonicalizerService = {
      canonicalize: vi.fn().mockReturnValue('{"test":"data"}'),
    } as unknown as IPLDCanonicalizerService;

    mockCidCalculatorService = {
      calculateCidAutoFormat: vi.fn().mockResolvedValue('bafkreitest123'),
    } as unknown as CidCalculatorService;

    mockPinataService = {
      uploadBatch: vi
        .fn()
        .mockResolvedValue([{ success: true, cid: 'bafkreiuploadedcid' }]),
      uploadFile: vi.fn().mockResolvedValue({
        success: true,
        cid: 'bafkreihtmlcid',
      }),
    } as unknown as PinataService;

    mockCsvReporterService = {
      initialize: vi.fn().mockResolvedValue(undefined),
      logError: vi.fn().mockResolvedValue(undefined),
      finalize: vi.fn().mockResolvedValue(undefined),
    } as unknown as CsvReporterService;

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
    } as unknown as SimpleProgress;

    mockIpfsService = {} as unknown as IPFSService;

    // Mock file system operations
    vi.spyOn(fsPromises, 'stat').mockResolvedValue({
      isDirectory: () => true,
    } as any);

    vi.spyOn(fsPromises, 'readFile').mockResolvedValue(
      JSON.stringify({ test: 'data' })
    );

    vi.spyOn(fsPromises, 'mkdir').mockResolvedValue(undefined);
    vi.spyOn(fsPromises, 'readdir').mockResolvedValue([
      { name: 'bafkreitest1', isDirectory: () => true },
      { name: 'bafkreitest2', isDirectory: () => true },
    ] as any);

    vi.spyOn(fsPromises, 'rm').mockResolvedValue(undefined);

    // Mock fact-sheet tool check
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd === 'which fact-sheet') {
        throw new Error('fact-sheet not found');
      }
      return '';
    });

    mockExistsSync.mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should install fact-sheet tool and generate HTML files', async () => {
    const mockFiles: FileEntry[] = [
      {
        propertyCid: 'bafkreitest1',
        dataGroupCid: 'bafkreitest',
        filePath: '/test/bafkreitest1/data.json',
      },
      {
        propertyCid: 'bafkreitest2',
        dataGroupCid: 'bafkreitest',
        filePath: '/test/bafkreitest2/data.json',
      },
    ];

    mockFileScannerService.scanDirectory = vi
      .fn()
      .mockImplementation(async function* () {
        yield mockFiles;
      });

    const options: ValidateAndUploadCommandOptions = {
      inputDir: '/test',
      outputCsv: '/test/output.csv',
      pinataJwt: 'test-jwt',
      dryRun: false,
    };

    await handleValidateAndUpload(options, {
      fileScannerService: mockFileScannerService,
      schemaCacheService: mockSchemaCacheService,
      jsonValidatorService: mockJsonValidatorService,
      jsonCanonicalizerService: mockCanonicalizerService,
      cidCalculatorService: mockCidCalculatorService,
      pinataService: mockPinataService,
      csvReporterService: mockCsvReporterService,
      progressTracker: mockProgressTracker,
      ipfsServiceForSchemas: mockIpfsService,
    });

    // Verify fact-sheet installation
    expect(mockExecSync).toHaveBeenCalledWith(
      'which fact-sheet',
      expect.objectContaining({ stdio: 'pipe' })
    );
    expect(mockExecSync).toHaveBeenCalledWith(
      expect.stringContaining(
        'curl -fsSL https://raw.githubusercontent.com/elephant-xyz/fact-sheet-template/main/install.sh | bash'
      ),
      expect.objectContaining({ stdio: 'pipe' })
    );

    // Verify HTML generation with inline assets
    expect(mockExecSync).toHaveBeenCalledWith(
      expect.stringContaining('fact-sheet generate --input /test --output'),
      expect.objectContaining({
        encoding: 'utf8',
        cwd: process.cwd(),
        stdio: 'pipe',
      })
    );
    expect(mockExecSync).toHaveBeenCalledWith(
      expect.stringContaining('--inline-js --inline-css'),
      expect.objectContaining({
        encoding: 'utf8',
        cwd: process.cwd(),
        stdio: 'pipe',
      })
    );

    // Verify HTML upload
    expect(mockPinataService.uploadFile).toHaveBeenCalledTimes(2);

    // Verify CSV includes HTML links
    const csvCall = mockWriteFileSync.mock.calls[0];
    expect(csvCall[0]).toBe('/test/output.csv');
    expect(csvCall[1]).toContain('htmlLink');
    expect(csvCall[1]).toContain('http://dweb.link/ipfs/bafkreihtmlcid');
  });

  it('should update fact-sheet tool if already installed', async () => {
    // Mock fact-sheet as already installed
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd === 'which fact-sheet') {
        return '/usr/local/bin/fact-sheet';
      }
      return '';
    });

    const mockFiles: FileEntry[] = [
      {
        propertyCid: 'bafkreitest1',
        dataGroupCid: 'bafkreitest',
        filePath: '/test/bafkreitest1/data.json',
      },
    ];

    mockFileScannerService.scanDirectory = vi
      .fn()
      .mockImplementation(async function* () {
        yield mockFiles;
      });

    const options: ValidateAndUploadCommandOptions = {
      inputDir: '/test',
      outputCsv: '/test/output.csv',
      pinataJwt: 'test-jwt',
      dryRun: false,
    };

    await handleValidateAndUpload(options, {
      fileScannerService: mockFileScannerService,
      schemaCacheService: mockSchemaCacheService,
      jsonValidatorService: mockJsonValidatorService,
      jsonCanonicalizerService: mockCanonicalizerService,
      cidCalculatorService: mockCidCalculatorService,
      pinataService: mockPinataService,
      csvReporterService: mockCsvReporterService,
      progressTracker: mockProgressTracker,
      ipfsServiceForSchemas: mockIpfsService,
    });

    // Verify fact-sheet update
    expect(mockExecSync).toHaveBeenCalledWith(
      expect.stringContaining(
        'curl -fsSL https://raw.githubusercontent.com/elephant-xyz/fact-sheet-template/main/update.sh | bash'
      ),
      expect.objectContaining({ stdio: 'pipe' })
    );
  });

  it('should skip HTML generation in dry-run mode but still generate HTML files', async () => {
    const mockFiles: FileEntry[] = [
      {
        propertyCid: 'bafkreitest1',
        dataGroupCid: 'bafkreitest',
        filePath: '/test/bafkreitest1/data.json',
      },
    ];

    mockFileScannerService.scanDirectory = vi
      .fn()
      .mockImplementation(async function* () {
        yield mockFiles;
      });

    const options: ValidateAndUploadCommandOptions = {
      inputDir: '/test',
      outputCsv: '/test/output.csv',
      pinataJwt: 'test-jwt',
      dryRun: true,
    };

    await handleValidateAndUpload(options, {
      fileScannerService: mockFileScannerService,
      schemaCacheService: mockSchemaCacheService,
      jsonValidatorService: mockJsonValidatorService,
      jsonCanonicalizerService: mockCanonicalizerService,
      cidCalculatorService: mockCidCalculatorService,
      pinataService: mockPinataService,
      csvReporterService: mockCsvReporterService,
      progressTracker: mockProgressTracker,
      ipfsServiceForSchemas: mockIpfsService,
    });

    // Should not install/update fact-sheet in dry-run
    expect(mockExecSync).not.toHaveBeenCalledWith(
      expect.stringContaining('curl -fsSL'),
      expect.any(Object)
    );

    // Should still generate HTML files with inline assets
    expect(mockExecSync).toHaveBeenCalledWith(
      expect.stringContaining('fact-sheet generate'),
      expect.any(Object)
    );
    expect(mockExecSync).toHaveBeenCalledWith(
      expect.stringContaining('--inline-js --inline-css'),
      expect.any(Object)
    );

    // Should not upload to Pinata
    expect(mockPinataService.uploadFile).not.toHaveBeenCalled();

    // CSV should contain dry-run HTML links
    const csvCall = mockWriteFileSync.mock.calls[0];
    expect(csvCall[1]).toContain('dry-run-html-cid');
  });

  it('should continue processing even if HTML generation fails', async () => {
    const mockFiles: FileEntry[] = [
      {
        propertyCid: 'bafkreitest1',
        dataGroupCid: 'bafkreitest',
        filePath: '/test/bafkreitest1/data.json',
      },
    ];

    mockFileScannerService.scanDirectory = vi
      .fn()
      .mockImplementation(async function* () {
        yield mockFiles;
      });

    // Mock HTML generation failure
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd.includes('fact-sheet generate')) {
        throw new Error('HTML generation failed');
      }
      if (cmd === 'which fact-sheet') {
        return '/usr/local/bin/fact-sheet';
      }
      return '';
    });

    const options: ValidateAndUploadCommandOptions = {
      inputDir: '/test',
      outputCsv: '/test/output.csv',
      pinataJwt: 'test-jwt',
      dryRun: false,
    };

    await handleValidateAndUpload(options, {
      fileScannerService: mockFileScannerService,
      schemaCacheService: mockSchemaCacheService,
      jsonValidatorService: mockJsonValidatorService,
      jsonCanonicalizerService: mockCanonicalizerService,
      cidCalculatorService: mockCidCalculatorService,
      pinataService: mockPinataService,
      csvReporterService: mockCsvReporterService,
      progressTracker: mockProgressTracker,
      ipfsServiceForSchemas: mockIpfsService,
    });

    // Should still write CSV without HTML links
    expect(mockWriteFileSync).toHaveBeenCalled();
    const csvCall = mockWriteFileSync.mock.calls[0];
    expect(csvCall[1]).toContain('htmlLink');
    // HTML links should be empty due to failure
    expect(csvCall[1]).toMatch(/,$/m); // Empty htmlLink column
  });
});
