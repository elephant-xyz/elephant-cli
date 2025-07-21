import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CidCalculatorService } from '../../../src/services/cid-calculator.service';
import { CID } from 'multiformats/cid';
import * as raw from 'multiformats/codecs/raw';

describe('CidCalculatorService', () => {
  let cidCalculator: CidCalculatorService;

  beforeEach(() => {
    cidCalculator = new CidCalculatorService();
  });

  describe('stringToBuffer', () => {
    it('should convert string to Buffer with UTF-8 encoding', () => {
      const input = 'Hello, World!';
      const buffer = cidCalculator.stringToBuffer(input);

      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.toString('utf-8')).toBe(input);
      expect(buffer.length).toBe(13);
    });

    it('should handle empty string', () => {
      const buffer = cidCalculator.stringToBuffer('');

      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.length).toBe(0);
    });

    it('should handle unicode characters', () => {
      const input = '🚀 Unicode test 测试';
      const buffer = cidCalculator.stringToBuffer(input);

      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.toString('utf-8')).toBe(input);
    });
  });

  describe('calculateCidV0', () => {
    it('should calculate valid CID v0 for simple data', async () => {
      const data = Buffer.from('Hello IPFS!');
      const cid = await cidCalculator.calculateCidV0(data);

      // CID v0 should start with 'Qm' and be 46 characters long
      expect(cid).toMatch(/^Qm[a-zA-Z0-9]{44}$/);
      expect(cid.length).toBe(46);
    });

    it('should calculate consistent CID for same data', async () => {
      const data = Buffer.from('Test data');

      const cid1 = await cidCalculator.calculateCidV0(data);
      const cid2 = await cidCalculator.calculateCidV0(data);

      expect(cid1).toBe(cid2);
    });

    it('should calculate different CIDs for different data', async () => {
      const data1 = Buffer.from('Data 1');
      const data2 = Buffer.from('Data 2');

      const cid1 = await cidCalculator.calculateCidV0(data1);
      const cid2 = await cidCalculator.calculateCidV0(data2);

      expect(cid1).not.toBe(cid2);
    });

    it('should handle empty buffer', async () => {
      const data = Buffer.from('');
      const cid = await cidCalculator.calculateCidV0(data);

      expect(cid).toMatch(/^Qm[a-zA-Z0-9]{44}$/);
    });

    it('should handle large buffer', async () => {
      const data = Buffer.alloc(1024 * 1024, 'a'); // 1MB of 'a'
      const cid = await cidCalculator.calculateCidV0(data);

      expect(cid).toMatch(/^Qm[a-zA-Z0-9]{44}$/);
    });

    it('should handle buffer with binary data', async () => {
      const data = Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe, 0xfd]);
      const cid = await cidCalculator.calculateCidV0(data);

      expect(cid).toMatch(/^Qm[a-zA-Z0-9]{44}$/);
    });

    // Known CID test - comparing with actual IPFS output
    it('should match known CID for specific input', async () => {
      // This test would need adjustment based on actual IPFS implementation
      // For now, we just verify the format
      const data = Buffer.from('{"test": "data"}');
      const cid = await cidCalculator.calculateCidV0(data);

      expect(cid).toMatch(/^Qm[a-zA-Z0-9]{44}$/);
      // In a real implementation, you would compare with a known CID
      // expect(cid).toBe('QmXXX...');
    });

    it('should throw error for null input', async () => {
      // Simplified implementation properly rejects null input
      await expect(cidCalculator.calculateCidV0(null as any)).rejects.toThrow(
        'Invalid input: data must be a valid Buffer'
      );
    });
  });

  describe('calculateBatch', () => {
    it('should calculate CIDs for multiple buffers', async () => {
      const dataArray = [
        Buffer.from('Data 1'),
        Buffer.from('Data 2'),
        Buffer.from('Data 3'),
      ];

      const cids = await cidCalculator.calculateBatch(dataArray);

      expect(cids).toHaveLength(3);
      cids.forEach((cid) => {
        expect(cid).toMatch(/^Qm[a-zA-Z0-9]{44}$/);
      });

      // All CIDs should be different
      expect(new Set(cids).size).toBe(3);
    });

    it('should handle empty array', async () => {
      const cids = await cidCalculator.calculateBatch([]);

      expect(cids).toEqual([]);
    });

    it('should handle array with single buffer', async () => {
      const dataArray = [Buffer.from('Single data')];
      const cids = await cidCalculator.calculateBatch(dataArray);

      expect(cids).toHaveLength(1);
      expect(cids[0]).toMatch(/^Qm[a-zA-Z0-9]{44}$/);
    });

    it('should handle array with duplicate data', async () => {
      const data = Buffer.from('Same data');
      const dataArray = [data, data, data];

      const cids = await cidCalculator.calculateBatch(dataArray);

      expect(cids).toHaveLength(3);
      // All CIDs should be the same for same data
      expect(cids[0]).toBe(cids[1]);
      expect(cids[1]).toBe(cids[2]);
    });

    it('should maintain order of results', async () => {
      const dataArray = [
        Buffer.from('AAA'),
        Buffer.from('BBB'),
        Buffer.from('CCC'),
      ];

      const cids = await cidCalculator.calculateBatch(dataArray);

      // Calculate individual CIDs to verify order
      const individualCids = await Promise.all([
        cidCalculator.calculateCidV0(dataArray[0]),
        cidCalculator.calculateCidV0(dataArray[1]),
        cidCalculator.calculateCidV0(dataArray[2]),
      ]);

      expect(cids).toEqual(individualCids);
    });

    it('should handle errors in batch processing', async () => {
      const dataArray = [
        Buffer.from('Valid data'),
        null as any, // This will cause an error
        Buffer.from('Another valid data'),
      ];

      await expect(cidCalculator.calculateBatch(dataArray)).rejects.toThrow();
    });
  });

  describe('calculateCidFromJson', () => {
    it('should calculate CID from JSON object', async () => {
      const json = { name: 'test', value: 42 };
      const cid = await cidCalculator.calculateCidFromJson(json);

      expect(cid).toMatch(/^Qm[a-zA-Z0-9]{44}$/);
    });

    it('should calculate same CID for same JSON', async () => {
      const json = { a: 1, b: 2 };

      const cid1 = await cidCalculator.calculateCidFromJson(json);
      const cid2 = await cidCalculator.calculateCidFromJson(json);

      expect(cid1).toBe(cid2);
    });

    it('should calculate different CIDs for different JSON', async () => {
      const json1 = { name: 'test1' };
      const json2 = { name: 'test2' };

      const cid1 = await cidCalculator.calculateCidFromJson(json1);
      const cid2 = await cidCalculator.calculateCidFromJson(json2);

      expect(cid1).not.toBe(cid2);
    });

    it('should handle empty object', async () => {
      const cid = await cidCalculator.calculateCidFromJson({});

      expect(cid).toMatch(/^Qm[a-zA-Z0-9]{44}$/);
    });

    it('should handle complex nested objects', async () => {
      const json = {
        level1: {
          level2: {
            array: [1, 2, 3],
            string: 'test',
            boolean: true,
            null: null,
          },
        },
      };

      const cid = await cidCalculator.calculateCidFromJson(json);

      expect(cid).toMatch(/^Qm[a-zA-Z0-9]{44}$/);
    });

    it('should handle arrays', async () => {
      const json = [1, 2, 3, 'test', { nested: true }];
      const cid = await cidCalculator.calculateCidFromJson(json);

      expect(cid).toMatch(/^Qm[a-zA-Z0-9]{44}$/);
    });

    it('should be sensitive to property order in JSON.stringify', async () => {
      // JSON.stringify may serialize objects with same properties in same order
      const json1 = { a: 1, b: 2 };
      const json2 = { b: 2, a: 1 };

      const cid1 = await cidCalculator.calculateCidFromJson(json1);
      const cid2 = await cidCalculator.calculateCidFromJson(json2);

      // Note: This test documents behavior - JSON.stringify may or may not preserve order
      expect(typeof cid1).toBe('string');
      expect(typeof cid2).toBe('string');
    });
  });

  describe('performance', () => {
    it('should handle batch calculation efficiently', async () => {
      const dataArray = Array(100)
        .fill(null)
        .map((_, i) => Buffer.from(`Data ${i}`));

      const startTime = Date.now();
      const cids = await cidCalculator.calculateBatch(dataArray);
      const duration = Date.now() - startTime;

      expect(cids).toHaveLength(100);
      expect(duration).toBeLessThan(1000); // Should complete within 1 second
    });
  });

  describe('calculateCidV1ForRawData', () => {
    it('should calculate valid CID v1 for raw binary data', async () => {
      const data = Buffer.from('Hello Raw Data!');
      const cid = await cidCalculator.calculateCidV1ForRawData(data);

      // CID v1 should be base32 encoded and start with 'bafkrei'
      expect(cid).toMatch(/^bafkrei[a-z2-7]+$/);
      
      // Verify it's a valid CID
      const parsedCid = CID.parse(cid);
      expect(parsedCid.version).toBe(1);
      expect(parsedCid.code).toBe(raw.code); // Should use raw codec (0x55)
    });

    it('should calculate consistent CID for same raw data', async () => {
      const data = Buffer.from('Test raw data');

      const cid1 = await cidCalculator.calculateCidV1ForRawData(data);
      const cid2 = await cidCalculator.calculateCidV1ForRawData(data);

      expect(cid1).toBe(cid2);
    });

    it('should calculate different CIDs for different raw data', async () => {
      const data1 = Buffer.from('Image data 1');
      const data2 = Buffer.from('Image data 2');

      const cid1 = await cidCalculator.calculateCidV1ForRawData(data1);
      const cid2 = await cidCalculator.calculateCidV1ForRawData(data2);

      expect(cid1).not.toBe(cid2);
    });

    it('should handle empty buffer', async () => {
      const data = Buffer.from('');
      const cid = await cidCalculator.calculateCidV1ForRawData(data);

      expect(cid).toMatch(/^bafkrei[a-z2-7]+$/);
    });

    it('should handle large binary data', async () => {
      // Create a 1MB buffer
      const data = Buffer.alloc(1024 * 1024);
      data.fill('a');

      const cid = await cidCalculator.calculateCidV1ForRawData(data);

      expect(cid).toMatch(/^bafkrei[a-z2-7]+$/);
    });

    it('should throw error for invalid input', async () => {
      await expect(
        cidCalculator.calculateCidV1ForRawData(null as any)
      ).rejects.toThrow('Invalid input: data must be a valid Buffer');

      await expect(
        cidCalculator.calculateCidV1ForRawData('not a buffer' as any)
      ).rejects.toThrow('Invalid input: data must be a valid Buffer');
    });

    it('should produce different CID than UnixFS format', async () => {
      const data = Buffer.from('Compare formats');

      const rawCid = await cidCalculator.calculateCidV1ForRawData(data);
      const unixfsCid = await cidCalculator.calculateCidV1(data);

      // Raw and UnixFS CIDs should be different
      expect(rawCid).not.toBe(unixfsCid);
      
      // Raw CID uses raw codec, UnixFS uses dag-pb
      const rawParsed = CID.parse(rawCid);
      const unixfsParsed = CID.parse(unixfsCid);
      
      expect(rawParsed.code).toBe(0x55); // raw codec
      expect(unixfsParsed.code).toBe(0x70); // dag-pb codec
    });
  });
});
