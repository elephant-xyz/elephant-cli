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

    // Create a mock extracted directory structure
    mockExtractedPath = path.join(tempDir, 'extracted');
    await fsPromises.mkdir(mockExtractedPath, { recursive: true });

    // Create property directories with JSON files
    const property1Dir = path.join(mockExtractedPath, 'bafybeiabc123');
    const property2Dir = path.join(mockExtractedPath, 'bafybeidef456');

    await fsPromises.mkdir(property1Dir, { recursive: true });
    await fsPromises.mkdir(property2Dir, { recursive: true });

    // Add JSON files to property directories
    await fsPromises.writeFile(
      path.join(property1Dir, 'bafkreihash1.json'),
      JSON.stringify({ label: 'Test 1', relationships: [] })
    );
    await fsPromises.writeFile(
      path.join(property1Dir, 'bafkreihash2.json'),
      JSON.stringify({ label: 'Test 2', relationships: [] })
    );
    await fsPromises.writeFile(
      path.join(property2Dir, 'bafkreihash3.json'),
      JSON.stringify({ label: 'Test 3', relationships: [] })
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

    // Verify the single directory was uploaded
    expect(mockPinataService.uploadDirectory).toHaveBeenCalledTimes(1);
    expect(mockPinataService.uploadDirectory).toHaveBeenCalledWith(
      singlePropertyPath,
      expect.objectContaining({
        name: 'bafybeisinglecid',
        keyvalues: {
          source: 'elephant-cli-upload',
          propertyId: 'bafybeisinglecid',
        },
      })
    );

    // Verify CSV output
    const csvContent = await fsPromises.readFile(options.outputCsv!, 'utf-8');
    expect(csvContent).toContain('bafybeisinglecid,true,bafybeimockcid');
  });

  it('should successfully upload directories from hash output ZIP', async () => {
    // Mock services
    const mockZipExtractor = {
      isZipFile: vi.fn().mockResolvedValue(true),
      extractZip: vi.fn().mockResolvedValue(mockExtractedPath),
      getTempRootDir: vi.fn().mockReturnValue(tempDir),
      cleanup: vi.fn().mockResolvedValue(undefined),
    } as unknown as ZipExtractorService;

    const mockPinataService = {
      uploadDirectory: vi
        .fn()
        .mockResolvedValueOnce({
          success: true,
          cid: 'bafybeimockcid1',
        })
        .mockResolvedValueOnce({
          success: true,
          cid: 'bafybeimockcid2',
        }),
    } as unknown as PinataDirectoryUploadService;

    const mockProgress = {
      start: vi.fn(),
      stop: vi.fn(),
      increment: vi.fn(),
      getMetrics: vi.fn().mockReturnValue({
        processed: 2,
        errors: 0,
        skipped: 0,
        total: 2,
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

    // Verify directory uploads
    expect(mockPinataService.uploadDirectory).toHaveBeenCalledTimes(2);
    expect(mockPinataService.uploadDirectory).toHaveBeenCalledWith(
      path.join(mockExtractedPath, 'bafybeiabc123'),
      expect.objectContaining({
        name: 'bafybeiabc123',
        keyvalues: {
          source: 'elephant-cli-upload',
          propertyId: 'bafybeiabc123',
        },
      })
    );
    expect(mockPinataService.uploadDirectory).toHaveBeenCalledWith(
      path.join(mockExtractedPath, 'bafybeidef456'),
      expect.objectContaining({
        name: 'bafybeidef456',
        keyvalues: {
          source: 'elephant-cli-upload',
          propertyId: 'bafybeidef456',
        },
      })
    );

    // Verify progress tracking
    expect(mockProgress.start).toHaveBeenCalled();
    expect(mockProgress.stop).toHaveBeenCalled();
    expect(mockProgress.increment).toHaveBeenCalledWith('processed');
    expect(mockProgress.increment).toHaveBeenCalledTimes(2);

    // Verify cleanup
    expect(mockZipExtractor.cleanup).toHaveBeenCalledWith(tempDir);

    // Verify CSV output was created
    const csvContent = await fsPromises.readFile(options.outputCsv!, 'utf-8');
    expect(csvContent).toContain('propertyDir,success,cid,error,timestamp');
    expect(csvContent).toContain('bafybeiabc123,true,bafybeimockcid1');
    expect(csvContent).toContain('bafybeidef456,true,bafybeimockcid2');
  });

  it('should handle upload failures gracefully', async () => {
    const mockZipExtractor = {
      isZipFile: vi.fn().mockResolvedValue(true),
      extractZip: vi.fn().mockResolvedValue(mockExtractedPath),
      getTempRootDir: vi.fn().mockReturnValue(tempDir),
      cleanup: vi.fn().mockResolvedValue(undefined),
    } as unknown as ZipExtractorService;

    const mockPinataService = {
      uploadDirectory: vi
        .fn()
        .mockResolvedValueOnce({
          success: true,
          cid: 'bafybeimockcid1',
        })
        .mockResolvedValueOnce({
          success: false,
          error: 'Network error',
        }),
    } as unknown as PinataDirectoryUploadService;

    const mockProgress = {
      start: vi.fn(),
      stop: vi.fn(),
      increment: vi.fn(),
      getMetrics: vi.fn().mockReturnValue({
        processed: 1,
        errors: 1,
        skipped: 0,
        total: 2,
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

    // Verify both uploads were attempted
    expect(mockPinataService.uploadDirectory).toHaveBeenCalledTimes(2);

    // Verify progress tracking for both success and error
    expect(mockProgress.increment).toHaveBeenCalledWith('processed');
    expect(mockProgress.increment).toHaveBeenCalledWith('errors');

    // Verify CSV contains both success and failure
    const csvContent = await fsPromises.readFile(options.outputCsv!, 'utf-8');
    expect(csvContent).toContain('bafybeiabc123,true,bafybeimockcid1');
    expect(csvContent).toContain('bafybeidef456,false,,Network error');
  });

  it('should skip directories without JSON files', async () => {
    // Create a directory without JSON files
    const emptyPropertyDir = path.join(mockExtractedPath, 'empty-property');
    await fsPromises.mkdir(emptyPropertyDir, { recursive: true });
    await fsPromises.writeFile(
      path.join(emptyPropertyDir, 'readme.txt'),
      'This is not a JSON file'
    );

    const mockZipExtractor = {
      isZipFile: vi.fn().mockResolvedValue(true),
      extractZip: vi.fn().mockResolvedValue(mockExtractedPath),
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
        processed: 2,
        errors: 0,
        skipped: 1,
        total: 3,
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

    // Should only upload directories with JSON files
    expect(mockPinataService.uploadDirectory).toHaveBeenCalledTimes(2);
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
        total: 2,
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

    // Should handle the error and continue with other uploads
    expect(mockProgress.increment).toHaveBeenCalledWith('errors');

    // Verify CSV contains the error
    const csvContent = await fsPromises.readFile(options.outputCsv!, 'utf-8');
    expect(csvContent).toContain('bafybeiabc123,false,,Connection timeout');
  });
});
