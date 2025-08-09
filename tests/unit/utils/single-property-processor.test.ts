import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  MockInstance,
} from 'vitest';
import { promises as fsPromises } from 'fs';
import path from 'path';
import { processSinglePropertyInput } from '../../../src/utils/single-property-processor.js';
import { ZipExtractorService } from '../../../src/services/zip-extractor.service.js';
import { logger } from '../../../src/utils/logger.js';
import chalk from 'chalk';

// Mock dependencies
vi.mock('fs', async () => {
  const actual = await vi.importActual('fs');
  return {
    ...actual,
    promises: {
      ...actual.promises,
      stat: vi.fn(),
      readdir: vi.fn(),
    },
  };
});

vi.mock('../../../src/services/zip-extractor.service.js');
vi.mock('../../../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock console methods
vi.spyOn(console, 'error').mockImplementation(() => {});

describe('processSinglePropertyInput', () => {
  let mockZipExtractor: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockZipExtractor = {
      isZipFile: vi.fn(),
      extractZip: vi.fn(),
      getTempRootDir: vi.fn(),
      cleanup: vi.fn(),
    };

    vi.mocked(ZipExtractorService).mockImplementation(() => mockZipExtractor);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should handle ZIP with property directory at root level', async () => {
    const inputPath = '/test/input.zip';
    const extractedDir = '/tmp/extracted';
    const propertyDir = '074527L1060260060';

    // Mock file is a ZIP
    vi.mocked(fsPromises.stat).mockResolvedValueOnce({
      isFile: () => true,
      isDirectory: () => false,
    } as any);

    mockZipExtractor.isZipFile.mockResolvedValue(true);
    mockZipExtractor.extractZip.mockResolvedValue(extractedDir);
    mockZipExtractor.getTempRootDir.mockReturnValue('/tmp');

    // Mock extracted directory exists
    vi.mocked(fsPromises.stat).mockResolvedValueOnce({
      isFile: () => false,
      isDirectory: () => true,
    } as any);

    // Mock single property directory in extracted content
    vi.mocked(fsPromises.readdir).mockResolvedValue([
      { name: propertyDir, isDirectory: () => true },
      { name: 'some-file.json', isDirectory: () => false },
    ] as any);

    const result = await processSinglePropertyInput({
      inputPath,
      requireZip: true,
    });

    expect(result.actualInputDir).toBe(path.join(extractedDir, propertyDir));
    expect(result.tempDir).toBe('/tmp');
    expect(logger.debug).toHaveBeenCalledWith(
      `Using single subdirectory as property directory: ${propertyDir}`
    );
  });

  it('should handle ZIP with files directly at root (no subdirectory)', async () => {
    const inputPath = '/test/input.zip';
    const extractedDir = '/tmp/extracted';

    // Mock file is a ZIP
    vi.mocked(fsPromises.stat).mockResolvedValueOnce({
      isFile: () => true,
      isDirectory: () => false,
    } as any);

    mockZipExtractor.isZipFile.mockResolvedValue(true);
    mockZipExtractor.extractZip.mockResolvedValue(extractedDir);
    mockZipExtractor.getTempRootDir.mockReturnValue('/tmp');

    // Mock extracted directory exists
    vi.mocked(fsPromises.stat).mockResolvedValueOnce({
      isFile: () => false,
      isDirectory: () => true,
    } as any);

    // Mock no subdirectories, only files
    vi.mocked(fsPromises.readdir).mockResolvedValue([
      {
        name: 'bafkreif7ywbjxu3s6jfi6ginvmsufeux3cd5eujuivg2y7tmqt2qk4rsoe.json',
        isDirectory: () => false,
      },
      { name: 'property_seed.json', isDirectory: () => false },
      { name: 'other_schema.json', isDirectory: () => false },
    ] as any);

    const result = await processSinglePropertyInput({
      inputPath,
      requireZip: true,
    });

    expect(result.actualInputDir).toBe(extractedDir);
    expect(result.tempDir).toBe('/tmp');
    expect(logger.debug).toHaveBeenCalledWith(
      'Using extracted root as property directory'
    );
  });

  it('should reject ZIP with multiple directories', async () => {
    const inputPath = '/test/input.zip';
    const extractedDir = '/tmp/extracted';

    // Mock file is a ZIP
    vi.mocked(fsPromises.stat).mockResolvedValueOnce({
      isFile: () => true,
      isDirectory: () => false,
    } as any);

    mockZipExtractor.isZipFile.mockResolvedValue(true);
    mockZipExtractor.extractZip.mockResolvedValue(extractedDir);
    mockZipExtractor.getTempRootDir.mockReturnValue('/tmp');

    // Mock extracted directory exists
    vi.mocked(fsPromises.stat).mockResolvedValueOnce({
      isFile: () => false,
      isDirectory: () => true,
    } as any);

    // Mock multiple directories
    vi.mocked(fsPromises.readdir).mockResolvedValue([
      { name: 'property1', isDirectory: () => true },
      { name: 'property2', isDirectory: () => true },
      { name: 'some-file.json', isDirectory: () => false },
    ] as any);

    await expect(
      processSinglePropertyInput({
        inputPath,
        requireZip: true,
      })
    ).rejects.toThrow('Expected single property data, but found 2 directories');

    expect(mockZipExtractor.cleanup).toHaveBeenCalledWith('/tmp');
  });

  it('should reject non-ZIP file input', async () => {
    const inputPath = '/test/input.txt';

    // Mock file exists but is not a ZIP
    vi.mocked(fsPromises.stat).mockResolvedValueOnce({
      isFile: () => true,
      isDirectory: () => false,
    } as any);

    mockZipExtractor.isZipFile.mockResolvedValue(false);

    await expect(
      processSinglePropertyInput({
        inputPath,
        requireZip: true,
      })
    ).rejects.toThrow('Input must be a valid ZIP file');

    expect(console.error).toHaveBeenCalledWith(
      chalk.red('❌ Error: Input must be a valid ZIP file')
    );
  });

  it('should reject directory input', async () => {
    const inputPath = '/test/directory';

    // Mock as directory
    vi.mocked(fsPromises.stat).mockResolvedValueOnce({
      isFile: () => false,
      isDirectory: () => true,
    } as any);

    await expect(
      processSinglePropertyInput({
        inputPath,
        requireZip: true,
      })
    ).rejects.toThrow('Input must be a ZIP file, not a directory');

    expect(console.error).toHaveBeenCalledWith(
      chalk.red('❌ Error: Input must be a ZIP file, not a directory')
    );
  });

  it('should clean up on extraction error', async () => {
    const inputPath = '/test/input.zip';
    const extractedDir = '/tmp/extracted';

    // Mock file is a ZIP
    vi.mocked(fsPromises.stat).mockResolvedValueOnce({
      isFile: () => true,
      isDirectory: () => false,
    } as any);

    mockZipExtractor.isZipFile.mockResolvedValue(true);
    mockZipExtractor.extractZip.mockResolvedValue(extractedDir);
    mockZipExtractor.getTempRootDir.mockReturnValue('/tmp');

    // Mock extracted directory check fails
    vi.mocked(fsPromises.stat).mockRejectedValueOnce(
      new Error('Directory not found')
    );

    await expect(
      processSinglePropertyInput({
        inputPath,
        requireZip: true,
      })
    ).rejects.toThrow('Directory not found');

    expect(mockZipExtractor.cleanup).toHaveBeenCalledWith('/tmp');
  });

  it('cleanup function should work correctly', async () => {
    const inputPath = '/test/input.zip';
    const extractedDir = '/tmp/extracted';

    // Mock file is a ZIP
    vi.mocked(fsPromises.stat).mockResolvedValueOnce({
      isFile: () => true,
      isDirectory: () => false,
    } as any);

    mockZipExtractor.isZipFile.mockResolvedValue(true);
    mockZipExtractor.extractZip.mockResolvedValue(extractedDir);
    mockZipExtractor.getTempRootDir.mockReturnValue('/tmp');

    // Mock extracted directory exists
    vi.mocked(fsPromises.stat).mockResolvedValueOnce({
      isFile: () => false,
      isDirectory: () => true,
    } as any);

    // Mock no subdirectories
    vi.mocked(fsPromises.readdir).mockResolvedValue([
      { name: 'file.json', isDirectory: () => false },
    ] as any);

    const result = await processSinglePropertyInput({
      inputPath,
      requireZip: true,
    });

    // Call cleanup
    await result.cleanup();

    expect(mockZipExtractor.cleanup).toHaveBeenCalledWith('/tmp');
    expect(logger.debug).toHaveBeenCalledWith('Cleaned up temporary directory');
  });
});
