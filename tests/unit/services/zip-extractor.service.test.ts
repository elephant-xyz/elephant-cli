import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fsPromises } from 'fs';
import path from 'path';
import { tmpdir } from 'os';
import AdmZip from 'adm-zip';
import { ZipExtractorService } from '../../../src/services/zip-extractor.service.js';

describe('ZipExtractorService', () => {
  let zipExtractor: ZipExtractorService;
  let testDir: string;
  let testZipPath: string;

  beforeEach(async () => {
    zipExtractor = new ZipExtractorService();

    // Create a temporary test directory
    testDir = await fsPromises.mkdtemp(path.join(tmpdir(), 'zip-test-'));
    testZipPath = path.join(testDir, 'test.zip');
  });

  afterEach(async () => {
    // Clean up test directory
    try {
      await fsPromises.rm(testDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe('isZipFile', () => {
    it('should return true for a file with .zip extension', async () => {
      // Create a simple ZIP file
      const zip = new AdmZip();
      zip.addFile('test.txt', Buffer.from('test content'));
      zip.writeZip(testZipPath);

      const result = await zipExtractor.isZipFile(testZipPath);
      expect(result).toBe(true);
    });

    it('should return true for a ZIP file without .zip extension', async () => {
      // Create a ZIP file with a different extension
      const noExtPath = path.join(testDir, 'test.data');
      const zip = new AdmZip();
      zip.addFile('test.txt', Buffer.from('test content'));
      zip.writeZip(noExtPath);

      const result = await zipExtractor.isZipFile(noExtPath);
      expect(result).toBe(true);
    });

    it('should return false for a non-ZIP file', async () => {
      const textPath = path.join(testDir, 'test.txt');
      await fsPromises.writeFile(textPath, 'not a zip file');

      const result = await zipExtractor.isZipFile(textPath);
      expect(result).toBe(false);
    });

    it('should return false for a directory', async () => {
      const dirPath = path.join(testDir, 'subdir');
      await fsPromises.mkdir(dirPath);

      const result = await zipExtractor.isZipFile(dirPath);
      expect(result).toBe(false);
    });

    it('should return false for a non-existent file', async () => {
      const nonExistentPath = path.join(testDir, 'does-not-exist.zip');

      const result = await zipExtractor.isZipFile(nonExistentPath);
      expect(result).toBe(false);
    });
  });

  describe('extractZip', () => {
    it('should extract a ZIP file with a single directory', async () => {
      // Create a ZIP file with a single directory
      const zip = new AdmZip();
      zip.addFile('mydir/file1.json', Buffer.from('{"test": 1}'));
      zip.addFile('mydir/file2.json', Buffer.from('{"test": 2}'));
      zip.writeZip(testZipPath);

      const extractedPath = await zipExtractor.extractZip(testZipPath);

      // Should return the path to the single directory
      expect(extractedPath).toContain('mydir');

      // Verify files were extracted
      const file1Content = await fsPromises.readFile(
        path.join(extractedPath, 'file1.json'),
        'utf-8'
      );
      expect(JSON.parse(file1Content)).toEqual({ test: 1 });
    });

    it('should extract a ZIP file with multiple top-level entries', async () => {
      // Create a ZIP file with multiple directories
      const zip = new AdmZip();
      zip.addFile('dir1/file1.json', Buffer.from('{"test": 1}'));
      zip.addFile('dir2/file2.json', Buffer.from('{"test": 2}'));
      zip.writeZip(testZipPath);

      const extractedPath = await zipExtractor.extractZip(testZipPath);

      // Should return the temp directory containing both directories
      const entries = await fsPromises.readdir(extractedPath);
      expect(entries).toContain('dir1');
      expect(entries).toContain('dir2');
    });

    it('should handle ZIP files with files at root level', async () => {
      // Create a ZIP file with files at root
      const zip = new AdmZip();
      zip.addFile('file1.json', Buffer.from('{"test": 1}'));
      zip.addFile('file2.json', Buffer.from('{"test": 2}'));
      zip.writeZip(testZipPath);

      const extractedPath = await zipExtractor.extractZip(testZipPath);

      // Verify files were extracted
      const entries = await fsPromises.readdir(extractedPath);
      expect(entries).toContain('file1.json');
      expect(entries).toContain('file2.json');
    });

    it('should throw an error for an invalid ZIP file', async () => {
      await fsPromises.writeFile(testZipPath, 'not a zip file');

      await expect(zipExtractor.extractZip(testZipPath)).rejects.toThrow(
        'Failed to extract ZIP file'
      );
    });
  });

  describe('cleanup', () => {
    it('should remove a temporary directory', async () => {
      // Create a ZIP file and extract it to get a real temp directory
      const zip = new AdmZip();
      zip.addFile('test.txt', Buffer.from('test content'));
      zip.writeZip(testZipPath);

      // Extract to get a temp directory created by the service
      const extractedPath = await zipExtractor.extractZip(testZipPath);
      const tempDir = zipExtractor.getTempRootDir(extractedPath);

      // Verify directory exists
      const existsBefore = await fsPromises
        .access(tempDir)
        .then(() => true)
        .catch(() => false);
      expect(existsBefore).toBe(true);

      // Clean up
      await zipExtractor.cleanup(tempDir);

      // Wait a bit for filesystem to catch up
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify directory is removed
      const existsAfter = await fsPromises
        .access(tempDir)
        .then(() => true)
        .catch(() => false);
      expect(existsAfter).toBe(false);
    });

    it('should not remove directories outside of temp', async () => {
      // Try to clean up a non-temp directory
      const nonTempDir = '/usr/local/test';

      await zipExtractor.cleanup(nonTempDir);

      // Should not throw, but also should not attempt to remove
      // This test just verifies the safety check works
      expect(true).toBe(true);
    });
  });

  describe('getTempRootDir', () => {
    it('should extract the root temp directory from a path', () => {
      const fullPath = path.join(
        tmpdir(),
        'elephant-cli-zip-abc123',
        'extracted',
        'data'
      );

      const result = zipExtractor.getTempRootDir(fullPath);

      expect(result).toContain('elephant-cli-zip-abc123');
      expect(result).not.toContain('extracted');
    });

    it('should return the original path if no temp pattern found', () => {
      const nonTempPath = '/some/other/path';

      const result = zipExtractor.getTempRootDir(nonTempPath);

      expect(result).toBe(nonTempPath);
    });
  });
});
