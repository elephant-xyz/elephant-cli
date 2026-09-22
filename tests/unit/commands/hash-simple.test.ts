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

describe('Hash Command - image files', () => {
  const testExtractedDir = '/tmp/extracted';

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

    vi.mocked(fsPromises.writeFile).mockResolvedValue(undefined);
  });

  it('copies image files into the output ZIP and ignores HTML files', async () => {
    vi.mocked(fsPromises.readdir).mockResolvedValue([
      { name: 'data.json', isDirectory: () => false, isFile: () => true },
      { name: 'index.html', isDirectory: () => false, isFile: () => true },
      { name: 'image.png', isDirectory: () => false, isFile: () => true },
    ] as any);

    vi.mocked(fsPromises.readFile).mockImplementation(async (path: any) => {
      if (path.endsWith('data.json')) {
        return JSON.stringify({
          label: 'Test',
          relationships: {},
        });
      }
      return '';
    });

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
        calculateCidV1ForRawData: vi.fn().mockResolvedValue('bafkreiimage'),
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
    const addFile = vi.fn();
    const addLocalFile = vi.fn();
    vi.mocked(AdmZip).mockImplementation(
      () => ({ addFile, addLocalFile, writeZip: vi.fn() }) as any
    );

    // Run the hash command
    await handleHash(
      {
        input: '/test/input.zip',
        outputZip: '/test/output.zip',
        outputCsv: '/test/output.csv',
        propertyCid: 'bafkreiproperty',
      },
      mockServices as any
    );

    expect(addLocalFile.mock.calls).toEqual([
      [expect.stringMatching(/image\.png$/), 'bafkreiproperty'],
    ]);
    expect(addFile.mock.calls.map(([name]) => name)).not.toContain(
      'bafkreiproperty/index.html'
    );
  });
});
