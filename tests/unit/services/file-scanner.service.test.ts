import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, unlink, rmdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { existsSync } from 'fs';
import { FileScannerService } from '../../../src/services/file-scanner.service';

describe('FileScannerService', () => {
  let fileScannerService: FileScannerService;
  let tempDir: string;

  beforeEach(async () => {
    fileScannerService = new FileScannerService();

    // Create unique temporary directory for each test
    tempDir = join(
      tmpdir(),
      `file-scanner-test-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    );
    await mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    // Clean up temp directory
    try {
      if (existsSync(tempDir)) {
        await rmdir(tempDir, { recursive: true });
      }
    } catch (error) {
      // Ignore cleanup errors in tests
    }
  });

  describe('validateStructure', () => {
    it('should validate a proper directory structure', async () => {
      // Create valid structure
      const propertyCid = 'QmPropertyCid123456789012345678901234567890';
      const dataGroupCid = 'QmDataGroupCid123456789012345678901234567';

      const propertyDir = join(tempDir, propertyCid);
      await mkdir(propertyDir);
      await writeFile(
        join(propertyDir, `${dataGroupCid}.json`),
        '{"test": "data"}'
      );

      const result = await fileScannerService.validateStructure(tempDir);

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject non-existent directory', async () => {
      const nonExistentDir = join(tempDir, 'non-existent');

      const result = await fileScannerService.validateStructure(nonExistentDir);

      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('Failed to access directory');
    });

    it('should reject file instead of directory', async () => {
      const filePath = join(tempDir, 'not-a-directory.txt');
      await writeFile(filePath, 'test content');

      const result = await fileScannerService.validateStructure(filePath);

      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('is not a directory');
    });

    it('should reject empty directory', async () => {
      const result = await fileScannerService.validateStructure(tempDir);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Directory is empty');
    });

    it('should reject files in root directory', async () => {
      await writeFile(join(tempDir, 'invalid-file.json'), '{"test": "data"}');

      const result = await fileScannerService.validateStructure(tempDir);

      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some((err) => err.includes('Found file'))).toBe(
        true
      );
    });

    it('should reject invalid property CID directory names', async () => {
      await mkdir(join(tempDir, 'invalid-cid'));

      const result = await fileScannerService.validateStructure(tempDir);

      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(
        result.errors.some((err) => err.includes('Invalid property CID'))
      ).toBe(true);
    });

    it('should reject non-JSON files in property directories', async () => {
      const propertyCid = 'QmPropertyCid123456789012345678901234567890';
      const propertyDir = join(tempDir, propertyCid);
      await mkdir(propertyDir);
      await writeFile(join(propertyDir, 'invalid-file.txt'), 'test content');

      const result = await fileScannerService.validateStructure(tempDir);

      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some((err) => err.includes('.json extension'))).toBe(
        true
      );
    });

    it('should reject invalid data group CID filenames', async () => {
      const propertyCid = 'QmPropertyCid123456789012345678901234567890';
      const propertyDir = join(tempDir, propertyCid);
      await mkdir(propertyDir);
      await writeFile(
        join(propertyDir, 'invalid-cid.json'),
        '{"test": "data"}'
      );

      const result = await fileScannerService.validateStructure(tempDir);

      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(
        result.errors.some((err) => err.includes('Invalid data group CID'))
      ).toBe(true);
    });

    it('should reject subdirectories in property directories', async () => {
      const propertyCid = 'QmPropertyCid123456789012345678901234567890';
      const propertyDir = join(tempDir, propertyCid);
      await mkdir(propertyDir);
      await mkdir(join(propertyDir, 'subdirectory'));

      const result = await fileScannerService.validateStructure(tempDir);

      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some((err) => err.includes('subdirectory'))).toBe(
        true
      );
    });

    it('should reject empty property directories', async () => {
      const propertyCid = 'QmPropertyCid123456789012345678901234567890';
      const propertyDir = join(tempDir, propertyCid);
      await mkdir(propertyDir);

      const result = await fileScannerService.validateStructure(tempDir);

      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some((err) => err.includes('empty'))).toBe(true);
    });

    it('should validate multiple property directories', async () => {
      // Create multiple valid property directories
      const propertyCid1 = 'QmPropertyCid123456789012345678901234567890';
      const propertyCid2 = 'QmPropertyCid234567890123456789012345678901';
      const dataGroupCid = 'QmDataGroupCid123456789012345678901234567';

      const propertyDir1 = join(tempDir, propertyCid1);
      const propertyDir2 = join(tempDir, propertyCid2);

      await mkdir(propertyDir1);
      await mkdir(propertyDir2);
      await writeFile(
        join(propertyDir1, `${dataGroupCid}.json`),
        '{"test": "data1"}'
      );
      await writeFile(
        join(propertyDir2, `${dataGroupCid}.json`),
        '{"test": "data2"}'
      );

      const result = await fileScannerService.validateStructure(tempDir);

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('scanDirectory', () => {
    it('should scan and return file entries', async () => {
      // Create test structure
      const propertyCid = 'QmPropertyCid123456789012345678901234567890';
      const dataGroupCid1 = 'QmDataGroupCid123456789012345678901234567';
      const dataGroupCid2 = 'QmDataGroupCid234567890123456789012345678';

      const propertyDir = join(tempDir, propertyCid);
      await mkdir(propertyDir);
      await writeFile(
        join(propertyDir, `${dataGroupCid1}.json`),
        '{"test": "data1"}'
      );
      await writeFile(
        join(propertyDir, `${dataGroupCid2}.json`),
        '{"test": "data2"}'
      );

      const batches: any[] = [];
      for await (const batch of fileScannerService.scanDirectory(tempDir)) {
        batches.push(batch);
      }

      expect(batches).toHaveLength(1);
      expect(batches[0]).toHaveLength(2);

      const fileEntries = batches[0];
      expect(fileEntries[0]).toEqual({
        propertyCid,
        dataGroupCid: dataGroupCid1,
        filePath: join(propertyDir, `${dataGroupCid1}.json`),
      });
      expect(fileEntries[1]).toEqual({
        propertyCid,
        dataGroupCid: dataGroupCid2,
        filePath: join(propertyDir, `${dataGroupCid2}.json`),
      });
    });

    it('should handle multiple property directories', async () => {
      // Create multiple property directories
      const propertyCid1 = 'QmPropertyCid123456789012345678901234567890';
      const propertyCid2 = 'QmPropertyCid234567890123456789012345678901';
      const dataGroupCid = 'QmDataGroupCid123456789012345678901234567';

      const propertyDir1 = join(tempDir, propertyCid1);
      const propertyDir2 = join(tempDir, propertyCid2);

      await mkdir(propertyDir1);
      await mkdir(propertyDir2);
      await writeFile(
        join(propertyDir1, `${dataGroupCid}.json`),
        '{"test": "data1"}'
      );
      await writeFile(
        join(propertyDir2, `${dataGroupCid}.json`),
        '{"test": "data2"}'
      );

      const allEntries: any[] = [];
      for await (const batch of fileScannerService.scanDirectory(tempDir)) {
        allEntries.push(...batch);
      }

      expect(allEntries).toHaveLength(2);
      expect(
        allEntries.some((entry) => entry.propertyCid === propertyCid1)
      ).toBe(true);
      expect(
        allEntries.some((entry) => entry.propertyCid === propertyCid2)
      ).toBe(true);
    });

    it('should respect batch size', async () => {
      // Create many files to test batching
      const propertyCid = 'QmPropertyCid123456789012345678901234567890';
      const propertyDir = join(tempDir, propertyCid);
      await mkdir(propertyDir);

      // Create 5 files
      for (let i = 0; i < 5; i++) {
        const dataGroupCid = `QmDataGroupCid12345678901234567890123456${i.toString().padStart(2, '0')}`;
        await writeFile(
          join(propertyDir, `${dataGroupCid}.json`),
          `{"test": "data${i}"}`
        );
      }

      const batches: any[] = [];
      for await (const batch of fileScannerService.scanDirectory(tempDir, 2)) {
        batches.push(batch);
      }

      // Should have 3 batches: [2, 2, 1]
      expect(batches).toHaveLength(3);
      expect(batches[0]).toHaveLength(2);
      expect(batches[1]).toHaveLength(2);
      expect(batches[2]).toHaveLength(1);
    });

    it('should skip non-JSON files without throwing', async () => {
      const propertyCid = 'QmPropertyCid123456789012345678901234567890';
      const dataGroupCid = 'QmDataGroupCid123456789012345678901234567';

      const propertyDir = join(tempDir, propertyCid);
      await mkdir(propertyDir);
      await writeFile(
        join(propertyDir, `${dataGroupCid}.json`),
        '{"test": "data"}'
      );
      await writeFile(join(propertyDir, 'invalid.txt'), 'invalid file');

      const allEntries: any[] = [];
      for await (const batch of fileScannerService.scanDirectory(tempDir)) {
        allEntries.push(...batch);
      }

      // Should only return the JSON file
      expect(allEntries).toHaveLength(1);
      expect(allEntries[0].dataGroupCid).toBe(dataGroupCid);
    });

    it('should handle empty directory', async () => {
      const allEntries: any[] = [];
      for await (const batch of fileScannerService.scanDirectory(tempDir)) {
        allEntries.push(...batch);
      }

      expect(allEntries).toHaveLength(0);
    });
  });

  describe('countTotalFiles', () => {
    it('should count total files correctly', async () => {
      // Create test structure with multiple files
      const propertyCid1 = 'QmPropertyCid123456789012345678901234567890';
      const propertyCid2 = 'QmPropertyCid234567890123456789012345678901';
      const dataGroupCid = 'QmDataGroupCid123456789012345678901234567';

      const propertyDir1 = join(tempDir, propertyCid1);
      const propertyDir2 = join(tempDir, propertyCid2);

      await mkdir(propertyDir1);
      await mkdir(propertyDir2);

      // Create 2 files in first property dir
      await writeFile(
        join(propertyDir1, `${dataGroupCid}1.json`),
        '{"test": "data1"}'
      );
      await writeFile(
        join(propertyDir1, `${dataGroupCid}2.json`),
        '{"test": "data2"}'
      );

      // Create 1 file in second property dir
      await writeFile(
        join(propertyDir2, `${dataGroupCid}3.json`),
        '{"test": "data3"}'
      );

      const totalFiles = await fileScannerService.countTotalFiles(tempDir);

      expect(totalFiles).toBe(3);
    });

    it('should return 0 for empty directory', async () => {
      const totalFiles = await fileScannerService.countTotalFiles(tempDir);
      expect(totalFiles).toBe(0);
    });
  });
});
