import { describe, it, expect, beforeEach } from 'vitest';
import { CidCalculatorService } from '../../../src/services/cid-calculator.service.js';

describe('CidCalculatorService - Directory CID Calculation', () => {
  let cidCalculator: CidCalculatorService;

  beforeEach(() => {
    cidCalculator = new CidCalculatorService();
  });

  describe('calculateDirectoryCid', () => {
    it('should calculate a valid dag-pb CID for a directory with files', async () => {
      const files = [
        { name: 'index.html', content: Buffer.from('<html></html>') },
        { name: 'logo.png', content: Buffer.from('PNG_DATA') },
        { name: 'icon.svg', content: Buffer.from('<svg></svg>') },
      ];

      const cid = await cidCalculator.calculateDirectoryCid(files);

      // Should return a CID v1 in base32 format (starts with 'bafybei...')
      expect(cid).toMatch(/^bafybei[a-z2-7]+$/);
      expect(cid.length).toBeGreaterThan(50); // Base32 CIDs are typically long
    });

    it('should produce deterministic CIDs for the same files', async () => {
      const files = [
        { name: 'file1.txt', content: Buffer.from('content1') },
        { name: 'file2.txt', content: Buffer.from('content2') },
      ];

      const cid1 = await cidCalculator.calculateDirectoryCid(files);
      const cid2 = await cidCalculator.calculateDirectoryCid(files);

      expect(cid1).toBe(cid2);
    });

    it('should produce different CIDs for different file content', async () => {
      const files1 = [{ name: 'file.txt', content: Buffer.from('content1') }];

      const files2 = [{ name: 'file.txt', content: Buffer.from('content2') }];

      const cid1 = await cidCalculator.calculateDirectoryCid(files1);
      const cid2 = await cidCalculator.calculateDirectoryCid(files2);

      expect(cid1).not.toBe(cid2);
    });

    it('should produce different CIDs for different file names', async () => {
      const files1 = [{ name: 'file1.txt', content: Buffer.from('content') }];

      const files2 = [{ name: 'file2.txt', content: Buffer.from('content') }];

      const cid1 = await cidCalculator.calculateDirectoryCid(files1);
      const cid2 = await cidCalculator.calculateDirectoryCid(files2);

      expect(cid1).not.toBe(cid2);
    });

    it('should handle empty directory', async () => {
      const files: Array<{ name: string; content: Buffer }> = [];

      const cid = await cidCalculator.calculateDirectoryCid(files);

      // Should still return a valid CID for an empty directory
      expect(cid).toMatch(/^bafybei[a-z2-7]+$/);
    });

    it('should handle large files', async () => {
      const largeContent = Buffer.alloc(10000, 'x'); // 10KB of 'x'
      const files = [{ name: 'large.bin', content: largeContent }];

      const cid = await cidCalculator.calculateDirectoryCid(files);

      expect(cid).toMatch(/^bafybei[a-z2-7]+$/);
    });

    it('should sort files alphabetically for deterministic CID', async () => {
      // Create files in different orders
      const files1 = [
        { name: 'z.txt', content: Buffer.from('z') },
        { name: 'a.txt', content: Buffer.from('a') },
        { name: 'm.txt', content: Buffer.from('m') },
      ];

      const files2 = [
        { name: 'a.txt', content: Buffer.from('a') },
        { name: 'm.txt', content: Buffer.from('m') },
        { name: 'z.txt', content: Buffer.from('z') },
      ];

      const cid1 = await cidCalculator.calculateDirectoryCid(files1);
      const cid2 = await cidCalculator.calculateDirectoryCid(files2);

      // Should produce the same CID regardless of input order
      expect(cid1).toBe(cid2);
    });

    it('should handle binary files correctly', async () => {
      // Create binary content
      const binaryContent = Buffer.from([0x00, 0xff, 0x12, 0x34, 0x56]);
      const files = [{ name: 'binary.dat', content: binaryContent }];

      const cid = await cidCalculator.calculateDirectoryCid(files);

      expect(cid).toMatch(/^bafybei[a-z2-7]+$/);
    });

    it('should handle multiple files with same content but different names', async () => {
      const commonContent = Buffer.from('shared content');
      const files = [
        { name: 'file1.txt', content: commonContent },
        { name: 'file2.txt', content: commonContent },
        { name: 'file3.txt', content: commonContent },
      ];

      const cid = await cidCalculator.calculateDirectoryCid(files);

      // Should create a valid CID even with duplicate content
      expect(cid).toMatch(/^bafybei[a-z2-7]+$/);

      // Different from a single file with the same content
      const singleFile = [{ name: 'single.txt', content: commonContent }];
      const singleCid = await cidCalculator.calculateDirectoryCid(singleFile);
      expect(cid).not.toBe(singleCid);
    });

    it('should handle special characters in file names', async () => {
      const files = [
        {
          name: 'file with spaces.txt',
          content: Buffer.from('content'),
        },
        {
          name: 'file-with-dashes.txt',
          content: Buffer.from('content'),
        },
        {
          name: 'file_with_underscores.txt',
          content: Buffer.from('content'),
        },
      ];

      const cid = await cidCalculator.calculateDirectoryCid(files);

      expect(cid).toMatch(/^bafybei[a-z2-7]+$/);
    });
  });

  describe('Integration with other CID methods', () => {
    it('should produce different CID format than raw data CID', async () => {
      const content = Buffer.from('test content');

      // Calculate CID for raw data
      const rawCid = await cidCalculator.calculateCidV1ForRawData(content);

      // Calculate directory CID for a single file
      const dirCid = await cidCalculator.calculateDirectoryCid([
        { name: 'file.txt', content },
      ]);

      // Should produce different CIDs
      expect(rawCid).not.toBe(dirCid);

      // Raw CID should start with 'bafkrei' (raw codec)
      expect(rawCid).toMatch(/^bafkrei[a-z2-7]+$/);

      // Directory CID should start with 'bafybei' (dag-pb codec)
      expect(dirCid).toMatch(/^bafybei[a-z2-7]+$/);
    });

    it('should produce different CID than UnixFS file CID', async () => {
      const content = Buffer.from('test content');

      // Calculate UnixFS file CID
      const fileCid = await cidCalculator.calculateCidV1(content);

      // Calculate directory CID for a single file
      const dirCid = await cidCalculator.calculateDirectoryCid([
        { name: 'file.txt', content },
      ]);

      // Should produce different CIDs even for same content
      expect(fileCid).not.toBe(dirCid);

      // Both should be dag-pb format but different structure
      expect(fileCid).toMatch(/^bafybei[a-z2-7]+$/);
      expect(dirCid).toMatch(/^bafybei[a-z2-7]+$/);
    });
  });
});
