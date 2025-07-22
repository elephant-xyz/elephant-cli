import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, unlink, rmdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { existsSync } from 'fs';
import { FileScannerService } from '../../../src/services/file-scanner.service.js';
import { SEED_DATAGROUP_SCHEMA_CID } from '../../../src/config/constants.js';

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
      // Create valid structure (valid CIDv1 base32 format)
      const propertyCid =
        'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi';
      const dataGroupCid =
        'bafybeighijklmnopqrstuvwxyz234567abcdefghijklmnopqrstu';

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

    it('should ignore files in root directory', async () => {
      await writeFile(join(tempDir, 'invalid-file.json'), '{"test": "data"}');

      const result = await fileScannerService.validateStructure(tempDir);

      // Should be invalid because no valid property directories found
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(
        result.errors.some((err) =>
          err.includes('No valid property CID directories found')
        )
      ).toBe(true);
    });

    it('should ignore invalid property CID directory names', async () => {
      await mkdir(join(tempDir, 'invalid-cid'));

      const result = await fileScannerService.validateStructure(tempDir);

      // Should be invalid because no valid property directories found
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(
        result.errors.some((err) =>
          err.includes('No valid property CID directories found')
        )
      ).toBe(true);
    });

    it('should ignore non-JSON files in property directories', async () => {
      const propertyCid =
        'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi';
      const propertyDir = join(tempDir, propertyCid);
      await mkdir(propertyDir);
      await writeFile(join(propertyDir, 'invalid-file.txt'), 'test content');

      const result = await fileScannerService.validateStructure(tempDir);

      // Should be invalid because no valid data group CID files found
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(
        result.errors.some((err) =>
          err.includes('No valid data group CID files found')
        )
      ).toBe(true);
    });

    it('should ignore invalid data group CID filenames', async () => {
      const propertyCid =
        'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi';
      const propertyDir = join(tempDir, propertyCid);
      await mkdir(propertyDir);
      await writeFile(
        join(propertyDir, 'invalid-cid.json'),
        '{"test": "data"}'
      );

      const result = await fileScannerService.validateStructure(tempDir);

      // Should be invalid because no valid data group CID files found
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(
        result.errors.some((err) =>
          err.includes('No valid data group CID files found')
        )
      ).toBe(true);
    });

    it('should ignore subdirectories in property directories', async () => {
      const propertyCid =
        'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi';
      const propertyDir = join(tempDir, propertyCid);
      await mkdir(propertyDir);
      await mkdir(join(propertyDir, 'subdirectory'));

      const result = await fileScannerService.validateStructure(tempDir);

      // Should be invalid because no valid data group CID files found
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(
        result.errors.some((err) =>
          err.includes('No valid data group CID files found')
        )
      ).toBe(true);
    });

    it('should reject empty property directories', async () => {
      const propertyCid =
        'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi';
      const propertyDir = join(tempDir, propertyCid);
      await mkdir(propertyDir);

      const result = await fileScannerService.validateStructure(tempDir);

      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some((err) => err.includes('empty'))).toBe(true);
    });

    it('should validate multiple property directories', async () => {
      // Create multiple valid property directories
      const propertyCid1 =
        'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi';
      const propertyCid2 =
        'bafybeiabc234567defghijklmnopqrstuvwxyz2345abcdefghijk';
      const dataGroupCid =
        'bafybeighijklmnopqrstuvwxyz234567abcdefghijklmnopqrstu';

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

    it('should validate structure with mixed valid and invalid entries', async () => {
      // Create a mix of valid and invalid entries
      const validPropertyCid =
        'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi';
      const validDataGroupCid =
        'bafybeighijklmnopqrstuvwxyz234567abcdefghijklmnopqrstu';

      // Valid property directory with valid data
      const validPropertyDir = join(tempDir, validPropertyCid);
      await mkdir(validPropertyDir);
      await writeFile(
        join(validPropertyDir, `${validDataGroupCid}.json`),
        '{"test": "valid data"}'
      );

      // Invalid entries that should be ignored
      await mkdir(join(tempDir, 'invalid-dir'));
      await writeFile(join(tempDir, 'random-file.txt'), 'should be ignored');
      await writeFile(
        join(validPropertyDir, 'non-cid.json'),
        '{"test": "ignored"}'
      );
      await writeFile(join(validPropertyDir, 'file.txt'), 'also ignored');
      await mkdir(join(validPropertyDir, 'subdirectory'));

      const result = await fileScannerService.validateStructure(tempDir);

      // Should be valid because there is at least one valid property with valid data
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should validate seed datagroup directory with seed file', async () => {
      // Create directory with non-CID name but containing seed file
      const seedDirName = 'my-seed-data';
      const seedDir = join(tempDir, seedDirName);
      await mkdir(seedDir);

      // Create seed file
      await writeFile(
        join(seedDir, `${SEED_DATAGROUP_SCHEMA_CID}.json`),
        '{"seed": "data"}'
      );

      // Create other valid CID file
      const otherCid = 'bafybeiotheridataklmnopqrstuvwxyz234567abcdefghijklmn';
      await writeFile(join(seedDir, `${otherCid}.json`), '{"other": "data"}');

      const result = await fileScannerService.validateStructure(tempDir);

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject non-CID directory without seed file', async () => {
      // Create directory with non-CID name and no seed file
      const invalidDirName = 'invalid-dir';
      const invalidDir = join(tempDir, invalidDirName);
      await mkdir(invalidDir);

      // Create some other file
      const otherCid = 'QmOtherDataCid123456789012345678901234567';
      await writeFile(
        join(invalidDir, `${otherCid}.json`),
        '{"other": "data"}'
      );

      const result = await fileScannerService.validateStructure(tempDir);

      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(
        result.errors.some((err) =>
          err.includes('No valid property CID directories found')
        )
      ).toBe(true);
    });

    it('should validate both CID directories and seed datagroup directories', async () => {
      // Create standard CID directory
      const propertyCid =
        'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi';
      const propertyDir = join(tempDir, propertyCid);
      await mkdir(propertyDir);
      const dataGroupCid =
        'bafybeighijklmnopqrstuvwxyz234567abcdefghijklmnopqrstu';
      await writeFile(
        join(propertyDir, `${dataGroupCid}.json`),
        '{"standard": "data"}'
      );

      // Create seed datagroup directory
      const seedDirName = 'my-seed-data';
      const seedDir = join(tempDir, seedDirName);
      await mkdir(seedDir);
      await writeFile(
        join(seedDir, `${SEED_DATAGROUP_SCHEMA_CID}.json`),
        '{"seed": "data"}'
      );

      const result = await fileScannerService.validateStructure(tempDir);

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should validate seed datagroup directory even if only seed file is present', async () => {
      // Create seed datagroup directory with only seed file
      const seedDirName = 'only-seed-data';
      const seedDir = join(tempDir, seedDirName);
      await mkdir(seedDir);

      // Create only the seed file
      await writeFile(
        join(seedDir, `${SEED_DATAGROUP_SCHEMA_CID}.json`),
        '{"seed": "data"}'
      );

      const result = await fileScannerService.validateStructure(tempDir);

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('scanDirectory', () => {
    it('should scan and return file entries', async () => {
      // Create test structure
      const propertyCid =
        'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi';
      const dataGroupCid1 =
        'bafybeighijklmnopqrstuvwxyz234567abcdefghijklmnopqrstu';
      const dataGroupCid2 =
        'bafybeianotherdataklmnopqrstuvwxyz234567abcdefghijklm';

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

      // Files may be returned in any order, so check both files are present
      expect(fileEntries).toHaveLength(2);
      expect(
        fileEntries.some(
          (entry) =>
            entry.propertyCid === propertyCid &&
            entry.dataGroupCid === dataGroupCid1 &&
            entry.filePath === join(propertyDir, `${dataGroupCid1}.json`)
        )
      ).toBe(true);
      expect(
        fileEntries.some(
          (entry) =>
            entry.propertyCid === propertyCid &&
            entry.dataGroupCid === dataGroupCid2 &&
            entry.filePath === join(propertyDir, `${dataGroupCid2}.json`)
        )
      ).toBe(true);
    });

    it('should handle multiple property directories', async () => {
      // Create multiple property directories
      const propertyCid1 =
        'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi';
      const propertyCid2 =
        'bafybeiabc234567defghijklmnopqrstuvwxyz2345abcdefghijk';
      const dataGroupCid =
        'bafybeighijklmnopqrstuvwxyz234567abcdefghijklmnopqrstu';

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
      const propertyCid =
        'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi';
      const propertyDir = join(tempDir, propertyCid);
      await mkdir(propertyDir);

      // Create 5 files with valid CIDv1 base32 characters
      const baseCids = [
        'bafybeighijklmnopqrstuvwxyz234567abcdefghijklmnopqr22',
        'bafybeighijklmnopqrstuvwxyz234567abcdefghijklmnopqr23',
        'bafybeighijklmnopqrstuvwxyz234567abcdefghijklmnopqr24',
        'bafybeighijklmnopqrstuvwxyz234567abcdefghijklmnopqr25',
        'bafybeighijklmnopqrstuvwxyz234567abcdefghijklmnopqr26',
      ];

      for (let i = 0; i < 5; i++) {
        await writeFile(
          join(propertyDir, `${baseCids[i]}.json`),
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
      const propertyCid =
        'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi';
      const dataGroupCid =
        'bafybeighijklmnopqrstuvwxyz234567abcdefghijklmnopqrstu';

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

    it('should scan seed datagroup directory with SEED_PENDING propertyCid', async () => {
      // Create seed datagroup directory
      const seedDirName = 'my-seed-data';
      const seedDir = join(tempDir, seedDirName);
      await mkdir(seedDir);

      // Create seed file
      await writeFile(
        join(seedDir, `${SEED_DATAGROUP_SCHEMA_CID}.json`),
        '{"seed": "data"}'
      );

      // Create other valid CID file
      const otherCid = 'bafybeiotheridataklmnopqrstuvwxyz234567abcdefghijklmn';
      await writeFile(join(seedDir, `${otherCid}.json`), '{"other": "data"}');

      const allEntries: any[] = [];
      for await (const batch of fileScannerService.scanDirectory(tempDir)) {
        allEntries.push(...batch);
      }

      expect(allEntries).toHaveLength(2);

      // Both files should have the special SEED_PENDING propertyCid
      const seedFileEntry = allEntries.find(
        (entry) => entry.dataGroupCid === SEED_DATAGROUP_SCHEMA_CID
      );
      const otherFileEntry = allEntries.find(
        (entry) => entry.dataGroupCid === otherCid
      );

      expect(seedFileEntry).toBeDefined();
      expect(seedFileEntry.propertyCid).toBe(`SEED_PENDING:${seedDirName}`);
      expect(seedFileEntry.filePath).toBe(
        join(seedDir, `${SEED_DATAGROUP_SCHEMA_CID}.json`)
      );

      expect(otherFileEntry).toBeDefined();
      expect(otherFileEntry.propertyCid).toBe(`SEED_PENDING:${seedDirName}`);
      expect(otherFileEntry.filePath).toBe(join(seedDir, `${otherCid}.json`));
    });

    it('should scan both standard CID and seed datagroup directories', async () => {
      // Create standard CID directory
      const propertyCid =
        'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi';
      const propertyDir = join(tempDir, propertyCid);
      await mkdir(propertyDir);
      const dataGroupCid =
        'bafybeighijklmnopqrstuvwxyz234567abcdefghijklmnopqrstu';
      await writeFile(
        join(propertyDir, `${dataGroupCid}.json`),
        '{"standard": "data"}'
      );

      // Create seed datagroup directory
      const seedDirName = 'my-seed-data';
      const seedDir = join(tempDir, seedDirName);
      await mkdir(seedDir);
      await writeFile(
        join(seedDir, `${SEED_DATAGROUP_SCHEMA_CID}.json`),
        '{"seed": "data"}'
      );

      const allEntries: any[] = [];
      for await (const batch of fileScannerService.scanDirectory(tempDir)) {
        allEntries.push(...batch);
      }

      expect(allEntries).toHaveLength(2);

      // Standard CID directory file should use directory name as propertyCid
      const standardEntry = allEntries.find(
        (entry) => entry.dataGroupCid === dataGroupCid
      );
      expect(standardEntry).toBeDefined();
      expect(standardEntry.propertyCid).toBe(propertyCid);

      // Seed datagroup file should use SEED_PENDING propertyCid
      const seedEntry = allEntries.find(
        (entry) => entry.dataGroupCid === SEED_DATAGROUP_SCHEMA_CID
      );
      expect(seedEntry).toBeDefined();
      expect(seedEntry.propertyCid).toBe(`SEED_PENDING:${seedDirName}`);
    });

    it('should ignore directories without CID names and without seed files', async () => {
      // Create invalid directory (no CID name, no seed file)
      const invalidDirName = 'invalid-dir';
      const invalidDir = join(tempDir, invalidDirName);
      await mkdir(invalidDir);
      const otherCid = 'QmOtherDataCid123456789012345678901234567';
      await writeFile(
        join(invalidDir, `${otherCid}.json`),
        '{"other": "data"}'
      );

      const allEntries: any[] = [];
      for await (const batch of fileScannerService.scanDirectory(tempDir)) {
        allEntries.push(...batch);
      }

      // Should find no entries because directory is neither CID nor seed datagroup
      expect(allEntries).toHaveLength(0);
    });
  });

  describe('countTotalFiles', () => {
    it('should count total files correctly', async () => {
      // Create test structure with multiple files
      const propertyCid1 =
        'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi';
      const propertyCid2 =
        'bafybeiabc234567defghijklmnopqrstuvwxyz2345abcdefghijk';
      const dataGroupCid =
        'bafybeighijklmnopqrstuvwxyz234567abcdefghijklmnopqrstu';

      const propertyDir1 = join(tempDir, propertyCid1);
      const propertyDir2 = join(tempDir, propertyCid2);

      await mkdir(propertyDir1);
      await mkdir(propertyDir2);

      // Create 2 files in first property dir
      await writeFile(
        join(
          propertyDir1,
          `bafybeighijklmnopqrstuvwxyz234567abcdefghijklmnopqr22.json`
        ),
        '{"test": "data1"}'
      );
      await writeFile(
        join(
          propertyDir1,
          `bafybeighijklmnopqrstuvwxyz234567abcdefghijklmnopqr23.json`
        ),
        '{"test": "data2"}'
      );

      // Create 1 file in second property dir
      await writeFile(
        join(
          propertyDir2,
          `bafybeighijklmnopqrstuvwxyz234567abcdefghijklmnopqr24.json`
        ),
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
