import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fsPromises } from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';
import { handleHash } from '../../../src/commands/hash.js';
import { FileScannerService } from '../../../src/services/file-scanner.service.js';
import { SchemaCacheService } from '../../../src/services/schema-cache.service.js';
import { JsonValidatorService } from '../../../src/services/json-validator.service.js';
import { IPLDCanonicalizerService } from '../../../src/services/ipld-canonicalizer.service.js';
import { CidCalculatorService } from '../../../src/services/cid-calculator.service.js';
import { CsvReporterService } from '../../../src/services/csv-reporter.service.js';
import { SimpleProgress } from '../../../src/utils/simple-progress.js';
import { IPLDConverterService } from '../../../src/services/ipld-converter.service.js';
import { SEED_DATAGROUP_SCHEMA_CID } from '../../../src/config/constants.js';
import { ZipExtractorService } from '../../../src/services/zip-extractor.service.js';

vi.mock('fs', async () => {
  const actual = await vi.importActual('fs');
  return {
    ...actual,
    promises: {
      ...actual.promises,
      stat: vi.fn(),
      readFile: vi.fn(),
      readdir: vi.fn(),
      mkdir: vi.fn(),
      mkdtemp: vi.fn(),
      rm: vi.fn(),
      writeFile: vi.fn(),
    },
  };
});

vi.mock('adm-zip');
vi.mock('../../../src/services/zip-extractor.service.js');

