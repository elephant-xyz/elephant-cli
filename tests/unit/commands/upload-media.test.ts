import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fsPromises } from 'fs';
import path from 'path';
import { handleUpload } from '../../../src/commands/upload.js';
import { ZipExtractorService } from '../../../src/services/zip-extractor.service.js';
import { PinataDirectoryUploadService } from '../../../src/services/pinata-directory-upload.service.js';
import { SchemaManifestService } from '../../../src/services/schema-manifest.service.js';

// Mock modules
vi.mock('fs', async () => {
  const actual = await vi.importActual('fs');
  return {
    ...actual,
    promises: {
      ...actual.promises,
      stat: vi.fn(),
      readdir: vi.fn(),
      writeFile: vi.fn(),
      mkdir: vi.fn(),
      copyFile: vi.fn(),
      rm: vi.fn(),
    },
  };
});

vi.mock('../../../src/services/zip-extractor.service.js');
vi.mock('../../../src/services/pinata-directory-upload.service.js');
vi.mock('../../../src/services/schema-manifest.service.js');
vi.mock('../../../src/utils/datagroup-analyzer.js');

describe('Upload Command - Media Files Support', () => {
  let mockZipExtractorService: any;
  let mockPinataService: any;
  let mockSchemaManifestService: any;
  let mockProgressTracker: any;

  const testInputZip = '/test/input.zip';
  const testOutputCsv = '/test/output/upload-results.csv';
  const testExtractedPath = '/tmp/extracted/property-cid';
  const testPropertyCid = 'bafkreitestpropertycid';

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock console methods
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    // Mock file system
    vi.mocked(fsPromises.stat).mockResolvedValue({
      isFile: () => true,
      isDirectory: () => false,
    } as any);

    // Mock ZipExtractorService
    mockZipExtractorService = {
      isZipFile: vi.fn().mockResolvedValue(true),
      extractZip: vi.fn().mockResolvedValue(testExtractedPath),
      getTempRootDir: vi.fn().mockReturnValue('/tmp'),
      cleanup: vi.fn().mockResolvedValue(undefined),
    };

    // Mock PinataDirectoryUploadService
    mockPinataService = {
      uploadDirectory: vi.fn(),
    };

    // Mock SchemaManifestService
    mockSchemaManifestService = {
      loadSchemaManifest: vi.fn().mockResolvedValue({}),
      getDataGroupCidByLabel: vi.fn().mockReturnValue('bafkreidatagroup'),
    };

    // Mock progress tracker
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

    vi.mocked(ZipExtractorService).mockImplementation(
      () => mockZipExtractorService
    );
    vi.mocked(PinataDirectoryUploadService).mockImplementation(
      () => mockPinataService
    );
    vi.mocked(SchemaManifestService).mockImplementation(
      () => mockSchemaManifestService
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Media Files Detection and Separation', () => {
    it('should detect and separate JSON files from media files', async () => {
      // Mock directory contents with JSON and media files
      vi.mocked(fsPromises.readdir)
        .mockResolvedValueOnce([
          {
            name: testPropertyCid,
            isDirectory: () => true,
            isFile: () => false,
          },
        ] as any)
        .mockResolvedValueOnce([
          {
            name: 'bafkreidata1.json',
            isDirectory: () => false,
            isFile: () => true,
          },
          {
            name: 'bafkreidata2.json',
            isDirectory: () => false,
            isFile: () => true,
          },
          {
            name: 'index.html',
            isDirectory: () => false,
            isFile: () => true,
          },
          {
            name: 'logo.png',
            isDirectory: () => false,
            isFile: () => true,
          },
          {
            name: 'icon.svg',
            isDirectory: () => false,
            isFile: () => true,
          },
        ] as any);

      // Mock file operations
      vi.mocked(fsPromises.mkdir).mockResolvedValue(undefined);
      vi.mocked(fsPromises.copyFile).mockResolvedValue(undefined);
      vi.mocked(fsPromises.rm).mockResolvedValue(undefined);
      vi.mocked(fsPromises.writeFile).mockResolvedValue(undefined);

      // Mock successful uploads
      mockPinataService.uploadDirectory
        .mockResolvedValueOnce({
          success: true,
          cid: 'bafybeimediadir123', // Media directory CID
        })
        .mockResolvedValueOnce({
          success: true,
          cid: 'bafybeijsondir456', // JSON directory CID
        });

      // Mock datagroup analyzer
      const { analyzeDatagroupFiles } = await import(
        '../../../src/utils/datagroup-analyzer.js'
      );
      vi.mocked(analyzeDatagroupFiles).mockResolvedValue([
        {
          fileName: 'bafkreidata1.json',
          dataGroupCid: 'bafkreidatagroup1',
          dataCid: 'bafkreidata1',
        },
        {
          fileName: 'bafkreidata2.json',
          dataGroupCid: 'bafkreidatagroup2',
          dataCid: 'bafkreidata2',
        },
      ]);

      const options = {
        input: testInputZip,
        pinataJwt: 'test-jwt-token',
        outputCsv: testOutputCsv,
      };

      await handleUpload(options, {
        zipExtractorService: mockZipExtractorService,
        pinataDirectoryUploadService: mockPinataService,
        progressTracker: mockProgressTracker,
        schemaManifestService: mockSchemaManifestService,
      });

      // Verify media files were uploaded separately
      expect(mockPinataService.uploadDirectory).toHaveBeenCalledTimes(2);

      // First call should be for media files
      const mediaUploadCall = mockPinataService.uploadDirectory.mock.calls[0];
      expect(mediaUploadCall[0]).toContain('_media_temp');
      expect(mediaUploadCall[1].keyvalues.type).toBe('media');

      // Second call should be for JSON files
      const jsonUploadCall = mockPinataService.uploadDirectory.mock.calls[1];
      expect(jsonUploadCall[0]).toContain('_json_temp');
      expect(jsonUploadCall[1].keyvalues.type).toBe('json');

      // Verify file copy operations for media files
      expect(vi.mocked(fsPromises.copyFile)).toHaveBeenCalledWith(
        expect.stringContaining('index.html'),
        expect.stringContaining('_media_temp')
      );
      expect(vi.mocked(fsPromises.copyFile)).toHaveBeenCalledWith(
        expect.stringContaining('logo.png'),
        expect.stringContaining('_media_temp')
      );
      expect(vi.mocked(fsPromises.copyFile)).toHaveBeenCalledWith(
        expect.stringContaining('icon.svg'),
        expect.stringContaining('_media_temp')
      );

      // Verify cleanup of temp directories
      expect(vi.mocked(fsPromises.rm)).toHaveBeenCalledWith(
        expect.stringContaining('_media_temp'),
        { recursive: true, force: true }
      );
      expect(vi.mocked(fsPromises.rm)).toHaveBeenCalledWith(
        expect.stringContaining('_json_temp'),
        { recursive: true, force: true }
      );
    });

    it('should handle directories with only JSON files (no media)', async () => {
      // Mock directory with only JSON files
      vi.mocked(fsPromises.readdir)
        .mockResolvedValueOnce([
          {
            name: testPropertyCid,
            isDirectory: () => true,
            isFile: () => false,
          },
        ] as any)
        .mockResolvedValueOnce([
          {
            name: 'bafkreidata1.json',
            isDirectory: () => false,
            isFile: () => true,
          },
          {
            name: 'bafkreidata2.json',
            isDirectory: () => false,
            isFile: () => true,
          },
        ] as any);

      vi.mocked(fsPromises.mkdir).mockResolvedValue(undefined);
      vi.mocked(fsPromises.copyFile).mockResolvedValue(undefined);
      vi.mocked(fsPromises.rm).mockResolvedValue(undefined);
      vi.mocked(fsPromises.writeFile).mockResolvedValue(undefined);

      // Mock successful JSON upload only
      mockPinataService.uploadDirectory.mockResolvedValueOnce({
        success: true,
        cid: 'bafybeijsondir456',
      });

      // Mock datagroup analyzer
      const { analyzeDatagroupFiles } = await import(
        '../../../src/utils/datagroup-analyzer.js'
      );
      vi.mocked(analyzeDatagroupFiles).mockResolvedValue([
        {
          fileName: 'bafkreidata1.json',
          dataGroupCid: 'bafkreidatagroup1',
          dataCid: 'bafkreidata1',
        },
      ]);

      const options = {
        input: testInputZip,
        pinataJwt: 'test-jwt-token',
        outputCsv: testOutputCsv,
      };

      await handleUpload(options, {
        zipExtractorService: mockZipExtractorService,
        pinataDirectoryUploadService: mockPinataService,
        progressTracker: mockProgressTracker,
        schemaManifestService: mockSchemaManifestService,
      });

      // Should only upload JSON files (no media upload)
      expect(mockPinataService.uploadDirectory).toHaveBeenCalledTimes(1);
      expect(mockPinataService.uploadDirectory).toHaveBeenCalledWith(
        expect.stringContaining('_json_temp'),
        expect.objectContaining({
          keyvalues: expect.objectContaining({ type: 'json' }),
        })
      );
    });
  });

  describe('CSV Output with htmlLink', () => {
    it('should include htmlLink column in CSV output when media files are present', async () => {
      // Mock directory with JSON and media files
      vi.mocked(fsPromises.readdir)
        .mockResolvedValueOnce([
          {
            name: testPropertyCid,
            isDirectory: () => true,
            isFile: () => false,
          },
        ] as any)
        .mockResolvedValueOnce([
          {
            name: 'bafkreidata.json',
            isDirectory: () => false,
            isFile: () => true,
          },
          {
            name: 'index.html',
            isDirectory: () => false,
            isFile: () => true,
          },
          {
            name: 'style.css',
            isDirectory: () => false,
            isFile: () => true,
          },
        ] as any);

      vi.mocked(fsPromises.mkdir).mockResolvedValue(undefined);
      vi.mocked(fsPromises.copyFile).mockResolvedValue(undefined);
      vi.mocked(fsPromises.rm).mockResolvedValue(undefined);

      const mediaCid = 'bafybeimediadir789';
      const jsonCid = 'bafybeijsondir123';

      // Mock successful uploads
      mockPinataService.uploadDirectory
        .mockResolvedValueOnce({ success: true, cid: mediaCid })
        .mockResolvedValueOnce({ success: true, cid: jsonCid });

      // Mock datagroup analyzer
      const { analyzeDatagroupFiles } = await import(
        '../../../src/utils/datagroup-analyzer.js'
      );
      vi.mocked(analyzeDatagroupFiles).mockResolvedValue([
        {
          fileName: 'bafkreidata.json',
          dataGroupCid: 'bafkreidatagroup',
          dataCid: 'bafkreidata',
        },
      ]);

      let capturedCsvContent = '';
      vi.mocked(fsPromises.writeFile).mockImplementation(
        async (path, content) => {
          if (path === testOutputCsv) {
            capturedCsvContent = content as string;
          }
        }
      );

      const options = {
        input: testInputZip,
        pinataJwt: 'test-jwt-token',
        outputCsv: testOutputCsv,
      };

      await handleUpload(options, {
        zipExtractorService: mockZipExtractorService,
        pinataDirectoryUploadService: mockPinataService,
        progressTracker: mockProgressTracker,
        schemaManifestService: mockSchemaManifestService,
      });

      // Verify CSV content
      const csvLines = capturedCsvContent.split('\n');
      expect(csvLines[0]).toBe(
        'propertyCid,dataGroupCid,dataCid,filePath,uploadedAt,htmlLink'
      );
      expect(csvLines[1]).toContain(`https://ipfs.io/ipfs/${mediaCid}`); // Should include media CID as htmlLink
      expect(csvLines[1]).toContain('bafkreidatagroup');
      expect(csvLines[1]).toContain('bafkreidata');
    });

    it('should leave htmlLink empty when no media files are present', async () => {
      // Mock directory with only JSON files
      vi.mocked(fsPromises.readdir)
        .mockResolvedValueOnce([
          {
            name: testPropertyCid,
            isDirectory: () => true,
            isFile: () => false,
          },
        ] as any)
        .mockResolvedValueOnce([
          {
            name: 'bafkreidata.json',
            isDirectory: () => false,
            isFile: () => true,
          },
        ] as any);

      vi.mocked(fsPromises.mkdir).mockResolvedValue(undefined);
      vi.mocked(fsPromises.copyFile).mockResolvedValue(undefined);
      vi.mocked(fsPromises.rm).mockResolvedValue(undefined);

      // Mock successful JSON upload only
      mockPinataService.uploadDirectory.mockResolvedValueOnce({
        success: true,
        cid: 'bafybeijsondir123',
      });

      // Mock datagroup analyzer
      const { analyzeDatagroupFiles } = await import(
        '../../../src/utils/datagroup-analyzer.js'
      );
      vi.mocked(analyzeDatagroupFiles).mockResolvedValue([
        {
          fileName: 'bafkreidata.json',
          dataGroupCid: 'bafkreidatagroup',
          dataCid: 'bafkreidata',
        },
      ]);

      let capturedCsvContent = '';
      vi.mocked(fsPromises.writeFile).mockImplementation(
        async (path, content) => {
          if (path === testOutputCsv) {
            capturedCsvContent = content as string;
          }
        }
      );

      const options = {
        input: testInputZip,
        pinataJwt: 'test-jwt-token',
        outputCsv: testOutputCsv,
      };

      await handleUpload(options, {
        zipExtractorService: mockZipExtractorService,
        pinataDirectoryUploadService: mockPinataService,
        progressTracker: mockProgressTracker,
        schemaManifestService: mockSchemaManifestService,
      });

      // Verify CSV content
      const csvLines = capturedCsvContent.split('\n');
      expect(csvLines[0]).toBe(
        'propertyCid,dataGroupCid,dataCid,filePath,uploadedAt,htmlLink'
      );

      // htmlLink should be empty (last column)
      const dataLine = csvLines[1].split(',');
      expect(dataLine[dataLine.length - 1]).toBe('');
    });
  });

  describe('Error Handling', () => {
    it('should handle media upload failure gracefully', async () => {
      // Mock directory with JSON and media files
      vi.mocked(fsPromises.readdir)
        .mockResolvedValueOnce([
          {
            name: testPropertyCid,
            isDirectory: () => true,
            isFile: () => false,
          },
        ] as any)
        .mockResolvedValueOnce([
          {
            name: 'bafkreidata.json',
            isDirectory: () => false,
            isFile: () => true,
          },
          {
            name: 'index.html',
            isDirectory: () => false,
            isFile: () => true,
          },
        ] as any);

      vi.mocked(fsPromises.mkdir).mockResolvedValue(undefined);
      vi.mocked(fsPromises.copyFile).mockResolvedValue(undefined);
      vi.mocked(fsPromises.rm).mockResolvedValue(undefined);
      vi.mocked(fsPromises.writeFile).mockResolvedValue(undefined);

      // Mock media upload failure but JSON upload success
      mockPinataService.uploadDirectory
        .mockResolvedValueOnce({
          success: false,
          error: 'Media upload failed',
        })
        .mockResolvedValueOnce({
          success: true,
          cid: 'bafybeijsondir123',
        });

      // Mock datagroup analyzer
      const { analyzeDatagroupFiles } = await import(
        '../../../src/utils/datagroup-analyzer.js'
      );
      vi.mocked(analyzeDatagroupFiles).mockResolvedValue([]);

      const options = {
        input: testInputZip,
        pinataJwt: 'test-jwt-token',
        outputCsv: testOutputCsv,
      };

      await handleUpload(options, {
        zipExtractorService: mockZipExtractorService,
        pinataDirectoryUploadService: mockPinataService,
        progressTracker: mockProgressTracker,
        schemaManifestService: mockSchemaManifestService,
      });

      // Should still upload JSON files even if media upload fails
      expect(mockPinataService.uploadDirectory).toHaveBeenCalledTimes(2);
      expect(mockProgressTracker.increment).toHaveBeenCalledWith('processed');
    });
  });

  describe('Media File Types', () => {
    it('should correctly identify all supported media file types', async () => {
      const mediaFiles = [
        'index.html',
        'page.htm',
        'image.png',
        'photo.jpg',
        'picture.jpeg',
        'animation.gif',
        'icon.svg',
        'banner.webp',
      ];

      // Mock directory with various media files
      vi.mocked(fsPromises.readdir)
        .mockResolvedValueOnce([
          {
            name: testPropertyCid,
            isDirectory: () => true,
            isFile: () => false,
          },
        ] as any)
        .mockResolvedValueOnce([
          {
            name: 'data.json',
            isDirectory: () => false,
            isFile: () => true,
          },
          ...mediaFiles.map((name) => ({
            name,
            isDirectory: () => false,
            isFile: () => true,
          })),
        ] as any);

      vi.mocked(fsPromises.mkdir).mockResolvedValue(undefined);
      vi.mocked(fsPromises.copyFile).mockResolvedValue(undefined);
      vi.mocked(fsPromises.rm).mockResolvedValue(undefined);
      vi.mocked(fsPromises.writeFile).mockResolvedValue(undefined);

      mockPinataService.uploadDirectory.mockResolvedValue({
        success: true,
        cid: 'bafybeimock',
      });

      // Mock datagroup analyzer
      const { analyzeDatagroupFiles } = await import(
        '../../../src/utils/datagroup-analyzer.js'
      );
      vi.mocked(analyzeDatagroupFiles).mockResolvedValue([]);

      const options = {
        input: testInputZip,
        pinataJwt: 'test-jwt-token',
        outputCsv: testOutputCsv,
      };

      await handleUpload(options, {
        zipExtractorService: mockZipExtractorService,
        pinataDirectoryUploadService: mockPinataService,
        progressTracker: mockProgressTracker,
        schemaManifestService: mockSchemaManifestService,
      });

      // Verify all media files were copied to media temp directory
      const copyFileCalls = vi.mocked(fsPromises.copyFile).mock.calls;
      const mediaCopyCalls = copyFileCalls.filter((call) =>
        call[1].includes('_media_temp')
      );

      expect(mediaCopyCalls).toHaveLength(mediaFiles.length);

      // Verify each media file was copied
      for (const mediaFile of mediaFiles) {
        expect(copyFileCalls).toContainEqual([
          expect.stringContaining(mediaFile),
          expect.stringContaining('_media_temp'),
        ]);
      }
    });
  });
});
