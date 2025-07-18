import { describe, it, expect, beforeEach, vi } from 'vitest';
import { IPLDConverterService } from '../../../src/services/ipld-converter.service';
import { PinataService } from '../../../src/services/pinata.service';
import { CidCalculatorService } from '../../../src/services/cid-calculator.service';
import { promises as fsPromises } from 'fs';

vi.mock('fs', () => ({
  promises: {
    readFile: vi.fn(),
  },
}));

describe('IPLDConverterService', () => {
  let ipldConverterService: IPLDConverterService;
  let mockPinataService: PinataService;
  let mockCidCalculatorService: CidCalculatorService;

  beforeEach(() => {
    // Create mock Pinata service
    mockPinataService = {
      uploadBatch: vi.fn().mockResolvedValue([
        {
          success: true,
          cid: 'QmMockUploadedCID123456789012345678901234567890',
          propertyCid: 'linked-content',
          dataGroupCid: 'linked-content',
        },
      ]),
    } as any;

    // Create mock CID calculator
    mockCidCalculatorService = {
      calculateCidV0: vi
        .fn()
        .mockResolvedValue('QmMockCalculatedCID123456789012345678901234567'),
      calculateCidV1: vi
        .fn()
        .mockResolvedValue(
          'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi'
        ),
      calculateCidAutoFormat: vi
        .fn()
        .mockResolvedValue('QmMockCalculatedCID123456789012345678901234567'),
    } as any;

    ipldConverterService = new IPLDConverterService(
      '/test/base',
      mockPinataService,
      mockCidCalculatorService
    );

    vi.clearAllMocks();
  });

  describe('hasIPLDLinks', () => {
    it('should detect CID links', () => {
      const dataWithCID = {
        name: 'test',
        link: { '/': 'QmYjtig7VJQ6XsnUjqqJvj7QaMcCAwtrgNdahSiFofrE7o' },
      };

      expect(ipldConverterService.hasIPLDLinks(dataWithCID)).toBe(true);
    });

    it('should detect file path links', () => {
      const dataWithPath = {
        name: 'test',
        data: { '/': './data/file.json' },
      };

      expect(ipldConverterService.hasIPLDLinks(dataWithPath)).toBe(true);
    });

    it('should return false for data without links', () => {
      const dataWithoutLinks = {
        name: 'test',
        value: 42,
        nested: {
          array: [1, 2, 3],
          string: 'hello',
        },
      };

      expect(ipldConverterService.hasIPLDLinks(dataWithoutLinks)).toBe(false);
    });

    it('should detect links in arrays', () => {
      const dataWithArrayLinks = {
        items: [
          { '/': 'QmYjtig7VJQ6XsnUjqqJvj7QaMcCAwtrgNdahSiFofrE7o' },
          { value: 'normal' },
          { '/': 'file.json' },
        ],
      };

      expect(ipldConverterService.hasIPLDLinks(dataWithArrayLinks)).toBe(true);
    });

    it('should detect deeply nested links', () => {
      const dataWithNestedLinks = {
        level1: {
          level2: {
            level3: {
              link: { '/': 'deep/file.json' },
            },
          },
        },
      };

      expect(ipldConverterService.hasIPLDLinks(dataWithNestedLinks)).toBe(true);
    });
  });

  describe('convertToIPLD', () => {
    it('should preserve existing CID links', async () => {
      const dataWithCID = {
        name: 'test',
        link: { '/': 'QmYjtig7VJQ6XsnUjqqJvj7QaMcCAwtrgNdahSiFofrE7o' },
      };

      const result = await ipldConverterService.convertToIPLD(dataWithCID);

      expect(result.hasLinks).toBe(true);
      expect(result.linkedCIDs).toHaveLength(1);
      expect(result.linkedCIDs[0]).toBe(
        'QmYjtig7VJQ6XsnUjqqJvj7QaMcCAwtrgNdahSiFofrE7o'
      );
      expect(result.convertedData).toEqual(dataWithCID);
    });

    it('should convert relative file paths to CIDs', async () => {
      vi.mocked(fsPromises.readFile).mockResolvedValueOnce(
        JSON.stringify({ content: 'file data' }) as any
      );

      const dataWithPath = {
        name: 'test',
        data: { '/': 'data/file.json' },
      };

      const result = await ipldConverterService.convertToIPLD(dataWithPath);

      expect(result.hasLinks).toBe(true);
      expect(result.linkedCIDs).toHaveLength(1);
      expect(result.linkedCIDs[0]).toBe(
        'QmMockUploadedCID123456789012345678901234567890'
      );
      expect(result.convertedData).toEqual({
        name: 'test',
        data: { '/': 'QmMockUploadedCID123456789012345678901234567890' },
      });

      expect(fsPromises.readFile).toHaveBeenCalledWith(
        '/test/base/data/file.json',
        'utf-8'
      );
      expect(mockPinataService.uploadBatch).toHaveBeenCalled();
    });

    it('should convert absolute file paths to CIDs', async () => {
      vi.mocked(fsPromises.readFile).mockResolvedValueOnce(
        JSON.stringify({ content: 'absolute file' }) as any
      );

      const dataWithAbsolutePath = {
        name: 'test',
        config: { '/': '/etc/config.json' },
      };

      const result =
        await ipldConverterService.convertToIPLD(dataWithAbsolutePath);

      expect(result.hasLinks).toBe(true);
      expect(result.linkedCIDs).toHaveLength(1);
      expect(fsPromises.readFile).toHaveBeenCalledWith(
        '/etc/config.json',
        'utf-8'
      );
    });

    it('should handle multiple links', async () => {
      vi.mocked(fsPromises.readFile)
        .mockResolvedValueOnce(JSON.stringify({ type: 'config' }) as any)
        .mockResolvedValueOnce(JSON.stringify({ type: 'data' }) as any);

      const dataWithMultipleLinks = {
        config: { '/': 'config.json' },
        data: { '/': 'data.json' },
        existingCID: {
          '/': 'QmYjtig7VJQ6XsnUjqqJvj7QaMcCAwtrgNdahSiFofrE7o',
        },
      };

      const result = await ipldConverterService.convertToIPLD(
        dataWithMultipleLinks
      );

      expect(result.hasLinks).toBe(true);
      expect(result.linkedCIDs).toHaveLength(3);
      expect(mockPinataService.uploadBatch).toHaveBeenCalledTimes(2);
    });

    it('should handle nested arrays with links', async () => {
      vi.mocked(fsPromises.readFile).mockResolvedValueOnce(
        JSON.stringify({ nested: 'data' }) as any
      );

      const dataWithArrayLinks = {
        items: [
          { name: 'item1', ref: { '/': 'nested/item.json' } },
          { name: 'item2', value: 42 },
        ],
      };

      const result =
        await ipldConverterService.convertToIPLD(dataWithArrayLinks);

      expect(result.hasLinks).toBe(true);
      expect(result.linkedCIDs).toHaveLength(1);
      expect(result.convertedData.items[0].ref['/']).toBe(
        'QmMockUploadedCID123456789012345678901234567890'
      );
      expect(result.convertedData.items[1]).toEqual({
        name: 'item2',
        value: 42,
      });
    });

    it('should resolve relative paths based on current file location', async () => {
      vi.mocked(fsPromises.readFile).mockResolvedValueOnce(
        JSON.stringify({ content: 'sibling file' }) as any
      );

      const dataWithRelativePath = {
        name: 'test',
        sibling: { '/': './sibling.json' },
      };

      const currentFilePath = '/test/data/subdir/current.json';
      const result = await ipldConverterService.convertToIPLD(
        dataWithRelativePath,
        currentFilePath
      );

      expect(result.hasLinks).toBe(true);
      expect(result.linkedCIDs).toHaveLength(1);

      // Should resolve relative to /test/data/subdir/
      expect(fsPromises.readFile).toHaveBeenCalledWith(
        '/test/data/subdir/sibling.json',
        'utf-8'
      );
    });

    it('should resolve parent directory references correctly', async () => {
      vi.mocked(fsPromises.readFile).mockResolvedValueOnce(
        JSON.stringify({ content: 'parent file' }) as any
      );

      const dataWithParentPath = {
        name: 'test',
        parent: { '/': '../parent.json' },
      };

      const currentFilePath = '/test/data/subdir/current.json';
      const result = await ipldConverterService.convertToIPLD(
        dataWithParentPath,
        currentFilePath
      );

      expect(result.hasLinks).toBe(true);

      // Should resolve relative to /test/data/
      expect(fsPromises.readFile).toHaveBeenCalledWith(
        '/test/data/parent.json',
        'utf-8'
      );
    });

    it('should handle plain text files', async () => {
      vi.mocked(fsPromises.readFile).mockResolvedValueOnce(
        'This is plain text content' as any
      );

      const dataWithTextFile = {
        readme: { '/': 'README.txt' },
      };

      const result = await ipldConverterService.convertToIPLD(dataWithTextFile);

      expect(result.hasLinks).toBe(true);
      expect(
        mockCidCalculatorService.calculateCidAutoFormat
      ).toHaveBeenCalledWith('This is plain text content');
    });

    it('should throw error for missing files', async () => {
      vi.mocked(fsPromises.readFile).mockRejectedValueOnce(
        new Error('ENOENT: no such file or directory')
      );

      const dataWithMissingFile = {
        missing: { '/': 'nonexistent.json' },
      };

      await expect(
        ipldConverterService.convertToIPLD(dataWithMissingFile)
      ).rejects.toThrow('Failed to upload file nonexistent.json');
    });

    it('should calculate CID locally when no Pinata service', async () => {
      const converterWithoutPinata = new IPLDConverterService(
        '/test/base',
        undefined,
        mockCidCalculatorService
      );

      vi.mocked(fsPromises.readFile).mockResolvedValueOnce(
        JSON.stringify({ local: 'calculation' }) as any
      );

      const data = {
        file: { '/': 'local.json' },
      };

      const result = await converterWithoutPinata.convertToIPLD(data);

      expect(result.hasLinks).toBe(true);
      expect(result.linkedCIDs[0]).toBe(
        'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi'
      );
      expect(mockPinataService.uploadBatch).not.toHaveBeenCalled();
    });

    it('should recursively process nested file path links in referenced files', async () => {
      // Mock file system reads:
      // 1. Main file with link to relationship.json
      // 2. relationship.json contains links to person.json and property.json
      // 3. person.json contains actual person data
      // 4. property.json contains actual property data

      vi.mocked(fsPromises.readFile)
        // First call: relationship.json with nested file links
        .mockResolvedValueOnce(
          JSON.stringify({
            from: { '/': './person.json' },
            to: { '/': './property.json' },
          }) as any
        )
        // Second call: person.json
        .mockResolvedValueOnce(
          JSON.stringify({
            name: 'John Doe',
            age: 30,
          }) as any
        )
        // Third call: property.json
        .mockResolvedValueOnce(
          JSON.stringify({
            address: '123 Main St',
            value: 250000,
          }) as any
        );

      // Mock Pinata service to return different CIDs for each upload
      mockPinataService.uploadBatch = vi
        .fn()
        .mockResolvedValueOnce([
          {
            success: true,
            cid: 'bafkreipersoncid12345678901234567890123456789012',
            propertyCid: 'linked-content',
            dataGroupCid: 'linked-content',
          },
        ])
        .mockResolvedValueOnce([
          {
            success: true,
            cid: 'bafkreipropertycid1234567890123456789012345678901',
            propertyCid: 'linked-content',
            dataGroupCid: 'linked-content',
          },
        ])
        .mockResolvedValueOnce([
          {
            success: true,
            cid: 'bafkreirelationshipcid123456789012345678901234567',
            propertyCid: 'linked-content',
            dataGroupCid: 'linked-content',
          },
        ]);

      const dataWithNestedLinks = {
        label: 'County',
        relationship: { '/': 'relationship.json' },
      };

      const result = await ipldConverterService.convertToIPLD(
        dataWithNestedLinks,
        '/test/data/main.json'
      );

      expect(result.hasLinks).toBe(true);
      expect(result.linkedCIDs).toHaveLength(3); // person.json, property.json, relationship.json

      // Verify the nested structure was properly converted
      expect(result.convertedData).toEqual({
        label: 'County',
        relationship: {
          '/': 'bafkreirelationshipcid123456789012345678901234567',
        },
      });

      // Verify all three files were read
      expect(fsPromises.readFile).toHaveBeenCalledTimes(3);
      expect(fsPromises.readFile).toHaveBeenCalledWith(
        '/test/data/relationship.json',
        'utf-8'
      );
      expect(fsPromises.readFile).toHaveBeenCalledWith(
        '/test/data/person.json',
        'utf-8'
      );
      expect(fsPromises.readFile).toHaveBeenCalledWith(
        '/test/data/property.json',
        'utf-8'
      );

      // Verify all three files were uploaded
      expect(mockPinataService.uploadBatch).toHaveBeenCalledTimes(3);
    });
  });

  describe('DAG-JSON encoding/decoding', () => {
    it('should encode and decode DAG-JSON', () => {
      const data = {
        name: 'test',
        link: { '/': 'QmYjtig7VJQ6XsnUjqqJvj7QaMcCAwtrgNdahSiFofrE7o' },
        nested: {
          value: 42,
        },
      };

      const encoded = ipldConverterService.encodeAsDAGJSON(data);
      expect(encoded).toBeInstanceOf(Uint8Array);

      const decoded = ipldConverterService.decodeDAGJSON(encoded);

      // DAG-JSON decodes CID links as CID objects, not plain objects
      expect(decoded.name).toBe('test');
      expect(decoded.nested).toEqual({ value: 42 });
      expect(decoded.link).toBeDefined();
      expect(decoded.link.toString()).toBe(
        'QmYjtig7VJQ6XsnUjqqJvj7QaMcCAwtrgNdahSiFofrE7o'
      );
    });
  });

  describe('DAG-CBOR encoding', () => {
    it('should encode as DAG-CBOR and calculate CID', async () => {
      const data = {
        test: 'data',
        link: { '/': 'QmYjtig7VJQ6XsnUjqqJvj7QaMcCAwtrgNdahSiFofrE7o' },
      };

      const cid = await ipldConverterService.calculateDAGCBORCid(data);
      expect(cid).toMatch(/^bafy/); // CIDv1 starts with 'bafy' for dag-cbor
    });
  });
});