describe('Hash Command - ZIP Input', () => {
  let mockFileScannerService: any;
  let mockSchemaCacheService: any;
  let mockJsonValidatorService: any;
  let mockCanonicalizerService: any;
  let mockCidCalculatorService: any;
  let mockCsvReporterService: any;
  let mockProgressTracker: any;
  let mockIpldConverterService: any;

  const testInputZip = '/test/input.zip';
  const testOutputZip = '/test/output/hashed.zip';
  const testOutputCsv = '/test/output/upload-results.csv';
  const testExtractedDir = '/tmp/extracted';

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock file system operations for ZIP file
    vi.mocked(fsPromises.stat).mockImplementation(async (path) => {
      if (path === testInputZip) {
        return {
          isDirectory: () => false,
          isFile: () => true,
        } as any;
      }
      return {
        isDirectory: () => true,
        isFile: () => false,
      } as any;
    });

    // Mock ZipExtractorService
    vi.mocked(ZipExtractorService).mockImplementation(
      () =>
        ({
          isZipFile: vi.fn().mockResolvedValue(true),
          extractZip: vi.fn().mockResolvedValue(testExtractedDir),
          getTempRootDir: vi.fn().mockReturnValue('/tmp'),
          cleanup: vi.fn().mockResolvedValue(undefined),
        }) as any
    );

    // Create mock services
    mockFileScannerService = {
      validateStructure: vi.fn().mockResolvedValue({
        isValid: true,
        errors: [],
      }),
      countTotalFiles: vi.fn().mockResolvedValue(1),
      getAllDataGroupCids: vi.fn().mockResolvedValue(new Set(['schema-cid-1'])),
      scanDirectory: vi.fn().mockImplementation(async function* () {
        yield [
          {
            filePath: '/tmp/extracted/data.json',
            propertyCid: 'property1',
            dataGroupCid: 'schema-cid-1',
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

    mockCanonicalizerService = {
      canonicalize: vi.fn().mockImplementation((data) => JSON.stringify(data)),
    };

    mockCidCalculatorService = {
      calculateCidFromCanonicalJson: vi
        .fn()
        .mockResolvedValue(
          'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi'
        ),
      calculateCidV1: vi
        .fn()
        .mockResolvedValue(
          'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi'
        ),
      calculateCidV1ForRawData: vi
        .fn()
        .mockResolvedValue(
          'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi'
        ),
    };

    mockCsvReporterService = {
      initialize: vi.fn().mockResolvedValue(undefined),
      finalize: vi.fn().mockResolvedValue(undefined),
      logError: vi.fn().mockResolvedValue(undefined),
    };

    mockProgressTracker = {
      start: vi.fn(),
      stop: vi.fn(),
      setPhase: vi.fn(),
      increment: vi.fn(),
      getMetrics: vi.fn().mockReturnValue({
        startTime: Date.now(),
        errors: 0,
        processed: 1,
        skipped: 0,
        total: 1,
      }),
    };

    mockIpldConverterService = {
      hasIPLDLinks: vi.fn().mockReturnValue(false),
      convertToIPLD: vi.fn().mockResolvedValue({
        convertedData: { test: 'data' },
        hasLinks: false,
        linkedCIDs: [],
      }),
    };

    // Mock AdmZip
    const mockZipInstance = {
      addFile: vi.fn(),
      writeZip: vi.fn(),
    };
    vi.mocked(AdmZip).mockImplementation(() => mockZipInstance as any);

    // Mock console methods
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    // Mock file operations
    vi.mocked(fsPromises.readFile).mockResolvedValue(
      JSON.stringify({ label: 'Test', relationships: {} })
    );
    vi.mocked(fsPromises.writeFile).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('ZIP Input Requirements', () => {
    it('should reject directory input and require ZIP file', async () => {
      // Mock as directory instead of file
      vi.mocked(fsPromises.stat).mockResolvedValueOnce({
        isDirectory: () => true,
        isFile: () => false,
      } as any);

      const mockExit = vi.spyOn(process, 'exit').mockImplementation((() => {
        throw new Error('Process exited');
      }) as any);

      await expect(
        handleHash({
          input: '/test/directory',
          outputZip: testOutputZip,
          outputCsv: testOutputCsv,
        })
      ).rejects.toThrow('Process exited');

      expect(mockExit).toHaveBeenCalledWith(1);
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('Error: Input must be a ZIP file')
      );
      mockExit.mockRestore();
    });

    it('should reject non-ZIP files', async () => {
      // Mock ZipExtractorService to return false for isZipFile
      const mockZipExtractor = new ZipExtractorService() as any;
      mockZipExtractor.isZipFile.mockResolvedValue(false);

      const mockExit = vi.spyOn(process, 'exit').mockImplementation((() => {
        throw new Error('Process exited');
      }) as any);

      await expect(
        handleHash({
          input: testInputZip,
          outputZip: testOutputZip,
          outputCsv: testOutputCsv,
        })
      ).rejects.toThrow('Process exited');

      expect(mockExit).toHaveBeenCalledWith(1);
      mockExit.mockRestore();
    });

    it('should process single property ZIP and generate CSV with output ZIP', async () => {
      const options = {
        input: testInputZip,
        outputZip: testOutputZip,
        outputCsv: testOutputCsv,
      };

      const serviceOverrides = {
        fileScannerService: mockFileScannerService,
        schemaCacheService: mockSchemaCacheService,
        jsonValidatorService: mockJsonValidatorService,
        canonicalizerService: mockCanonicalizerService,
        cidCalculatorService: mockCidCalculatorService,
        csvReporterService: mockCsvReporterService,
        progressTracker: mockProgressTracker,
        ipldConverterService: mockIpldConverterService,
      };

      await handleHash(options, serviceOverrides);

      // Get the mocked ZipExtractorService instance
      const zipExtractor = vi.mocked(ZipExtractorService).mock.results[0]
        .value as any;

      // Verify ZIP extraction
      expect(zipExtractor.isZipFile).toHaveBeenCalledWith(testInputZip);
      expect(zipExtractor.extractZip).toHaveBeenCalledWith(testInputZip);

      // Verify file scanning on extracted directory
      expect(mockFileScannerService.validateStructure).toHaveBeenCalledWith(
        testExtractedDir
      );

      // Verify CSV was written with correct headers
      expect(vi.mocked(fsPromises.writeFile)).toHaveBeenCalledWith(
        testOutputCsv,
        expect.stringContaining('propertyCid,dataGroupCid,dataCid'),
        'utf-8'
      );

      // Verify ZIP creation with single property folder structure
      const mockZip = vi.mocked(AdmZip).mock.results[0].value;
      expect(mockZip.addFile).toHaveBeenCalled();
      expect(mockZip.writeZip).toHaveBeenCalledWith(testOutputZip);

      // Verify the file path doesn't contain 'data/' wrapper
      const addFileCall = mockZip.addFile.mock.calls[0];
      expect(addFileCall[0]).toContain('.json');
      expect(addFileCall[0]).not.toContain('data/');

      // Verify cleanup was called
      expect(zipExtractor.cleanup).toHaveBeenCalledWith('/tmp');
    });

    it('should handle seed datagroup files in single property ZIP', async () => {
      // Update mock to return seed files
      mockFileScannerService.scanDirectory.mockImplementation(
        async function* () {
          yield [
            {
              filePath: `/tmp/extracted/${SEED_DATAGROUP_SCHEMA_CID}.json`,
              propertyCid: 'SEED_PENDING:property',
              dataGroupCid: SEED_DATAGROUP_SCHEMA_CID,
            },
            {
              filePath: '/tmp/extracted/data.json',
              propertyCid: 'SEED_PENDING:property',
              dataGroupCid: 'schema-cid-1',
            },
          ];
        }
      );

      mockFileScannerService.countTotalFiles.mockResolvedValue(2);

      const options = {
        input: testInputZip,
        outputZip: testOutputZip,
        outputCsv: testOutputCsv,
      };

      const serviceOverrides = {
        fileScannerService: mockFileScannerService,
        schemaCacheService: mockSchemaCacheService,
        jsonValidatorService: mockJsonValidatorService,
        canonicalizerService: mockCanonicalizerService,
        cidCalculatorService: mockCidCalculatorService,
        csvReporterService: mockCsvReporterService,
        progressTracker: mockProgressTracker,
        ipldConverterService: mockIpldConverterService,
      };

      await handleHash(options, serviceOverrides);

      // Verify seed file was processed
      expect(mockJsonValidatorService.validate).toHaveBeenCalledTimes(2);

      // Verify CSV contains both entries
      const csvContent = vi.mocked(fsPromises.writeFile).mock
        .calls[0][1] as string;
      expect(csvContent).toContain('propertyCid,dataGroupCid,dataCid');

      // Verify ZIP was created
      const mockZip = vi.mocked(AdmZip).mock.results[0].value;
      expect(mockZip.writeZip).toHaveBeenCalledWith(testOutputZip);
    });
  });
});
