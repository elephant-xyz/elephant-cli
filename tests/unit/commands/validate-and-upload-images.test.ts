import { describe, it, expect, beforeEach, vi } from 'vitest';
import { promises as fsPromises, writeFileSync } from 'fs';
import { handleValidateAndUpload } from '../../../src/commands/validate-and-upload';
import { FileScannerService } from '../../../src/services/file-scanner.service';
import { SchemaCacheService } from '../../../src/services/schema-cache.service';
import { JsonValidatorService } from '../../../src/services/json-validator.service';
import { IPLDCanonicalizerService } from '../../../src/services/ipld-canonicalizer.service';
import { CidCalculatorService } from '../../../src/services/cid-calculator.service';
import { PinataService } from '../../../src/services/pinata.service';
import { CsvReporterService } from '../../../src/services/csv-reporter.service';
import { SimpleProgress } from '../../../src/utils/simple-progress';
import { IPFSService } from '../../../src/services/ipfs.service';
import { IPLDConverterService } from '../../../src/services/ipld-converter.service';

vi.mock('fs', () => ({
  promises: {
    stat: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
  },
  writeFileSync: vi.fn(),
  existsSync: vi.fn(),
}));

// Get mocked writeFileSync
const mockedWriteFileSync = vi.mocked(writeFileSync);

