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
      getAllDataGroupCids: vi
        .fn()
        .mockResolvedValue(new Set(['bafkreischema'])),
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

    // Mock schema cache service with valid data group schema
    // Data group schemas must have exactly 2 properties: label and relationships
    mockSchemaCacheService = {
      getSchema: vi.fn().mockResolvedValue({
        type: 'object',
        properties: {
          label: { type: 'string' },
          relationships: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                image: {
                  type: 'string',
                  format: 'ipfs_uri',
                },
                gallery: {
                  type: 'array',
                  items: {
                    type: 'string',
                    format: 'ipfs_uri',
                  },
                },
              },
            },
          },
        },
      }),
    } as any;

    // Mock JSON validator service
    mockJsonValidatorService = {
      validate: vi
        .fn()
        .mockResolvedValueOnce({ valid: true }) // First file valid after IPLD conversion
        .mockResolvedValueOnce({ valid: true }), // Second file already valid
      getErrorMessages: vi.fn().mockReturnValue([
        {
          path: '/relationships/0/ipfs_url',
          message: 'must be a valid IPFS URI',
        },
      ]),
      resolveData: vi.fn().mockImplementation((data) => Promise.resolve(data)),
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
    // Data must match the schema format (label + relationships)
    const jsonData1 = {
      label: 'Product 1',
      relationships: [
        {
          name: 'Product 1',
          ipfs_url: './images/product1.jpg',
        },
      ],
    };

    const jsonData2 = {
      label: 'Product 2',
      relationships: [
        {
          name: 'Product 2',
          ipfs_url: 'ipfs://bafkreiexistingimage', // Already an IPFS URI
        },
      ],
    };

    // Mock file reads
    vi.mocked(fsPromises.readFile)
      .mockResolvedValueOnce(JSON.stringify(jsonData1))
      .mockResolvedValueOnce(JSON.stringify(jsonData2));

    // Mock IPLD converter to detect and convert links
    mockIpldConverterService.hasIPLDLinks = vi
      .fn()
      .mockReturnValueOnce(true) // jsonData1 has links
      .mockReturnValueOnce(false); // jsonData2 already has IPFS URI

    mockIpldConverterService.convertToIPLD = vi
      .fn()
      .mockResolvedValueOnce({
        originalData: jsonData1,
        convertedData: {
          label: 'Product 1',
          relationships: [
            {
              name: 'Product 1',
              ipfs_url: 'ipfs://bafkreiimage1',
            },
          ],
        },
        hasLinks: true,
        linkedCIDs: ['bafkreiimage1'],
      })
      .mockResolvedValueOnce({
        originalData: jsonData2,
        convertedData: jsonData2, // No conversion needed, already IPFS URI
        hasLinks: false,
        linkedCIDs: [],
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

    // Verify IPLD converter was called only for file with local path
    expect(mockIpldConverterService.convertToIPLD).toHaveBeenCalledTimes(1);
    expect(mockIpldConverterService.convertToIPLD).toHaveBeenCalledWith(
      jsonData1,
      '/test/dir/property1/bafkreischema.json',
      expect.objectContaining({
        properties: expect.objectContaining({
          label: { type: 'string' },
          relationships: expect.objectContaining({
            type: 'array',
            items: expect.objectContaining({
              properties: expect.objectContaining({
                image: { type: 'string', format: 'ipfs_uri' },
                gallery: expect.objectContaining({
                  items: { type: 'string', format: 'ipfs_uri' },
                }),
              }),
            }),
          }),
        }),
      })
    );

    // Verify files were uploaded
    expect(mockPinataService.uploadBatch).toHaveBeenCalledTimes(2);

    // Verify CSV output includes converted data
    expect(mockedWriteFileSync).toHaveBeenCalledWith(
      '/test/output.csv',
      expect.stringContaining(
        'propertyCid,dataGroupCid,dataCid,filePath,uploadedAt'
      )
    );
  });

  it('should handle dry-run mode with image conversions', async () => {
    const jsonData = {
      label: 'Test Product',
      relationships: [
        {
          name: 'Test Product',
          ipfs_url: './image.png',
        },
      ],
    };

    vi.mocked(fsPromises.readFile).mockResolvedValue(JSON.stringify(jsonData));

    mockIpldConverterService.hasIPLDLinks = vi.fn().mockReturnValue(true);
    mockIpldConverterService.convertToIPLD = vi.fn().mockResolvedValue({
      originalData: jsonData,
      convertedData: {
        label: 'Test Product',
        relationships: [
          {
            name: 'Test Product',
            ipfs_url: 'ipfs://bafkreicalculatedimage',
          },
        ],
      },
      hasLinks: true,
      linkedCIDs: ['bafkreicalculatedimage'],
    });

    // Update mock file scanner to return single file
    mockFileScannerService.countTotalFiles = vi.fn().mockResolvedValue(1);
    mockFileScannerService.scanDirectory = vi
      .fn()
      .mockImplementation(async function* () {
        yield [
          {
            propertyCid: 'property1',
            dataGroupCid: 'bafkreischema',
            filePath: '/test/dir/property1/bafkreischema.json',
          },
        ];
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
    
    // Verify IPLD converter was not called in dry-run mode
    expect(mockIpldConverterService.convertToIPLD).not.toHaveBeenCalled();

    // In dry-run mode, IPLD conversion is skipped, so CID is calculated with original data
    expect(
      mockCidCalculatorService.calculateCidAutoFormat
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        label: 'Test Product',
        relationships: expect.arrayContaining([
          {
            name: 'Test Product',
            ipfs_url: './image.png',
          },
        ]),
      })
    );
  });

  it('should handle validation errors for invalid image paths', async () => {
    const jsonData = {
      label: 'Invalid Product',
      relationships: [
        {
          name: 'Invalid Product',
          ipfs_url: './non-existent-image.jpg',
        },
      ],
    };

    vi.mocked(fsPromises.readFile).mockResolvedValue(JSON.stringify(jsonData));

    // Mock validation to fail with ipfs_url error
    mockJsonValidatorService.validate = vi.fn().mockResolvedValueOnce({
      valid: false,
      errors: [
        {
          message: 'must be a valid IPFS URI',
          path: '/relationships/0/ipfs_url',
        },
      ],
    });

    // Mock IPLD converter to throw error for missing file
    mockIpldConverterService.hasIPLDLinks = vi.fn().mockReturnValue(true);
    mockIpldConverterService.convertToIPLD = vi
      .fn()
      .mockRejectedValue(
        new Error(
          'Failed to upload file ./non-existent-image.jpg: ENOENT: no such file or directory'
        )
      );

    // Update mock file scanner to return single file
    mockFileScannerService.countTotalFiles = vi.fn().mockResolvedValue(1);
    mockFileScannerService.scanDirectory = vi
      .fn()
      .mockImplementation(async function* () {
        yield [
          {
            propertyCid: 'property1',
            dataGroupCid: 'bafkreischema',
            filePath: '/test/dir/property1/bafkreischema.json',
          },
        ];
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

    // Verify error was logged - the original validation error since IPLD conversion failed
    expect(mockCsvReporterService.logError).toHaveBeenCalledWith(
      expect.objectContaining({
        errorMessage: 'must be a valid IPFS URI',
        errorPath: '/relationships/0/ipfs_url',
      })
    );

    // Verify progress tracker recorded the error
    expect(mockProgressTracker.increment).toHaveBeenCalledWith('errors');
  });

  it('should only process fields named ipfs_url', async () => {
    const jsonData = {
      label: 'Product',
      relationships: [
        {
          name: 'Product',
          description: './description.txt', // Not named ipfs_url
          ipfs_url: './image.png', // Named ipfs_url
        },
      ],
    };

    vi.mocked(fsPromises.readFile).mockResolvedValue(JSON.stringify(jsonData));

    // Mock validation to fail first, then succeed after conversion
    mockJsonValidatorService.validate = vi
      .fn()
      .mockResolvedValueOnce({
        valid: false,
        errors: [
          {
            message: 'must be a valid IPFS URI',
            path: '/relationships/0/ipfs_url',
          },
        ],
      })
      .mockResolvedValueOnce({ valid: true });

    mockIpldConverterService.hasIPLDLinks = vi.fn().mockReturnValue(true);
    mockIpldConverterService.convertToIPLD = vi.fn().mockResolvedValue({
      originalData: jsonData,
      convertedData: {
        label: 'Product',
        relationships: [
          {
            name: 'Product',
            description: './description.txt', // Unchanged
            ipfs_url: 'ipfs://bafkreiimage123', // Converted
          },
        ],
      },
      hasLinks: true,
      linkedCIDs: ['bafkreiimage123'],
    });

    // Update mock file scanner to return single file
    mockFileScannerService.countTotalFiles = vi.fn().mockResolvedValue(1);
    mockFileScannerService.scanDirectory = vi
      .fn()
      .mockImplementation(async function* () {
        yield [
          {
            propertyCid: 'property1',
            dataGroupCid: 'bafkreischema',
            filePath: '/test/dir/property1/bafkreischema.json',
          },
        ];
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

    // Verify IPLD converter was called with resolved data
    expect(mockIpldConverterService.convertToIPLD).toHaveBeenCalledWith(
      jsonData, // The resolved data
      expect.any(String),
      expect.any(Object) // Schema
    );
  });
});
