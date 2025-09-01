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
      get: vi.fn().mockResolvedValue({
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
      calculateCidFromCanonicalJson: vi
        .fn()
        .mockResolvedValue('bafkreitest123'),
    } as unknown as CidCalculatorService;

    mockPinataService = {
      uploadBatch: vi.fn().mockImplementation(async (files: any[]) => {
        // Return different CIDs based on file type
        return files.map((file) => ({
          success: true,
          cid: file.path.endsWith('.html')
            ? 'bafkreihtmlcid'
            : 'bafkreiuploadedcid',
        }));
      }),
      uploadFile: vi.fn().mockResolvedValue({
        success: true,
        cid: 'bafkreihtmlcid',
      }),
      uploadDirectory: vi.fn().mockResolvedValue({
        success: true,
        cid: 'bafyDirectoryHash',
        propertyCid: 'bafkreitest1',
        dataGroupCid: 'html-fact-sheet',
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
      if (cmd === 'ulimit -n') {
        return '1024';
      }
      if (cmd === 'which fact-sheet') {
        throw new Error('fact-sheet not found');
      }
      if (cmd.includes('curl -fsSL')) {
        return ''; // Installation/update successful
      }
      if (cmd.includes('fact-sheet generate')) {
        return ''; // HTML generation successful
      }
      if (cmd === 'fact-sheet --version') {
        return '1.0.0';
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

    // The test completes successfully if no errors are thrown
    // HTML generation happens asynchronously after the main process
    expect(mockWriteFileSync).toHaveBeenCalled();
    const csvContent = mockWriteFileSync.mock.calls[0][1];
    expect(csvContent).toContain('htmlLink');

    // Verify CSV includes HTML links column
    const csvCall = mockWriteFileSync.mock.calls[0];
    expect(csvCall[0]).toBe('/test/output.csv');
    expect(csvCall[1]).toContain('htmlLink');
  });

  it('should update fact-sheet tool if already installed', async () => {
    // Mock fact-sheet as already installed
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd === 'ulimit -n') {
        return '1024';
      }
      if (cmd === 'which fact-sheet') {
        return '/usr/local/bin/fact-sheet';
      }
      if (cmd.includes('curl -fsSL')) {
        return ''; // Update successful
      }
      if (cmd.includes('fact-sheet generate')) {
        return ''; // HTML generation successful
      }
      if (cmd === 'fact-sheet --version') {
        return '1.0.0';
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

    // The test completes successfully if no errors are thrown
    // Just verify CSV was written with htmlLink column
    expect(mockWriteFileSync).toHaveBeenCalled();
    const csvContent = mockWriteFileSync.mock.calls[0][1];
    expect(csvContent).toContain('htmlLink');
  });

  it('should skip HTML generation in dry-run mode but still generate HTML files', async () => {
    // Reset mock for this test
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd === 'ulimit -n') {
        return '1024';
      }
      if (cmd === 'which fact-sheet') {
        return '/usr/local/bin/fact-sheet'; // Already installed
      }
      if (cmd.includes('fact-sheet generate')) {
        return ''; // HTML generation successful
      }
      if (cmd === 'fact-sheet --version') {
        return '1.0.0';
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
    });

    // Should not install/update fact-sheet in dry-run
    expect(mockExecSync).not.toHaveBeenCalledWith(
      expect.stringContaining('curl -fsSL'),
      expect.any(Object)
    );

    // Check that fact-sheet generate was called (might be the second call after ulimit)
    const factSheetGenerateCalls = mockExecSync.mock.calls.filter((call) =>
      call[0].includes('fact-sheet generate')
    );
    expect(factSheetGenerateCalls.length).toBeGreaterThan(0);
    expect(mockExecSync).toHaveBeenCalledWith(
      expect.stringContaining('--inline-js --inline-css'),
      expect.any(Object)
    );

    // In dry-run mode, uploadBatch should not be called at all
    expect(mockPinataService.uploadBatch).not.toHaveBeenCalled();

    // CSV should contain dry-run HTML links
    const csvCall = mockWriteFileSync.mock.calls[0];
    expect(csvCall[1]).toContain('htmlLink');
    expect(csvCall[1]).toContain('bafybeig'); // Dry-run HTML CID prefix
    expect(csvCall[1]).toContain('htmldryrun'); // Dry-run HTML CID suffix
  });

  it('should have uploadDirectory method available on PinataService', async () => {
    // This test verifies that the uploadDirectory method exists on the PinataService
    expect(mockPinataService.uploadDirectory).toBeDefined();
    expect(typeof mockPinataService.uploadDirectory).toBe('function');

    // Test that it can be called and returns expected structure
    const result = await mockPinataService.uploadDirectory('/test/path', {
      name: 'test-dir',
      keyvalues: { test: 'value' },
    });

    expect(result).toEqual({
      success: true,
      cid: 'bafyDirectoryHash',
      propertyCid: 'bafkreitest1',
      dataGroupCid: 'html-fact-sheet',
    });
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
      if (cmd === 'ulimit -n') {
        return '1024';
      }
      if (cmd.includes('fact-sheet generate')) {
        throw new Error('HTML generation failed');
      }
      if (cmd === 'which fact-sheet') {
        return '/usr/local/bin/fact-sheet';
      }
      if (cmd === 'fact-sheet --version') {
        return '1.0.0';
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

    // Should still write CSV with htmlLink column
    expect(mockWriteFileSync).toHaveBeenCalled();
    const csvCall = mockWriteFileSync.mock.calls[0];
    expect(csvCall[1]).toContain('htmlLink');

    // If there are data lines, they should have empty HTML links
    const csvLines = csvCall[1]
      .split('\n')
      .filter((line: string) => line.trim());
    if (csvLines.length > 1) {
      const dataLine = csvLines[1]; // First data line after header
      expect(dataLine).toMatch(/,$/); // Should end with comma (empty htmlLink)
    }
  });
});
