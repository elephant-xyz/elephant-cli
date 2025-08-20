import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { promises as fsPromises } from 'fs';
import path from 'path';
import os from 'os';
import AdmZip from 'adm-zip';
import {
  handleUpload,
  UploadCommandOptions,
} from '../../../src/commands/upload.js';
import { ZipExtractorService } from '../../../src/services/zip-extractor.service.js';
import { PinataDirectoryUploadService } from '../../../src/services/pinata-directory-upload.service.js';
import { SimpleProgress } from '../../../src/utils/simple-progress.js';

vi.mock('../../../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    success: vi.fn(),
    technical: vi.fn(),
  },
}));

describe('Upload Command', () => {
  let tempDir: string;
  let mockZipPath: string;
  let mockExtractedPath: string;

  beforeEach(async () => {
    // Create a temporary directory for test files
    tempDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'upload-test-'));

    // Create a mock extracted directory structure with SINGLE property
    mockExtractedPath = path.join(tempDir, 'extracted');
    await fsPromises.mkdir(mockExtractedPath, { recursive: true });

    // Create a single property directory with JSON files
    const property1Dir = path.join(mockExtractedPath, 'bafybeiabc123');
    await fsPromises.mkdir(property1Dir, { recursive: true });

    // Add JSON files to property directory
    await fsPromises.writeFile(
      path.join(property1Dir, 'bafkreihash1.json'),
      JSON.stringify({ label: 'Test 1', relationships: [] })
    );
    await fsPromises.writeFile(
      path.join(property1Dir, 'bafkreihash2.json'),
      JSON.stringify({ label: 'Test 2', relationships: [] })
    );

    // Create a mock ZIP file
    mockZipPath = path.join(tempDir, 'test-input.zip');
    const zip = new AdmZip();
    zip.addLocalFolder(mockExtractedPath);
    zip.writeZip(mockZipPath);
  });

  afterEach(async () => {
    // Clean up temporary directory
    await fsPromises.rm(tempDir, { recursive: true, force: true });
  });

  it('should handle single property directory (hash command output)', async () => {
    // Create a mock structure as if we extracted into a single property directory
    // This simulates what happens when ZipExtractorService returns the inner directory
    const singlePropertyPath = path.join(tempDir, 'bafybeisinglecid');
    await fsPromises.mkdir(singlePropertyPath, { recursive: true });

    // Add JSON files directly in this directory
    await fsPromises.writeFile(
      path.join(singlePropertyPath, 'bafkreihash1.json'),
      JSON.stringify({ label: 'Test 1', relationships: [] })
    );
    await fsPromises.writeFile(
      path.join(singlePropertyPath, 'bafkreihash2.json'),
      JSON.stringify({ label: 'Test 2', relationships: [] })
    );

    const mockZipExtractor = {
      isZipFile: vi.fn().mockResolvedValue(true),
      extractZip: vi.fn().mockResolvedValue(singlePropertyPath),
      getTempRootDir: vi.fn().mockReturnValue(tempDir),
      cleanup: vi.fn().mockResolvedValue(undefined),
    } as unknown as ZipExtractorService;

    const mockPinataService = {
      uploadDirectory: vi.fn().mockResolvedValue({
        success: true,
        cid: 'bafybeimockcid',
      }),
    } as unknown as PinataDirectoryUploadService;

    const mockProgress = {
      start: vi.fn(),
      stop: vi.fn(),
      increment: vi.fn(),
      getMetrics: vi.fn().mockReturnValue({
        processed: 1,
        errors: 0,
        skipped: 0,
        total: 1,
      }),
    } as unknown as SimpleProgress;

    const options: UploadCommandOptions = {
      input: mockZipPath,
      pinataJwt: 'test-jwt-token',
      outputCsv: path.join(tempDir, 'results.csv'),
    };

    await handleUpload(options, {
      zipExtractorService: mockZipExtractor,
      pinataDirectoryUploadService: mockPinataService,
      progressTracker: mockProgress,
    });

    // Verify the single directory was uploaded (JSON files)
    expect(mockPinataService.uploadDirectory).toHaveBeenCalledTimes(1);
    expect(mockPinataService.uploadDirectory).toHaveBeenCalledWith(
      expect.stringContaining('_json_temp'),
      expect.objectContaining({
        name: 'bafybeisinglecid',
        keyvalues: {
          source: 'elephant-cli-upload',
          propertyId: 'bafybeisinglecid',
          type: 'json',
        },
      })
    );

    // CSV verification would require mocking the datagroup analyzer
    // which is tested separately
  });

  it('should successfully upload single property directory from hash output ZIP', async () => {
    // Create a single property structure (only one directory)
    const singlePropertyExtracted = path.join(tempDir, 'single-extracted');
    await fsPromises.mkdir(singlePropertyExtracted, { recursive: true });

    const singlePropertyDir = path.join(
      singlePropertyExtracted,
      'bafybeiabc123'
    );
    await fsPromises.mkdir(singlePropertyDir, { recursive: true });

    // Add JSON files to the single property directory
    await fsPromises.writeFile(
      path.join(singlePropertyDir, 'bafkreihash1.json'),
      JSON.stringify({ label: 'Test 1', relationships: [] })
    );
    await fsPromises.writeFile(
      path.join(singlePropertyDir, 'bafkreihash2.json'),
      JSON.stringify({ label: 'Test 2', relationships: [] })
    );

    // Mock services
    const mockZipExtractor = {
      isZipFile: vi.fn().mockResolvedValue(true),
      extractZip: vi.fn().mockResolvedValue(singlePropertyExtracted),
      getTempRootDir: vi.fn().mockReturnValue(tempDir),
      cleanup: vi.fn().mockResolvedValue(undefined),
    } as unknown as ZipExtractorService;

    const mockPinataService = {
      uploadDirectory: vi.fn().mockResolvedValueOnce({
        success: true,
        cid: 'bafybeimockcid1',
      }),
    } as unknown as PinataDirectoryUploadService;

    const mockProgress = {
      start: vi.fn(),
      stop: vi.fn(),
      increment: vi.fn(),
      getMetrics: vi.fn().mockReturnValue({
        processed: 1,
        errors: 0,
        skipped: 0,
        total: 1,
      }),
    } as unknown as SimpleProgress;

    const options: UploadCommandOptions = {
      input: mockZipPath,
      pinataJwt: 'test-jwt-token',
      outputCsv: path.join(tempDir, 'results.csv'),
    };

    await handleUpload(options, {
      zipExtractorService: mockZipExtractor,
      pinataDirectoryUploadService: mockPinataService,
      progressTracker: mockProgress,
    });

    // Verify ZIP extraction
    expect(mockZipExtractor.isZipFile).toHaveBeenCalledWith(mockZipPath);
    expect(mockZipExtractor.extractZip).toHaveBeenCalledWith(mockZipPath);

    // Verify directory upload for JSON files (media files are handled separately)
    expect(mockPinataService.uploadDirectory).toHaveBeenCalledTimes(1);
    expect(mockPinataService.uploadDirectory).toHaveBeenCalledWith(
      expect.stringContaining('_json_temp'),
      expect.objectContaining({
        name: 'bafybeiabc123',
        keyvalues: {
          source: 'elephant-cli-upload',
          propertyId: 'bafybeiabc123',
          type: 'json',
        },
      })
    );

    // Verify progress tracking
    expect(mockProgress.start).toHaveBeenCalled();
    expect(mockProgress.stop).toHaveBeenCalled();
    expect(mockProgress.increment).toHaveBeenCalledWith('processed');
    expect(mockProgress.increment).toHaveBeenCalledTimes(1);

    // Verify cleanup
    expect(mockZipExtractor.cleanup).toHaveBeenCalledWith(tempDir);

    // Verify CSV output was created with new format including htmlLink column
    const csvContent = await fsPromises.readFile(options.outputCsv!, 'utf-8');
    expect(csvContent).toContain(
      'propertyCid,dataGroupCid,dataCid,filePath,uploadedAt,htmlLink'
    );
  });

  it('should handle upload failures gracefully', async () => {
    // Create a single property structure
    const singlePropertyExtracted = path.join(tempDir, 'single-fail-test');
    await fsPromises.mkdir(singlePropertyExtracted, { recursive: true });

    const singlePropertyDir = path.join(
      singlePropertyExtracted,
      'bafybeiabc123'
    );
    await fsPromises.mkdir(singlePropertyDir, { recursive: true });

    // Add JSON files
    await fsPromises.writeFile(
      path.join(singlePropertyDir, 'bafkreihash1.json'),
      JSON.stringify({ label: 'Test 1', relationships: [] })
    );

    const mockZipExtractor = {
      isZipFile: vi.fn().mockResolvedValue(true),
      extractZip: vi.fn().mockResolvedValue(singlePropertyExtracted),
      getTempRootDir: vi.fn().mockReturnValue(tempDir),
      cleanup: vi.fn().mockResolvedValue(undefined),
    } as unknown as ZipExtractorService;

    const mockPinataService = {
      uploadDirectory: vi.fn().mockResolvedValueOnce({
        success: false,
        error: 'Network error',
      }),
    } as unknown as PinataDirectoryUploadService;

    const mockProgress = {
      start: vi.fn(),
      stop: vi.fn(),
      increment: vi.fn(),
      getMetrics: vi.fn().mockReturnValue({
        processed: 0,
        errors: 1,
        skipped: 0,
        total: 1,
      }),
    } as unknown as SimpleProgress;

    const options: UploadCommandOptions = {
      input: mockZipPath,
      pinataJwt: 'test-jwt-token',
      outputCsv: path.join(tempDir, 'results.csv'),
    };

    await handleUpload(options, {
      zipExtractorService: mockZipExtractor,
      pinataDirectoryUploadService: mockPinataService,
      progressTracker: mockProgress,
    });

    // Verify upload was attempted
    expect(mockPinataService.uploadDirectory).toHaveBeenCalledTimes(1);

    // Verify progress tracking for error
    expect(mockProgress.increment).toHaveBeenCalledWith('errors');

    // Verify CSV was created with new format including htmlLink column
    const csvContent = await fsPromises.readFile(options.outputCsv!, 'utf-8');
    expect(csvContent).toContain(
      'propertyCid,dataGroupCid,dataCid,filePath,uploadedAt,htmlLink'
    );
  });

  it('should skip single directory without JSON files', async () => {
    // Create a single directory structure without JSON files
    const singlePropertyExtracted = path.join(tempDir, 'single-empty');
    await fsPromises.mkdir(singlePropertyExtracted, { recursive: true });

    const emptyPropertyDir = path.join(
      singlePropertyExtracted,
      'empty-property'
    );
    await fsPromises.mkdir(emptyPropertyDir, { recursive: true });
    await fsPromises.writeFile(
      path.join(emptyPropertyDir, 'readme.txt'),
      'This is not a JSON file'
    );

    const mockZipExtractor = {
      isZipFile: vi.fn().mockResolvedValue(true),
      extractZip: vi.fn().mockResolvedValue(singlePropertyExtracted),
      getTempRootDir: vi.fn().mockReturnValue(tempDir),
      cleanup: vi.fn().mockResolvedValue(undefined),
    } as unknown as ZipExtractorService;

    const mockPinataService = {
      uploadDirectory: vi.fn().mockResolvedValue({
        success: true,
        cid: 'bafybeimockcid',
      }),
    } as unknown as PinataDirectoryUploadService;

    const mockProgress = {
      start: vi.fn(),
      stop: vi.fn(),
      increment: vi.fn(),
      getMetrics: vi.fn().mockReturnValue({
        processed: 0,
        errors: 0,
        skipped: 1,
        total: 1,
      }),
    } as unknown as SimpleProgress;

    const options: UploadCommandOptions = {
      input: mockZipPath,
      pinataJwt: 'test-jwt-token',
    };

    await handleUpload(options, {
      zipExtractorService: mockZipExtractor,
      pinataDirectoryUploadService: mockPinataService,
      progressTracker: mockProgress,
    });

    // Should not upload directories without JSON files
    expect(mockPinataService.uploadDirectory).toHaveBeenCalledTimes(0);
    expect(mockProgress.increment).toHaveBeenCalledWith('skipped');
  });

  it('should throw error if input is not a ZIP file', async () => {
    const notZipPath = path.join(tempDir, 'not-a-zip.txt');
    await fsPromises.writeFile(notZipPath, 'This is not a ZIP file');

    const mockZipExtractor = {
      isZipFile: vi.fn().mockResolvedValue(false),
    } as unknown as ZipExtractorService;

    const options: UploadCommandOptions = {
      input: notZipPath,
      pinataJwt: 'test-jwt-token',
    };

    await expect(
      handleUpload(options, {
        zipExtractorService: mockZipExtractor,
      })
    ).rejects.toThrow('Input must be a ZIP file');
  });

  it('should throw error if input file does not exist', async () => {
    const nonExistentPath = path.join(tempDir, 'does-not-exist.zip');

    const options: UploadCommandOptions = {
      input: nonExistentPath,
      pinataJwt: 'test-jwt-token',
    };

    // Pass a mock service to indicate test mode
    const mockProgress = {
      start: vi.fn(),
      stop: vi.fn(),
      increment: vi.fn(),
    } as unknown as SimpleProgress;

    await expect(
      handleUpload(options, {
        progressTracker: mockProgress,
      })
    ).rejects.toThrow(`Input file not found: ${nonExistentPath}`);
  });

  it('should throw error if no valid structure found', async () => {
    // Create an empty extracted directory (no JSON files, no subdirectories)
    const emptyExtractedPath = path.join(tempDir, 'empty-extracted');
    await fsPromises.mkdir(emptyExtractedPath, { recursive: true });

    // Add a non-JSON file to make it not completely empty
    await fsPromises.writeFile(
      path.join(emptyExtractedPath, 'readme.txt'),
      'Not a JSON file'
    );

    const mockZipExtractor = {
      isZipFile: vi.fn().mockResolvedValue(true),
      extractZip: vi.fn().mockResolvedValue(emptyExtractedPath),
      getTempRootDir: vi.fn().mockReturnValue(tempDir),
      cleanup: vi.fn().mockResolvedValue(undefined),
    } as unknown as ZipExtractorService;

    const options: UploadCommandOptions = {
      input: mockZipPath,
      pinataJwt: 'test-jwt-token',
    };

    await expect(
      handleUpload(options, {
        zipExtractorService: mockZipExtractor,
      })
    ).rejects.toThrow('No valid structure found in the extracted ZIP');
  });

  it('should throw error if multiple property directories are found', async () => {
    // Create multiple property directories (should fail)
    const multiPropertyPath = path.join(tempDir, 'multi-extracted');
    await fsPromises.mkdir(multiPropertyPath, { recursive: true });

    const prop1Dir = path.join(multiPropertyPath, 'bafybeiprop1');
    const prop2Dir = path.join(multiPropertyPath, 'bafybeiprop2');
    await fsPromises.mkdir(prop1Dir, { recursive: true });
    await fsPromises.mkdir(prop2Dir, { recursive: true });

    // Add JSON files to each directory
    await fsPromises.writeFile(
      path.join(prop1Dir, 'file1.json'),
      JSON.stringify({ label: 'Test 1', relationships: [] })
    );
    await fsPromises.writeFile(
      path.join(prop2Dir, 'file2.json'),
      JSON.stringify({ label: 'Test 2', relationships: [] })
    );

    const mockZipExtractor = {
      isZipFile: vi.fn().mockResolvedValue(true),
      extractZip: vi.fn().mockResolvedValue(multiPropertyPath),
      getTempRootDir: vi.fn().mockReturnValue(tempDir),
      cleanup: vi.fn().mockResolvedValue(undefined),
    } as unknown as ZipExtractorService;

    const options: UploadCommandOptions = {
      input: mockZipPath,
      pinataJwt: 'test-jwt-token',
    };

    await expect(
      handleUpload(options, {
        zipExtractorService: mockZipExtractor,
      })
    ).rejects.toThrow('Multiple property directories found');
  });

  it('should throw error if no JWT is provided', async () => {
    const options: UploadCommandOptions = {
      input: mockZipPath,
      // No pinataJwt provided
    };

    const mockProgress = {
      start: vi.fn(),
      stop: vi.fn(),
      increment: vi.fn(),
    } as unknown as SimpleProgress;

    await expect(
      handleUpload(options, {
        progressTracker: mockProgress,
      })
    ).rejects.toThrow(
      'Pinata JWT is required. Provide it via --pinata-jwt option or PINATA_JWT environment variable.'
    );
  });

  it('should handle exception during upload', async () => {
    const mockZipExtractor = {
      isZipFile: vi.fn().mockResolvedValue(true),
      extractZip: vi.fn().mockResolvedValue(mockExtractedPath),
      getTempRootDir: vi.fn().mockReturnValue(tempDir),
      cleanup: vi.fn().mockResolvedValue(undefined),
    } as unknown as ZipExtractorService;

    const mockPinataService = {
      uploadDirectory: vi
        .fn()
        .mockRejectedValueOnce(new Error('Connection timeout')),
    } as unknown as PinataDirectoryUploadService;

    const mockProgress = {
      start: vi.fn(),
      stop: vi.fn(),
      increment: vi.fn(),
      getMetrics: vi.fn().mockReturnValue({
        processed: 0,
        errors: 1,
        skipped: 0,
        total: 1,
      }),
    } as unknown as SimpleProgress;

    const options: UploadCommandOptions = {
      input: mockZipPath,
      pinataJwt: 'test-jwt-token',
      outputCsv: path.join(tempDir, 'results.csv'),
    };

    await handleUpload(options, {
      zipExtractorService: mockZipExtractor,
      pinataDirectoryUploadService: mockPinataService,
      progressTracker: mockProgress,
    });

    // Should handle the error
    expect(mockProgress.increment).toHaveBeenCalledWith('errors');

    // Verify CSV was created with proper headers
    const csvContent = await fsPromises.readFile(options.outputCsv!, 'utf-8');
    expect(csvContent).toContain(
      'propertyCid,dataGroupCid,dataCid,filePath,uploadedAt'
    );
  });
});
