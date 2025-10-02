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

      // Mock successful unified upload
      mockPinataService.uploadDirectory.mockResolvedValueOnce({
        success: true,
        cid: 'bafybeiunifiedcid123',
      });

      const options = {
        input: testInputZip,
        pinataJwt: 'test-jwt-token',
        silent: true,
      };

      const result = await handleUpload(options, {
        zipExtractorService: mockZipExtractorService,
        pinataDirectoryUploadService: mockPinataService,
        progressTracker: mockProgressTracker,
        schemaManifestService: mockSchemaManifestService,
      });

      // Verify single unified upload with directory structure
      expect(mockPinataService.uploadDirectory).toHaveBeenCalledTimes(1);
      expect(mockPinataService.uploadDirectory).toHaveBeenCalledWith(
        expect.stringContaining('elephant-upload-'),
        expect.objectContaining({
          name: 'elephant-upload',
          keyvalues: {
            source: 'elephant-cli-upload',
            timestamp: expect.any(String),
          },
        })
      );

      // Verify media files were copied to media subdirectory
      expect(fsPromises.mkdir).toHaveBeenCalledWith(
        expect.stringContaining(path.join('media')),
        expect.any(Object)
      );

      // Verify JSON files were copied to json subdirectory
      expect(fsPromises.mkdir).toHaveBeenCalledWith(
        expect.stringContaining(path.join('json')),
        expect.any(Object)
      );

      // Verify result
      expect(result).toEqual({
        success: true,
        cid: 'bafybeiunifiedcid123',
      });
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
        silent: true,
      };

      const result = await handleUpload(options, {
        zipExtractorService: mockZipExtractorService,
        pinataDirectoryUploadService: mockPinataService,
        progressTracker: mockProgressTracker,
        schemaManifestService: mockSchemaManifestService,
      });

      // Should upload JSON files in unified structure
      expect(mockPinataService.uploadDirectory).toHaveBeenCalledTimes(1);

      // Verify result
      expect(result).toEqual({
        success: true,
        cid: 'bafybeijsondir456',
      });
    });
  });

  describe('Media File Handling', () => {
    it('should successfully upload property with media files', async () => {
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

      // Mock successful upload
      mockPinataService.uploadDirectory.mockResolvedValueOnce({
        success: true,
        cid: 'bafybeiwithmedia123',
      });

      const options = {
        input: testInputZip,
        pinataJwt: 'test-jwt-token',
        silent: true,
      };

      const result = await handleUpload(options, {
        zipExtractorService: mockZipExtractorService,
        pinataDirectoryUploadService: mockPinataService,
        progressTracker: mockProgressTracker,
        schemaManifestService: mockSchemaManifestService,
      });

      // Verify single unified upload
      expect(mockPinataService.uploadDirectory).toHaveBeenCalledTimes(1);

      // Verify result
      expect(result).toEqual({
        success: true,
        cid: 'bafybeiwithmedia123',
      });
    });

    it('should successfully upload property without media files', async () => {
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

      // Mock successful upload
      mockPinataService.uploadDirectory.mockResolvedValueOnce({
        success: true,
        cid: 'bafybeiwithoutmedia456',
      });

      const options = {
        input: testInputZip,
        pinataJwt: 'test-jwt-token',
        silent: true,
      };

      const result = await handleUpload(options, {
        zipExtractorService: mockZipExtractorService,
        pinataDirectoryUploadService: mockPinataService,
        progressTracker: mockProgressTracker,
        schemaManifestService: mockSchemaManifestService,
      });

      // Verify single unified upload
      expect(mockPinataService.uploadDirectory).toHaveBeenCalledTimes(1);

      // Verify result
      expect(result).toEqual({
        success: true,
        cid: 'bafybeiwithoutmedia456',
      });
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

      // Mock upload failure
      mockPinataService.uploadDirectory.mockResolvedValueOnce({
        success: false,
        error: 'Network error',
      });

      const options = {
        input: testInputZip,
        pinataJwt: 'test-jwt-token',
        silent: true,
      };

      const result = await handleUpload(options, {
        zipExtractorService: mockZipExtractorService,
        pinataDirectoryUploadService: mockPinataService,
        progressTracker: mockProgressTracker,
        schemaManifestService: mockSchemaManifestService,
      });

      // Verify upload was attempted
      expect(mockPinataService.uploadDirectory).toHaveBeenCalledTimes(1);

      // Verify error result
      expect(result).toEqual({
        success: false,
        error: 'Network error',
      });
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

      const options = {
        input: testInputZip,
        pinataJwt: 'test-jwt-token',
        silent: true,
      };

      const result = await handleUpload(options, {
        zipExtractorService: mockZipExtractorService,
        pinataDirectoryUploadService: mockPinataService,
        progressTracker: mockProgressTracker,
        schemaManifestService: mockSchemaManifestService,
      });

      // Verify all media files were copied to media subdirectory
      const copyFileCalls = vi.mocked(fsPromises.copyFile).mock.calls;
      const mediaCopyCalls = copyFileCalls.filter((call) =>
        call[1].includes(path.join('media'))
      );

      expect(mediaCopyCalls).toHaveLength(mediaFiles.length);

      // Verify result
      expect(result).toEqual({
        success: true,
        cid: 'bafybeimock',
      });
    });
  });
});
