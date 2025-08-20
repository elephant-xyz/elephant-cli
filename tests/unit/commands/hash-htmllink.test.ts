import { describe, it, expect, beforeEach, vi } from 'vitest';
import { promises as fsPromises } from 'fs';
import { handleHash } from '../../../src/commands/hash.js';

// Mock all dependencies
vi.mock('fs');
vi.mock('adm-zip');
vi.mock('../../../src/services/zip-extractor.service.js');
vi.mock('../../../src/utils/single-property-file-scanner-v2.js');
vi.mock('../../../src/services/schema-manifest.service.js');
vi.mock('../../../src/utils/single-property-processor.js');

describe('Hash Command - htmlLink in CSV Output', () => {
  const testExtractedDir = '/tmp/extracted';
  const testOutputCsv = '/test/output.csv';

  beforeEach(async () => {
    vi.clearAllMocks();

    // Mock process.exit
    vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);

    // Mock processSinglePropertyInput
    const { processSinglePropertyInput } = await import(
      '../../../src/utils/single-property-processor.js'
    );
    vi.mocked(processSinglePropertyInput).mockResolvedValue({
      actualInputDir: testExtractedDir,
      cleanup: vi.fn().mockResolvedValue(undefined),
    });

    // Mock file system
    vi.mocked(fsPromises.stat).mockResolvedValue({
      isDirectory: () => true,
      isFile: () => false,
    } as any);
  });

  it('should include htmlLink with media directory CID in CSV when media files are present', async () => {
    // Mock files: JSON + HTML + images
    vi.mocked(fsPromises.readdir).mockResolvedValue([
      { name: 'data.json', isDirectory: () => false, isFile: () => true },
      { name: 'index.html', isDirectory: () => false, isFile: () => true },
      { name: 'logo.png', isDirectory: () => false, isFile: () => true },
      { name: 'style.css', isDirectory: () => false, isFile: () => true },
    ] as any);

    vi.mocked(fsPromises.readFile).mockImplementation(async (path: any) => {
      if (path.endsWith('.json')) {
        return JSON.stringify({ label: 'Test', relationships: {} });
      } else if (path.endsWith('.html')) {
        return Buffer.from('<html></html>');
      } else if (path.endsWith('.png')) {
        return Buffer.from('PNG_DATA');
      } else if (path.endsWith('.css')) {
        return Buffer.from('css content');
      }
      return '';
    });

    let capturedCsvContent = '';
    vi.mocked(fsPromises.writeFile).mockImplementation(
      async (path, content) => {
        if (path === testOutputCsv) {
          capturedCsvContent = content as string;
        }
      }
    );

    const mockServices = {
      schemaCacheService: {
        getSchema: vi.fn().mockResolvedValue({
          type: 'object',
          properties: { label: {}, relationships: {} },
        }),
      },
      canonicalizerService: {
        canonicalize: vi.fn().mockReturnValue('{}'),
      },
      cidCalculatorService: {
        calculateCidFromCanonicalJson: vi.fn().mockResolvedValue('bafkreijson'),
        calculateCidV1ForRawData: vi.fn().mockResolvedValue('bafkreiraw'),
        calculateDirectoryCid: vi.fn().mockResolvedValue('bafybeimediadir123'),
      },
      csvReporterService: {
        initialize: vi.fn(),
        logError: vi.fn(),
        finalize: vi.fn(),
      },
      progressTracker: {
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
      },
      ipldConverterService: {
        hasIPLDLinks: vi.fn().mockReturnValue(false),
      },
      schemaManifestService: {
        loadSchemaManifest: vi.fn(),
        getDataGroupCidByLabel: vi.fn().mockReturnValue('bafkreidatagroup'),
      },
    };

    // Mock scan result
    const { scanSinglePropertyDirectoryV2 } = await import(
      '../../../src/utils/single-property-file-scanner-v2.js'
    );
    vi.mocked(scanSinglePropertyDirectoryV2).mockResolvedValue({
      allFiles: [
        {
          propertyCid: 'bafkreiproperty',
          dataGroupCid: 'bafkreidatagroup',
          filePath: `${testExtractedDir}/data.json`,
        },
      ],
      validFilesCount: 1,
      descriptiveFilesCount: 0,
      hasSeedFile: false,
      propertyCid: 'bafkreiproperty',
      schemaCids: new Set(['bafkreidatagroup']),
    });

    // Mock AdmZip
    const AdmZip = (await import('adm-zip')).default;
    vi.mocked(AdmZip).mockImplementation(
      () =>
        ({
          addFile: vi.fn(),
          writeZip: vi.fn(),
        }) as any
    );

    // Run the hash command
    await handleHash(
      {
        input: '/test/input.zip',
        outputZip: '/test/output.zip',
        outputCsv: testOutputCsv,
        propertyCid: 'bafkreiproperty',
      },
      mockServices as any
    );

    // Verify CSV content
    const csvLines = capturedCsvContent.split('\n');

    // Check header
    expect(csvLines[0]).toBe(
      'propertyCid,dataGroupCid,dataCid,filePath,uploadedAt,htmlLink'
    );

    // Check data line includes htmlLink with media directory CID
    expect(csvLines[1]).toContain('ipfs://bafybeimediadir123');

    // Verify directory CID was calculated for media files with directory name
    expect(
      mockServices.cidCalculatorService.calculateDirectoryCid
    ).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ name: 'index.html' }),
        expect.objectContaining({ name: 'logo.png' }),
      ]),
      'bafkreiproperty_media' // The directory name based on property CID
    );
  });

  it('should leave htmlLink empty in CSV when no media files are present', async () => {
    // Mock only JSON files, no media
    vi.mocked(fsPromises.readdir).mockResolvedValue([
      { name: 'data1.json', isDirectory: () => false, isFile: () => true },
      { name: 'data2.json', isDirectory: () => false, isFile: () => true },
    ] as any);

    vi.mocked(fsPromises.readFile).mockResolvedValue(
      JSON.stringify({ label: 'Test', relationships: {} })
    );

    let capturedCsvContent = '';
    vi.mocked(fsPromises.writeFile).mockImplementation(
      async (path, content) => {
        if (path === testOutputCsv) {
          capturedCsvContent = content as string;
        }
      }
    );

    const mockServices = {
      schemaCacheService: {
        getSchema: vi.fn().mockResolvedValue({
          type: 'object',
          properties: { label: {}, relationships: {} },
        }),
      },
      canonicalizerService: {
        canonicalize: vi.fn().mockReturnValue('{}'),
      },
      cidCalculatorService: {
        calculateCidFromCanonicalJson: vi.fn().mockResolvedValue('bafkreijson'),
        calculateCidV1ForRawData: vi.fn().mockResolvedValue('bafkreiraw'),
        calculateDirectoryCid: vi.fn().mockResolvedValue('bafybeimediadir'),
      },
      csvReporterService: {
        initialize: vi.fn(),
        logError: vi.fn(),
        finalize: vi.fn(),
      },
      progressTracker: {
        start: vi.fn(),
        stop: vi.fn(),
        setPhase: vi.fn(),
        increment: vi.fn(),
        getMetrics: vi.fn().mockReturnValue({
          startTime: Date.now(),
          errors: 0,
          processed: 2,
          skipped: 0,
          total: 2,
        }),
      },
      ipldConverterService: {
        hasIPLDLinks: vi.fn().mockReturnValue(false),
      },
      schemaManifestService: {
        loadSchemaManifest: vi.fn(),
        getDataGroupCidByLabel: vi.fn().mockReturnValue('bafkreidatagroup'),
      },
    };

    // Mock scan result
    const { scanSinglePropertyDirectoryV2 } = await import(
      '../../../src/utils/single-property-file-scanner-v2.js'
    );
    vi.mocked(scanSinglePropertyDirectoryV2).mockResolvedValue({
      allFiles: [
        {
          propertyCid: 'bafkreiproperty',
          dataGroupCid: 'bafkreidatagroup1',
          filePath: `${testExtractedDir}/data1.json`,
        },
        {
          propertyCid: 'bafkreiproperty',
          dataGroupCid: 'bafkreidatagroup2',
          filePath: `${testExtractedDir}/data2.json`,
        },
      ],
      validFilesCount: 2,
      descriptiveFilesCount: 0,
      hasSeedFile: false,
      propertyCid: 'bafkreiproperty',
      schemaCids: new Set(['bafkreidatagroup1', 'bafkreidatagroup2']),
    });

    // Mock AdmZip
    const AdmZip = (await import('adm-zip')).default;
    vi.mocked(AdmZip).mockImplementation(
      () =>
        ({
          addFile: vi.fn(),
          writeZip: vi.fn(),
        }) as any
    );

    // Run the hash command
    await handleHash(
      {
        input: '/test/input.zip',
        outputZip: '/test/output.zip',
        outputCsv: testOutputCsv,
        propertyCid: 'bafkreiproperty',
      },
      mockServices as any
    );

    // Verify CSV content
    const csvLines = capturedCsvContent
      .split('\n')
      .filter((line) => line.trim());

    // Check header
    expect(csvLines[0]).toBe(
      'propertyCid,dataGroupCid,dataCid,filePath,uploadedAt,htmlLink'
    );

    // Check data lines have empty htmlLink (last column)
    for (let i = 1; i < csvLines.length; i++) {
      const columns = csvLines[i].split(',');
      const htmlLinkColumn = columns[columns.length - 1];
      expect(htmlLinkColumn).toBe(''); // htmlLink should be empty
    }

    // Verify directory CID was NOT calculated (no media files)
    expect(
      mockServices.cidCalculatorService.calculateDirectoryCid
    ).not.toHaveBeenCalled();
  });
});
