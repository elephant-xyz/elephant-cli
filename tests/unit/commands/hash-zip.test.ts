import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fsPromises } from 'fs';
import AdmZip from 'adm-zip';
import { handleHash } from '../../../src/commands/hash.js';
import { SEED_DATAGROUP_SCHEMA_CID } from '../../../src/config/constants.js';
import { ZipExtractorService } from '../../../src/services/zip-extractor.service.js';
import { scanSinglePropertyDirectoryV2 } from '../../../src/utils/single-property-file-scanner-v2.js';
import { SchemaManifestService } from '../../../src/services/schema-manifest.service.js';

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

describe('Hash Command - ZIP Input', () => {
  let mockFileScannerService: any;
  let mockSchemaCacheService: any;
  let mockJsonValidatorService: any;
  let mockCanonicalizerService: any;
  let mockCidCalculatorService: any;
  let mockCsvReporterService: any;
  let mockProgressTracker: any;
  let mockIpldConverterService: any;
  let mockSchemaManifestService: any;

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

    // Mock readdir to simulate single property directory with no subdirectories
    // Use valid CID names for test files
    vi.mocked(fsPromises.readdir).mockResolvedValue([
      {
        name: 'bafkreigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi.json',
        isDirectory: () => false,
        isFile: () => true,
      },
      { name: 'data.json', isDirectory: () => false, isFile: () => true },
    ] as any);

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
      getAllDataGroupCids: vi
        .fn()
        .mockResolvedValue(
          new Set([
            'bafkreigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi',
          ])
        ),
      scanDirectory: vi.fn().mockImplementation(async function* () {
        // Not used for single property processing
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

    mockSchemaManifestService = new SchemaManifestService();

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

    // Mock scanSinglePropertyDirectoryV2
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
            filePath: `${testExtractedDir}/${f.name}`,
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
      // Override the ZipExtractorService mock to return false for isZipFile
      vi.mocked(ZipExtractorService).mockImplementation(
        () =>
          ({
            isZipFile: vi.fn().mockResolvedValue(false),
            extractZip: vi.fn().mockResolvedValue(testExtractedDir),
            getTempRootDir: vi.fn().mockReturnValue('/tmp'),
            cleanup: vi.fn().mockResolvedValue(undefined),
          }) as any
      );

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
        schemaManifestService: mockSchemaManifestService,
      };

      await handleHash(options, serviceOverrides);

      // Get the mocked ZipExtractorService instance
      const zipExtractor = vi.mocked(ZipExtractorService).mock.results[0]
        .value as any;

      // Verify ZIP extraction
      expect(zipExtractor.isZipFile).toHaveBeenCalledWith(testInputZip);
      expect(zipExtractor.extractZip).toHaveBeenCalledWith(testInputZip);

      // validateStructure is no longer called for single property processing

      // Verify CSV was written with correct headers including filePath and uploadedAt
      expect(vi.mocked(fsPromises.writeFile)).toHaveBeenCalledWith(
        testOutputCsv,
        expect.stringContaining(
          'propertyCid,dataGroupCid,dataCid,filePath,uploadedAt'
        ),
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
      // Update readdir mock to include seed file
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
        schemaManifestService: mockSchemaManifestService,
      };

      await handleHash(options, serviceOverrides);

      // Verify seed file was processed
      expect(mockJsonValidatorService.validate).toHaveBeenCalledTimes(2);

      // Verify CSV contains both entries with filePath and uploadedAt columns
      const csvContent = vi.mocked(fsPromises.writeFile).mock
        .calls[0][1] as string;
      expect(csvContent).toContain(
        'propertyCid,dataGroupCid,dataCid,filePath,uploadedAt'
      );

      // Verify ZIP was created
      const mockZip = vi.mocked(AdmZip).mock.results[0].value;
      expect(mockZip.writeZip).toHaveBeenCalledWith(testOutputZip);
    });
  });
});
