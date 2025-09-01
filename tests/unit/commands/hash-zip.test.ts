import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fsPromises } from 'fs';
import AdmZip from 'adm-zip';
import { handleHash } from '../../../src/commands/hash.js';
import { SEED_DATAGROUP_SCHEMA_CID } from '../../../src/config/constants.js';
import { ZipExtractorService } from '../../../src/services/zip-extractor.service.js';
import { scanSinglePropertyDirectoryV2 } from '../../../src/utils/single-property-file-scanner-v2.js';

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
  let mockCanonicalizerService: any;
  let mockCidCalculatorService: any;
  let mockCsvReporterService: any;
  let mockProgressTracker: any;
  let mockIpldConverterService: any;
  let mockSchemaManifestService: any;
  let mockProcessExit: any;

  const testInputZip = '/test/input.zip';
  const testOutputZip = '/test/output/hashed.zip';
  const testOutputCsv = '/test/output/hash-results.csv';
  const testExtractedDir = '/tmp/extracted';

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock process.exit to prevent actual exit during tests
    mockProcessExit = vi.spyOn(process, 'exit').mockImplementation(((
      code: number
    ) => {
      throw new Error(`process.exit called with ${code}`);
    }) as any);

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
      get: vi.fn().mockResolvedValue({
        type: 'object',
        properties: {
          label: { type: 'string' },
          relationships: { type: 'object' },
        },
      }),
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

    mockSchemaManifestService = {
      loadSchemaManifest: vi.fn().mockResolvedValue({}),
      getDataGroupCidByLabel: vi.fn().mockReturnValue(null),
      getAllDataGroups: vi.fn().mockReturnValue([]),
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

    // Mock scanSinglePropertyDirectoryV2 - it needs to be async
    const mockScanSinglePropertyDirectoryV2 = vi.fn();
    vi.mocked(scanSinglePropertyDirectoryV2).mockImplementation(
      mockScanSinglePropertyDirectoryV2
    );
  });

  afterEach(() => {
    mockProcessExit.mockRestore();
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
      // Mock scanSinglePropertyDirectoryV2 for this test - no seed file
      vi.mocked(scanSinglePropertyDirectoryV2).mockResolvedValue({
        allFiles: [
          {
            propertyCid: 'property-dir',
            dataGroupCid:
              'bafkreigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi',
            filePath: `${testExtractedDir}/bafkreigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi.json`,
          },
          {
            propertyCid: 'property-dir',
            dataGroupCid: 'data',
            filePath: `${testExtractedDir}/data.json`,
          },
        ],
        validFilesCount: 2,
        descriptiveFilesCount: 0,
        hasSeedFile: false,
        propertyCid: 'property-dir',
        schemaCids: new Set([
          'bafkreigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi',
          'data',
        ]),
      });

      const options = {
        input: testInputZip,
        outputZip: testOutputZip,
        outputCsv: testOutputCsv,
        propertyCid: 'bafkreitestpropertycid', // Provide property CID since no seed
      };

      const serviceOverrides = {
        fileScannerService: mockFileScannerService,
        schemaCacheService: mockSchemaCacheService,
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

      // Verify CSV was written with correct headers including filePath, uploadedAt, and htmlLink
      expect(vi.mocked(fsPromises.writeFile)).toHaveBeenCalledWith(
        testOutputCsv,
        expect.stringContaining(
          'propertyCid,dataGroupCid,dataCid,filePath,uploadedAt,htmlLink'
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

      // Mock scanSinglePropertyDirectoryV2 for this test - WITH seed file
      vi.mocked(scanSinglePropertyDirectoryV2).mockResolvedValue({
        allFiles: [
          {
            propertyCid: 'SEED_PENDING:property-dir',
            dataGroupCid: SEED_DATAGROUP_SCHEMA_CID,
            filePath: `${testExtractedDir}/${SEED_DATAGROUP_SCHEMA_CID}.json`,
          },
          {
            propertyCid: 'SEED_PENDING:property-dir',
            dataGroupCid:
              'bafkreigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi',
            filePath: `${testExtractedDir}/bafkreigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi.json`,
          },
        ],
        validFilesCount: 2,
        descriptiveFilesCount: 0,
        hasSeedFile: true,
        propertyCid: 'SEED_PENDING:property-dir',
        schemaCids: new Set([
          SEED_DATAGROUP_SCHEMA_CID,
          'bafkreigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi',
        ]),
      });

      // Mock CID calculation for seed file
      const seedCalculatedCid = 'bafkreiseedcalculatedcid123456789';
      const seedProcessedCid = 'bafkreiseedprocessedcid123456789'; // CID after processing links
      mockCidCalculatorService.calculateCidFromCanonicalJson
        .mockResolvedValueOnce(seedCalculatedCid) // First call for raw seed
        .mockResolvedValueOnce(seedProcessedCid) // Second call for processed seed with links
        .mockResolvedValue(
          'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi'
        );

      const options = {
        input: testInputZip,
        outputZip: testOutputZip,
        outputCsv: testOutputCsv,
        // No propertyCid provided - should use calculated seed CID
      };

      const serviceOverrides = {
        fileScannerService: mockFileScannerService,
        schemaCacheService: mockSchemaCacheService,
        canonicalizerService: mockCanonicalizerService,
        cidCalculatorService: mockCidCalculatorService,
        csvReporterService: mockCsvReporterService,
        progressTracker: mockProgressTracker,
        ipldConverterService: mockIpldConverterService,
        schemaManifestService: mockSchemaManifestService,
      };

      await handleHash(options, serviceOverrides);

      // Verify seed file was processed by checking CID calculation calls
      // Now we calculate seed CID twice: once raw, once with links processed
      expect(
        mockCidCalculatorService.calculateCidFromCanonicalJson
      ).toHaveBeenCalledTimes(3);

      // Verify CSV contains both entries with filePath, uploadedAt, and htmlLink columns
      const csvContent = vi.mocked(fsPromises.writeFile).mock
        .calls[0][1] as string;
      expect(csvContent).toContain(
        'propertyCid,dataGroupCid,dataCid,filePath,uploadedAt,htmlLink'
      );

      // Verify ZIP was created
      const mockZip = vi.mocked(AdmZip).mock.results[0].value;
      expect(mockZip.writeZip).toHaveBeenCalledWith(testOutputZip);
    });
  });

  describe('Property CID Determination', () => {
    it('should use user-provided property CID when --property-cid is provided', async () => {
      // Mock scanSinglePropertyDirectoryV2 for this test - no seed file
      vi.mocked(scanSinglePropertyDirectoryV2).mockResolvedValue({
        allFiles: [
          {
            propertyCid: 'property-dir',
            dataGroupCid:
              'bafkreigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi',
            filePath: `${testExtractedDir}/bafkreigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi.json`,
          },
        ],
        validFilesCount: 1,
        descriptiveFilesCount: 0,
        hasSeedFile: false,
        propertyCid: 'property-dir',
        schemaCids: new Set([
          'bafkreigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi',
        ]),
      });

      const userProvidedCid = 'bafkreiuserprovidedcid123456789';
      const options = {
        input: testInputZip,
        outputZip: testOutputZip,
        outputCsv: testOutputCsv,
        propertyCid: userProvidedCid,
      };

      const serviceOverrides = {
        fileScannerService: mockFileScannerService,
        schemaCacheService: mockSchemaCacheService,
        canonicalizerService: mockCanonicalizerService,
        cidCalculatorService: mockCidCalculatorService,
        csvReporterService: mockCsvReporterService,
        progressTracker: mockProgressTracker,
        ipldConverterService: mockIpldConverterService,
        schemaManifestService: mockSchemaManifestService,
      };

      await handleHash(options, serviceOverrides);

      // Verify the CSV contains the user-provided property CID
      const csvContent = vi.mocked(fsPromises.writeFile).mock
        .calls[0][1] as string;
      expect(csvContent).toContain(userProvidedCid);

      // Verify the ZIP uses the user-provided CID for folder name
      const mockZip = vi.mocked(AdmZip).mock.results[0].value;
      expect(mockZip.addFile).toHaveBeenCalled();
      const addFileCalls = mockZip.addFile.mock.calls;
      for (const call of addFileCalls) {
        const zipPath = call[0] as string;
        // The path should start with the user-provided CID
        expect(zipPath).toMatch(new RegExp(`^${userProvidedCid}/`));
      }
    });

    it('should use calculated seed CID when no --property-cid is provided but seed file exists', async () => {
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

      // Mock scanSinglePropertyDirectoryV2 for this test - WITH seed file
      vi.mocked(scanSinglePropertyDirectoryV2).mockResolvedValue({
        allFiles: [
          {
            propertyCid: 'SEED_PENDING:property-dir',
            dataGroupCid: SEED_DATAGROUP_SCHEMA_CID,
            filePath: `${testExtractedDir}/${SEED_DATAGROUP_SCHEMA_CID}.json`,
          },
          {
            propertyCid: 'SEED_PENDING:property-dir',
            dataGroupCid:
              'bafkreigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi',
            filePath: `${testExtractedDir}/bafkreigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi.json`,
          },
        ],
        validFilesCount: 2,
        descriptiveFilesCount: 0,
        hasSeedFile: true,
        propertyCid: 'SEED_PENDING:property-dir',
        schemaCids: new Set([
          SEED_DATAGROUP_SCHEMA_CID,
          'bafkreigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi',
        ]),
      });

      // Mock CID calculation for seed file
      const seedCalculatedCid = 'bafkreiseedcalculatedcid123456789';
      // With the new implementation, seed is processed twice and the final CID
      // (with links) is used as the property CID
      const seedProcessedCid = 'bafkreiseedprocessedcid123456789';
      mockCidCalculatorService.calculateCidFromCanonicalJson
        .mockResolvedValueOnce(seedCalculatedCid) // First call for raw seed
        .mockResolvedValueOnce(seedProcessedCid) // Second call for processed seed with links
        .mockResolvedValue(
          'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi'
        );

      const options = {
        input: testInputZip,
        outputZip: testOutputZip,
        outputCsv: testOutputCsv,
        // No propertyCid provided
      };

      const serviceOverrides = {
        fileScannerService: mockFileScannerService,
        schemaCacheService: mockSchemaCacheService,
        canonicalizerService: mockCanonicalizerService,
        cidCalculatorService: mockCidCalculatorService,
        csvReporterService: mockCsvReporterService,
        progressTracker: mockProgressTracker,
        ipldConverterService: mockIpldConverterService,
        schemaManifestService: mockSchemaManifestService,
      };

      await handleHash(options, serviceOverrides);

      // Verify the CSV contains the processed seed CID as property CID
      const csvContent = vi.mocked(fsPromises.writeFile).mock
        .calls[0][1] as string;
      const csvLines = csvContent.split('\n');
      // Skip header and check data lines
      for (let i = 1; i < csvLines.length; i++) {
        const line = csvLines[i];
        if (line && !line.includes(SEED_DATAGROUP_SCHEMA_CID)) {
          // Non-seed files should use the processed seed CID as property CID
          expect(line).toContain(seedProcessedCid);
        }
      }
    });

    it('should throw error when no --property-cid is provided and no seed file exists', async () => {
      // Mock readdir to NOT include seed file
      vi.mocked(fsPromises.readdir).mockResolvedValue([
        {
          name: 'bafkreigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi.json',
          isDirectory: () => false,
          isFile: () => true,
        },
        {
          name: 'bafkreiotherdatafile.json',
          isDirectory: () => false,
          isFile: () => true,
        },
      ] as any);

      // Mock scanSinglePropertyDirectoryV2 for this test - NO seed file
      vi.mocked(scanSinglePropertyDirectoryV2).mockResolvedValue({
        allFiles: [
          {
            propertyCid: 'property-dir',
            dataGroupCid:
              'bafkreigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi',
            filePath: `${testExtractedDir}/bafkreigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi.json`,
          },
          {
            propertyCid: 'property-dir',
            dataGroupCid: 'bafkreiotherdatafile',
            filePath: `${testExtractedDir}/bafkreiotherdatafile.json`,
          },
        ],
        validFilesCount: 2,
        descriptiveFilesCount: 0,
        hasSeedFile: false,
        propertyCid: 'property-dir',
        schemaCids: new Set([
          'bafkreigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi',
          'bafkreiotherdatafile',
        ]),
      });

      const options = {
        input: testInputZip,
        outputZip: testOutputZip,
        outputCsv: testOutputCsv,
        // No propertyCid provided
      };

      const serviceOverrides = {
        fileScannerService: mockFileScannerService,
        schemaCacheService: mockSchemaCacheService,
        canonicalizerService: mockCanonicalizerService,
        cidCalculatorService: mockCidCalculatorService,
        csvReporterService: mockCsvReporterService,
        progressTracker: mockProgressTracker,
        ipldConverterService: mockIpldConverterService,
        schemaManifestService: mockSchemaManifestService,
      };

      // Expect the function to call process.exit due to missing property CID
      await expect(handleHash(options, serviceOverrides)).rejects.toThrow(
        'process.exit called with 1'
      );

      // Verify the error was logged
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('Property CID could not be determined')
      );
    });

    it('should use correct property CID for ZIP folder name', async () => {
      // Mock scanSinglePropertyDirectoryV2 for this test - WITH seed file
      vi.mocked(scanSinglePropertyDirectoryV2).mockResolvedValue({
        allFiles: [
          {
            propertyCid: 'SEED_PENDING:property-dir',
            dataGroupCid: SEED_DATAGROUP_SCHEMA_CID,
            filePath: `${testExtractedDir}/${SEED_DATAGROUP_SCHEMA_CID}.json`,
          },
          {
            propertyCid: 'SEED_PENDING:property-dir',
            dataGroupCid:
              'bafkreigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi',
            filePath: `${testExtractedDir}/bafkreigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi.json`,
          },
        ],
        validFilesCount: 2,
        descriptiveFilesCount: 0,
        hasSeedFile: true,
        propertyCid: 'SEED_PENDING:property-dir',
        schemaCids: new Set([
          SEED_DATAGROUP_SCHEMA_CID,
          'bafkreigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi',
        ]),
      });

      // Mock CID calculation for seed file
      const seedCalculatedCid = 'bafkreiseedcalculatedcid123456789';
      // With the new implementation, seed is processed twice and the final CID
      // (with links) is used as the property CID
      const seedProcessedCid = 'bafkreiseedprocessedcid123456789';
      mockCidCalculatorService.calculateCidFromCanonicalJson
        .mockResolvedValueOnce(seedCalculatedCid) // First call for raw seed
        .mockResolvedValueOnce(seedProcessedCid) // Second call for processed seed with links
        .mockResolvedValue(
          'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi'
        );

      const options = {
        input: testInputZip,
        outputZip: testOutputZip,
        outputCsv: testOutputCsv,
        // No propertyCid provided - should use calculated seed CID
      };

      const serviceOverrides = {
        fileScannerService: mockFileScannerService,
        schemaCacheService: mockSchemaCacheService,
        canonicalizerService: mockCanonicalizerService,
        cidCalculatorService: mockCidCalculatorService,
        csvReporterService: mockCsvReporterService,
        progressTracker: mockProgressTracker,
        ipldConverterService: mockIpldConverterService,
        schemaManifestService: mockSchemaManifestService,
      };

      await handleHash(options, serviceOverrides);

      // Verify the ZIP was created with the correct folder structure
      const mockZip = vi.mocked(AdmZip).mock.results[0].value;
      expect(mockZip.addFile).toHaveBeenCalled();

      // Check that the folder name in the ZIP path is the processed seed CID, not the original directory name
      const addFileCalls = mockZip.addFile.mock.calls;
      for (const call of addFileCalls) {
        const zipPath = call[0] as string;
        // The path should start with the processed seed CID (final property CID)
        expect(zipPath).toMatch(new RegExp(`^${seedProcessedCid}/`));
        // The path should NOT start with 'property-dir' or any other incorrect value
        expect(zipPath).not.toMatch(/^property-dir\//);
        expect(zipPath).not.toMatch(/^SEED_PENDING:/);
      }
    });

    it('should prioritize user-provided CID over calculated seed CID', async () => {
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

      // Mock scanSinglePropertyDirectoryV2 for this test - WITH seed file
      vi.mocked(scanSinglePropertyDirectoryV2).mockResolvedValue({
        allFiles: [
          {
            propertyCid: 'SEED_PENDING:property-dir',
            dataGroupCid: SEED_DATAGROUP_SCHEMA_CID,
            filePath: `${testExtractedDir}/${SEED_DATAGROUP_SCHEMA_CID}.json`,
          },
          {
            propertyCid: 'SEED_PENDING:property-dir',
            dataGroupCid:
              'bafkreigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi',
            filePath: `${testExtractedDir}/bafkreigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi.json`,
          },
        ],
        validFilesCount: 2,
        descriptiveFilesCount: 0,
        hasSeedFile: true,
        propertyCid: 'SEED_PENDING:property-dir',
        schemaCids: new Set([
          SEED_DATAGROUP_SCHEMA_CID,
          'bafkreigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi',
        ]),
      });

      // Mock CID calculation for seed file
      const seedCalculatedCid = 'bafkreiseedcalculatedcid123456789';
      const seedProcessedCid = 'bafkreiseedprocessedcid123456789'; // CID after processing links
      mockCidCalculatorService.calculateCidFromCanonicalJson
        .mockResolvedValueOnce(seedCalculatedCid) // First call for raw seed
        .mockResolvedValueOnce(seedProcessedCid) // Second call for processed seed with links
        .mockResolvedValue(
          'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi'
        );

      const userProvidedCid = 'bafkreiuseroverridescid123456789';
      const options = {
        input: testInputZip,
        outputZip: testOutputZip,
        outputCsv: testOutputCsv,
        propertyCid: userProvidedCid, // User provides CID even though seed exists
      };

      const serviceOverrides = {
        fileScannerService: mockFileScannerService,
        schemaCacheService: mockSchemaCacheService,
        canonicalizerService: mockCanonicalizerService,
        cidCalculatorService: mockCidCalculatorService,
        csvReporterService: mockCsvReporterService,
        progressTracker: mockProgressTracker,
        ipldConverterService: mockIpldConverterService,
        schemaManifestService: mockSchemaManifestService,
      };

      await handleHash(options, serviceOverrides);

      // Verify the CSV contains the user-provided CID, not the calculated seed CID
      const csvContent = vi.mocked(fsPromises.writeFile).mock
        .calls[0][1] as string;
      expect(csvContent).toContain(userProvidedCid);
      // Ensure seed CID is not used as property CID for non-seed files
      const csvLines = csvContent.split('\n');
      for (let i = 1; i < csvLines.length; i++) {
        const line = csvLines[i];
        if (line && !line.includes(SEED_DATAGROUP_SCHEMA_CID)) {
          expect(line).not.toContain(seedCalculatedCid);
        }
      }
    });
  });
});