describe('validate-and-upload with image support', () => {
  let mockFileScannerService: FileScannerService;
  let mockSchemaCacheService: SchemaCacheService;
  let mockJsonValidatorService: JsonValidatorService;
  let mockCanonicalizerService: IPLDCanonicalizerService;
  let mockCidCalculatorService: CidCalculatorService;
  let mockPinataService: PinataService;
  let mockCsvReporterService: CsvReporterService;
  let mockProgressTracker: SimpleProgress;
  let mockIpfsService: IPFSService;
  let mockIpldConverterService: IPLDConverterService;

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock file system
    vi.mocked(fsPromises.stat).mockResolvedValue({
      isDirectory: () => true,
    } as any);

    // Mock file scanner service
    mockFileScannerService = {
      validateStructure: vi
        .fn()
        .mockResolvedValue({ isValid: true, errors: [] }),
      countTotalFiles: vi.fn().mockResolvedValue(2),
      getAllDataGroupCids: vi.fn().mockResolvedValue(new Set(['bafkreischema'])),
      scanDirectory: vi.fn().mockImplementation(async function* () {
        yield [
          {
            propertyCid: 'property1',
            dataGroupCid: 'bafkreischema',
            filePath: '/test/dir/property1/bafkreischema.json',
          },
          {
            propertyCid: 'property2',
            dataGroupCid: 'bafkreischema',
            filePath: '/test/dir/property2/bafkreischema.json',
          },
        ];
      }),
    } as any;

    // Mock schema cache service
    mockSchemaCacheService = {
      getSchema: vi.fn().mockResolvedValue({
        type: 'object',
        properties: {
          name: { type: 'string' },
          image: { 
            type: 'string',
            format: 'ipfs_uri'
          },
          gallery: {
            type: 'array',
            items: {
              type: 'string',
              format: 'ipfs_uri'
            }
          }
        },
      }),
    } as any;

    // Mock JSON validator service
    mockJsonValidatorService = {
      validate: vi.fn().mockResolvedValue({ valid: true }),
      getErrorMessages: vi.fn(),
    } as any;

    // Mock canonicalizer service
    mockCanonicalizerService = {
      canonicalize: vi.fn().mockImplementation((data) => JSON.stringify(data)),
    } as any;

    // Mock CID calculator service
    mockCidCalculatorService = {
      calculateCidAutoFormat: vi
        .fn()
        .mockResolvedValue('bafkreiabcd1234567890'),
      calculateCidV1ForRawData: vi
        .fn()
        .mockResolvedValue('bafkreiimage1234567890'),
    } as any;

    // Mock Pinata service
    mockPinataService = {
      uploadBatch: vi.fn().mockImplementation((files) =>
        files.map((file: any) => ({
          success: true,
          cid: file.metadata?.isImage 
            ? 'bafkreiuploadedimage123'
            : 'bafkreiuploadedjson123',
          propertyCid: file.propertyCid,
          dataGroupCid: file.dataGroupCid,
        }))
      ),
    } as any;

    // Mock CSV reporter service
    mockCsvReporterService = {
      initialize: vi.fn(),
      logError: vi.fn(),
      logWarning: vi.fn(),
      finalize: vi.fn(),
    } as any;

    // Mock progress tracker
    mockProgressTracker = {
      start: vi.fn(),
      stop: vi.fn(),
      setPhase: vi.fn(),
      increment: vi.fn(),
      getMetrics: vi.fn().mockReturnValue({
        startTime: Date.now() - 1000,
        errors: 0,
        processed: 2,
        skipped: 0,
        total: 2,
      }),
    } as any;

    // Mock IPFS service
    mockIpfsService = {
      fetchContent: vi.fn(),
    } as any;

    // Mock IPLD converter service
    mockIpldConverterService = {
      hasIPLDLinks: vi.fn(),
      convertToIPLD: vi.fn(),
    } as any;
  });

  it('should process JSON files with image paths and convert them to IPFS URIs', async () => {
    // Setup: JSON data with local image paths
    const jsonData1 = {
      name: 'Product 1',
      image: './images/product1.jpg',
      gallery: ['./images/thumb1.png', './images/thumb2.png']
    };

    const jsonData2 = {
      name: 'Product 2',
      image: 'ipfs://bafkreiexistingimage', // Already an IPFS URI
      gallery: ['./images/product2.jpg']
    };

    // Mock file reads
    vi.mocked(fsPromises.readFile)
      .mockResolvedValueOnce(JSON.stringify(jsonData1))
      .mockResolvedValueOnce(JSON.stringify(jsonData2));

    // Mock IPLD converter to detect and convert links
    mockIpldConverterService.hasIPLDLinks = vi.fn()
      .mockReturnValueOnce(true) // jsonData1 has links
      .mockReturnValueOnce(true); // jsonData2 has links

    mockIpldConverterService.convertToIPLD = vi.fn()
      .mockResolvedValueOnce({
        originalData: jsonData1,
        convertedData: {
          name: 'Product 1',
          image: 'ipfs://bafkreiimage1',
          gallery: ['ipfs://bafkreithumb1', 'ipfs://bafkreithumb2']
        },
        hasLinks: true,
        linkedCIDs: ['bafkreiimage1', 'bafkreithumb1', 'bafkreithumb2'],
      })
      .mockResolvedValueOnce({
        originalData: jsonData2,
        convertedData: {
          name: 'Product 2',
          image: 'ipfs://bafkreiexistingimage',
          gallery: ['ipfs://bafkreiproduct2']
        },
        hasLinks: true,
        linkedCIDs: ['bafkreiproduct2'], // Existing URI not included
      });

    const options = {
      inputDir: '/test/dir',
      outputCsv: '/test/output.csv',
      pinataJwt: 'test-jwt',
      dryRun: false,
    };

    const serviceOverrides = {
      fileScannerService: mockFileScannerService,
      ipfsServiceForSchemas: mockIpfsService,
      schemaCacheService: mockSchemaCacheService,
      jsonValidatorService: mockJsonValidatorService,
      jsonCanonicalizerService: mockCanonicalizerService,
      cidCalculatorService: mockCidCalculatorService,
      pinataService: mockPinataService,
      csvReporterService: mockCsvReporterService,
      progressTracker: mockProgressTracker,
      ipldConverterService: mockIpldConverterService,
    };

    await handleValidateAndUpload(options, serviceOverrides);

    // Verify IPLD converter was called with schema information
    expect(mockIpldConverterService.convertToIPLD).toHaveBeenCalledTimes(2);
    expect(mockIpldConverterService.convertToIPLD).toHaveBeenCalledWith(
      jsonData1,
      '/test/dir/property1/bafkreischema.json',
      expect.objectContaining({
        properties: expect.objectContaining({
          image: { type: 'string', format: 'ipfs_uri' },
          gallery: expect.objectContaining({
            items: { type: 'string', format: 'ipfs_uri' }
          })
        })
      })
    );

    // Verify files were uploaded
    expect(mockPinataService.uploadBatch).toHaveBeenCalledTimes(2);

    // Verify CSV output includes converted data
    expect(mockedWriteFileSync).toHaveBeenCalledWith(
      '/test/output.csv',
      expect.stringContaining('propertyCid,dataGroupCid,dataCid,filePath,uploadedAt')
    );
  });

  it('should handle dry-run mode with image conversions', async () => {
    const jsonData = {
      name: 'Test Product',
      image: './image.png'
    };

    vi.mocked(fsPromises.readFile).mockResolvedValue(JSON.stringify(jsonData));

    mockIpldConverterService.hasIPLDLinks = vi.fn().mockReturnValue(true);
    mockIpldConverterService.convertToIPLD = vi.fn().mockResolvedValue({
      originalData: jsonData,
      convertedData: {
        name: 'Test Product',
        image: 'ipfs://bafkreicalculatedimage'
      },
      hasLinks: true,
      linkedCIDs: ['bafkreicalculatedimage'],
    });

    // Update mock file scanner to return single file
    mockFileScannerService.countTotalFiles = vi.fn().mockResolvedValue(1);
    mockFileScannerService.scanDirectory = vi.fn().mockImplementation(async function* () {
      yield [{
        propertyCid: 'property1',
        dataGroupCid: 'bafkreischema',
        filePath: '/test/dir/property1/bafkreischema.json',
      }];
    });

    const options = {
      inputDir: '/test/dir',
      outputCsv: '/test/output.csv',
      pinataJwt: undefined, // Not needed for dry-run
      dryRun: true,
    };

    const serviceOverrides = {
      fileScannerService: mockFileScannerService,
      ipfsServiceForSchemas: mockIpfsService,
      schemaCacheService: mockSchemaCacheService,
      jsonValidatorService: mockJsonValidatorService,
      jsonCanonicalizerService: mockCanonicalizerService,
      cidCalculatorService: mockCidCalculatorService,
      pinataService: undefined, // No uploads in dry-run
      csvReporterService: mockCsvReporterService,
      progressTracker: mockProgressTracker,
      ipldConverterService: mockIpldConverterService,
    };

    await handleValidateAndUpload(options, serviceOverrides);

    // Verify no actual uploads occurred
    expect(mockPinataService.uploadBatch).not.toHaveBeenCalled();

    // Verify calculated CIDs are included in output
    expect(mockCidCalculatorService.calculateCidAutoFormat).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Test Product',
        image: 'ipfs://bafkreicalculatedimage'
      })
    );
  });

  it('should handle validation errors for invalid image paths', async () => {
    const jsonData = {
      name: 'Invalid Product',
      image: './non-existent-image.jpg'
    };

    vi.mocked(fsPromises.readFile).mockResolvedValue(JSON.stringify(jsonData));

    // Mock IPLD converter to throw error for missing file
    mockIpldConverterService.hasIPLDLinks = vi.fn().mockReturnValue(true);
    mockIpldConverterService.convertToIPLD = vi.fn().mockRejectedValue(
      new Error('Failed to upload file ./non-existent-image.jpg: ENOENT: no such file or directory')
    );

    // Update mock file scanner to return single file
    mockFileScannerService.countTotalFiles = vi.fn().mockResolvedValue(1);
    mockFileScannerService.scanDirectory = vi.fn().mockImplementation(async function* () {
      yield [{
        propertyCid: 'property1',
        dataGroupCid: 'bafkreischema',
        filePath: '/test/dir/property1/bafkreischema.json',
      }];
    });

    // Update progress tracker to reflect error
    mockProgressTracker.getMetrics = vi.fn().mockReturnValue({
      startTime: Date.now() - 1000,
      errors: 1,
      processed: 0,
      skipped: 0,
      total: 1,
    });

    const options = {
      inputDir: '/test/dir',
      outputCsv: '/test/output.csv',
      pinataJwt: 'test-jwt',
      dryRun: false,
    };

    const serviceOverrides = {
      fileScannerService: mockFileScannerService,
      ipfsServiceForSchemas: mockIpfsService,
      schemaCacheService: mockSchemaCacheService,
      jsonValidatorService: mockJsonValidatorService,
      jsonCanonicalizerService: mockCanonicalizerService,
      cidCalculatorService: mockCidCalculatorService,
      pinataService: mockPinataService,
      csvReporterService: mockCsvReporterService,
      progressTracker: mockProgressTracker,
      ipldConverterService: mockIpldConverterService,
    };

    await handleValidateAndUpload(options, serviceOverrides);

    // Verify error was logged
    expect(mockCsvReporterService.logError).toHaveBeenCalledWith(
      expect.objectContaining({
        errorMessage: expect.stringContaining('IPLD conversion error'),
      })
    );

    // Verify progress tracker recorded the error
    expect(mockProgressTracker.increment).toHaveBeenCalledWith('errors');
  });

  it('should not process image paths when format is not ipfs_uri', async () => {
    const jsonData = {
      name: 'Product',
      description: './description.txt', // Not marked as ipfs_uri
      image: './image.png' // Marked as ipfs_uri
    };

    // Update schema to have mixed formats
    mockSchemaCacheService.getSchema = vi.fn().mockResolvedValue({
      type: 'object',
      properties: {
        name: { type: 'string' },
        description: { type: 'string' }, // No format specified
        image: { 
          type: 'string',
          format: 'ipfs_uri'
        }
      },
    });

    vi.mocked(fsPromises.readFile).mockResolvedValue(JSON.stringify(jsonData));

    mockIpldConverterService.hasIPLDLinks = vi.fn().mockReturnValue(true);
    mockIpldConverterService.convertToIPLD = vi.fn().mockResolvedValue({
      originalData: jsonData,
      convertedData: {
        name: 'Product',
        description: './description.txt', // Unchanged
        image: 'ipfs://bafkreiimage123' // Converted
      },
      hasLinks: true,
      linkedCIDs: ['bafkreiimage123'],
    });

    // Update mock file scanner to return single file
    mockFileScannerService.countTotalFiles = vi.fn().mockResolvedValue(1);
    mockFileScannerService.scanDirectory = vi.fn().mockImplementation(async function* () {
      yield [{
        propertyCid: 'property1',
        dataGroupCid: 'bafkreischema',
        filePath: '/test/dir/property1/bafkreischema.json',
      }];
    });

    const options = {
      inputDir: '/test/dir',
      outputCsv: '/test/output.csv',
      pinataJwt: 'test-jwt',
      dryRun: false,
    };

    const serviceOverrides = {
      fileScannerService: mockFileScannerService,
      ipfsServiceForSchemas: mockIpfsService,
      schemaCacheService: mockSchemaCacheService,
      jsonValidatorService: mockJsonValidatorService,
      jsonCanonicalizerService: mockCanonicalizerService,
      cidCalculatorService: mockCidCalculatorService,
      pinataService: mockPinataService,
      csvReporterService: mockCsvReporterService,
      progressTracker: mockProgressTracker,
      ipldConverterService: mockIpldConverterService,
    };

    await handleValidateAndUpload(options, serviceOverrides);

    // Verify IPLD converter received the schema
    expect(mockIpldConverterService.convertToIPLD).toHaveBeenCalledWith(
      jsonData,
      expect.any(String),
      expect.objectContaining({
        properties: expect.objectContaining({
          description: { type: 'string' }, // No format
          image: { type: 'string', format: 'ipfs_uri' }
        })
      })
    );
  });
});