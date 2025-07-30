import { describe, it, expect, beforeEach, vi } from 'vitest';
import { IPLDConverterService } from '../../../src/services/ipld-converter.service.js';
import { PinataService } from '../../../src/services/pinata.service.js';
import { CidCalculatorService } from '../../../src/services/cid-calculator.service.js';
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
      calculateCidV1ForRawData: vi
        .fn()
        .mockResolvedValue(
          'bafkreihq2v2fhjhzwmm6zfkjitfvp3g3czrnymy3dqpwl5slsx5om3d2me'
        ),
      calculateCidFromCanonicalJson: vi
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

    it('should detect string values with ipfs_uri format', () => {
      const dataWithIpfsUri = 'path/to/image.png';
      const schema = { format: 'ipfs_uri' };

      expect(ipldConverterService.hasIPLDLinks(dataWithIpfsUri, schema)).toBe(
        true
      );
    });

    it('should not detect string values with ipfs_uri format if already IPFS URI', () => {
      const dataWithIpfsUri =
        'ipfs://QmYjtig7VJQ6XsnUjqqJvj7QaMcCAwtrgNdahSiFofrE7o';
      const schema = { format: 'ipfs_uri' };

      expect(ipldConverterService.hasIPLDLinks(dataWithIpfsUri, schema)).toBe(
        false
      );
    });

    it('should detect file path links in ipfs_url fields', () => {
      const dataWithPath = {
        name: 'test',
        ipfs_url: './data/image.png',
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
        // ipfs_url that's already an IPFS URI should not be detected as a link
        ipfs_url: 'ipfs://QmYjtig7VJQ6XsnUjqqJvj7QaMcCAwtrgNdahSiFofrE7o',
      };

      expect(ipldConverterService.hasIPLDLinks(dataWithoutLinks)).toBe(false);
    });

    it('should detect links in arrays', () => {
      const dataWithArrayLinks = {
        items: [
          { ipfs_url: './images/photo1.jpg' },
          { value: 'normal' },
          { ipfs_url: 'images/photo2.png' },
        ],
      };

      expect(ipldConverterService.hasIPLDLinks(dataWithArrayLinks)).toBe(true);
    });

    it('should detect deeply nested links', () => {
      const dataWithNestedLinks = {
        level1: {
          level2: {
            level3: {
              ipfs_url: 'deep/image.jpg',
            },
          },
        },
      };

      expect(ipldConverterService.hasIPLDLinks(dataWithNestedLinks)).toBe(true);
    });

    it('should detect links with schema context', () => {
      const dataWithSchema = {
        image: 'photo.jpg',
        data: { value: 42 },
      };
      const schema = {
        properties: {
          image: { format: 'ipfs_uri' },
          data: { type: 'object' },
        },
      };

      expect(ipldConverterService.hasIPLDLinks(dataWithSchema, schema)).toBe(
        true
      );
    });

    it('should handle nested objects with ipfs_url fields', () => {
      const nestedData = {
        level1: {
          level2: {
            ipfs_url: './images/photo.jpg',
          },
        },
      };

      expect(ipldConverterService.hasIPLDLinks(nestedData)).toBe(true);
    });

    it('should handle arrays with ipfs_url fields', () => {
      const arrayData = {
        items: [
          { ipfs_url: './file1.png' },
          { name: 'regular' },
          { ipfs_url: 'images/photo2.jpg' },
        ],
      };

      expect(ipldConverterService.hasIPLDLinks(arrayData)).toBe(true);
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

    it('should convert file path references to CIDs - seed data scenario', async () => {
      vi.mocked(fsPromises.readFile).mockResolvedValueOnce(
        JSON.stringify({ property: 'bafkreixxxxx', address: '0x1234' }) as any
      );

      const seedData = {
        label: 'Seed',
        relationships: {
          property_seed: {
            '/': './relationship_property_to_address.json',
          },
        },
      };

      const result = await ipldConverterService.convertToIPLD(seedData);

      expect(result.hasLinks).toBe(true);
      expect(result.linkedCIDs).toHaveLength(1);
      expect(result.linkedCIDs[0]).toBe(
        'QmMockUploadedCID123456789012345678901234567890'
      );
      expect(result.convertedData).toEqual({
        label: 'Seed',
        relationships: {
          property_seed: {
            '/': 'QmMockUploadedCID123456789012345678901234567890',
          },
        },
      });

      expect(fsPromises.readFile).toHaveBeenCalledWith(
        '/test/base/relationship_property_to_address.json',
        'utf-8'
      );
      expect(mockPinataService.uploadBatch).toHaveBeenCalled();
    });

    it('should convert image paths in ipfs_url fields to IPFS URIs', async () => {
      vi.mocked(fsPromises.readFile).mockResolvedValueOnce(
        Buffer.from('fake image data')
      );

      const dataWithPath = {
        name: 'test',
        ipfs_url: 'data/image.png',
      };

      const result = await ipldConverterService.convertToIPLD(dataWithPath);

      expect(result.hasLinks).toBe(true);
      expect(result.linkedCIDs).toHaveLength(1);
      expect(result.linkedCIDs[0]).toBe(
        'QmMockUploadedCID123456789012345678901234567890'
      );
      expect(result.convertedData).toEqual({
        name: 'test',
        ipfs_url: 'ipfs://QmMockUploadedCID123456789012345678901234567890',
      });

      expect(fsPromises.readFile).toHaveBeenCalledWith(
        '/test/base/data/image.png'
      );
      expect(mockPinataService.uploadBatch).toHaveBeenCalled();
    });

    it('should convert absolute image paths in ipfs_url fields', async () => {
      vi.mocked(fsPromises.readFile).mockResolvedValueOnce(
        Buffer.from('fake image data')
      );

      const dataWithAbsolutePath = {
        name: 'test',
        ipfs_url: '/etc/image.jpg',
      };

      const result =
        await ipldConverterService.convertToIPLD(dataWithAbsolutePath);

      expect(result.hasLinks).toBe(true);
      expect(result.linkedCIDs).toHaveLength(1);
      expect(fsPromises.readFile).toHaveBeenCalledWith('/etc/image.jpg');
    });

    it('should handle multiple ipfs_url fields', async () => {
      vi.mocked(fsPromises.readFile)
        .mockResolvedValueOnce(Buffer.from('image1'))
        .mockResolvedValueOnce(Buffer.from('image2'));

      // Return different CIDs for each upload
      mockPinataService.uploadBatch = vi
        .fn()
        .mockResolvedValueOnce([
          {
            success: true,
            cid: 'QmMockUploadedCID1',
            propertyCid: 'linked-content',
            dataGroupCid: 'linked-content',
          },
        ])
        .mockResolvedValueOnce([
          {
            success: true,
            cid: 'QmMockUploadedCID2',
            propertyCid: 'linked-content',
            dataGroupCid: 'linked-content',
          },
        ]);

      const dataWithMultipleLinks = {
        ipfs_url: 'image1.png',
        metadata: {
          ipfs_url: 'image2.jpg',
        },
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
      expect(result.convertedData.ipfs_url).toBe('ipfs://QmMockUploadedCID1');
      expect(result.convertedData.metadata.ipfs_url).toBe(
        'ipfs://QmMockUploadedCID2'
      );
    });

    it('should handle nested arrays with ipfs_url fields', async () => {
      vi.mocked(fsPromises.readFile).mockResolvedValueOnce(
        Buffer.from('fake image')
      );

      const dataWithArrayLinks = {
        items: [
          { name: 'item1', ipfs_url: 'nested/image.png' },
          { name: 'item2', value: 42 },
        ],
      };

      const result =
        await ipldConverterService.convertToIPLD(dataWithArrayLinks);

      expect(result.hasLinks).toBe(true);
      expect(result.linkedCIDs).toHaveLength(1);
      expect(result.convertedData.items[0].ipfs_url).toBe(
        'ipfs://QmMockUploadedCID123456789012345678901234567890'
      );
      expect(result.convertedData.items[1]).toEqual({
        name: 'item2',
        value: 42,
      });
    });

    it('should resolve relative paths based on current file location', async () => {
      vi.mocked(fsPromises.readFile).mockResolvedValueOnce(
        Buffer.from('sibling image')
      );

      const dataWithRelativePath = {
        name: 'test',
        ipfs_url: './sibling.jpg',
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
        '/test/data/subdir/sibling.jpg'
      );
    });

    it('should resolve parent directory references correctly', async () => {
      vi.mocked(fsPromises.readFile).mockResolvedValueOnce(
        Buffer.from('parent image')
      );

      const dataWithParentPath = {
        name: 'test',
        ipfs_url: '../parent.png',
      };

      const currentFilePath = '/test/data/subdir/current.json';
      const result = await ipldConverterService.convertToIPLD(
        dataWithParentPath,
        currentFilePath
      );

      expect(result.hasLinks).toBe(true);

      // Should resolve relative to /test/data/
      expect(fsPromises.readFile).toHaveBeenCalledWith('/test/data/parent.png');
    });

    it('should not process non-image files in ipfs_url fields', async () => {
      const dataWithTextFile = {
        name: 'test',
        ipfs_url: 'data/file.json',
      };

      const result = await ipldConverterService.convertToIPLD(dataWithTextFile);

      // Non-image files in ipfs_url should not be processed
      expect(result.hasLinks).toBe(false);
      expect(result.convertedData).toEqual(dataWithTextFile);
      expect(mockPinataService.uploadBatch).not.toHaveBeenCalled();
    });

    it('should handle ipfs_url fields that are already IPFS URIs', async () => {
      const dataWithIpfsUri = {
        name: 'test',
        ipfs_url: 'ipfs://QmYjtig7VJQ6XsnUjqqJvj7QaMcCAwtrgNdahSiFofrE7o',
      };

      const result = await ipldConverterService.convertToIPLD(dataWithIpfsUri);

      expect(result.hasLinks).toBe(false);
      expect(result.convertedData).toEqual(dataWithIpfsUri);
      expect(mockPinataService.uploadBatch).not.toHaveBeenCalled();
    });

    it('should convert bare CIDs to IPFS URIs in ipfs_url fields', async () => {
      const dataWithBareCid = {
        name: 'test',
        ipfs_url: 'QmYjtig7VJQ6XsnUjqqJvj7QaMcCAwtrgNdahSiFofrE7o',
      };

      const result = await ipldConverterService.convertToIPLD(dataWithBareCid);

      expect(result.hasLinks).toBe(false);
      expect(result.convertedData).toEqual({
        name: 'test',
        ipfs_url: 'ipfs://QmYjtig7VJQ6XsnUjqqJvj7QaMcCAwtrgNdahSiFofrE7o',
      });
    });

    it('should not upload images if no Pinata service is provided', async () => {
      const converterWithoutPinata = new IPLDConverterService(
        '/test/base',
        undefined,
        mockCidCalculatorService
      );

      const dataWithLink = {
        ipfs_url: 'image.png',
      };

      const result = await converterWithoutPinata.convertToIPLD(dataWithLink);

      // Without Pinata service, it won't process the image
      expect(result.hasLinks).toBe(false);
      expect(result.convertedData).toEqual(dataWithLink);
    });
  });

  describe('image handling', () => {
    it('should handle image paths with schema format ipfs_uri', async () => {
      vi.mocked(fsPromises.readFile).mockResolvedValueOnce(
        Buffer.from('image data')
      );

      const data = 'path/to/image.png';
      const schema = { format: 'ipfs_uri' };

      const result = await ipldConverterService.convertToIPLD(
        data,
        undefined,
        schema
      );

      expect(result.hasLinks).toBe(true);
      expect(result.linkedCIDs).toHaveLength(1);
      expect(result.convertedData).toBe(
        'ipfs://QmMockUploadedCID123456789012345678901234567890'
      );
    });

    it('should handle nested objects with image paths', async () => {
      vi.mocked(fsPromises.readFile).mockResolvedValueOnce(
        Buffer.from('image data')
      );

      const data = {
        metadata: {
          ipfs_url: 'images/photo.jpg',
        },
      };

      const result = await ipldConverterService.convertToIPLD(data);

      expect(result.hasLinks).toBe(true);
      expect(result.convertedData.metadata.ipfs_url).toBe(
        'ipfs://QmMockUploadedCID123456789012345678901234567890'
      );
    });

    it('should convert bare CIDs to IPFS URIs when format is ipfs_uri', async () => {
      const data = 'QmYjtig7VJQ6XsnUjqqJvj7QaMcCAwtrgNdahSiFofrE7o';
      const schema = { format: 'ipfs_uri' };

      const result = await ipldConverterService.convertToIPLD(
        data,
        undefined,
        schema
      );

      expect(result.hasLinks).toBe(false);
      expect(result.convertedData).toBe(
        'ipfs://QmYjtig7VJQ6XsnUjqqJvj7QaMcCAwtrgNdahSiFofrE7o'
      );
    });

    it('should handle arrays with image paths', async () => {
      vi.mocked(fsPromises.readFile)
        .mockResolvedValueOnce(Buffer.from('image1'))
        .mockResolvedValueOnce(Buffer.from('image2'));

      mockPinataService.uploadBatch = vi
        .fn()
        .mockResolvedValueOnce([
          {
            success: true,
            cid: 'QmMockUploadedCID1',
            propertyCid: 'linked-content',
            dataGroupCid: 'linked-content',
          },
        ])
        .mockResolvedValueOnce([
          {
            success: true,
            cid: 'QmMockUploadedCID2',
            propertyCid: 'linked-content',
            dataGroupCid: 'linked-content',
          },
        ]);

      const data = {
        images: [{ ipfs_url: 'photo1.jpg' }, { ipfs_url: 'photo2.png' }],
      };

      const result = await ipldConverterService.convertToIPLD(data);

      expect(result.hasLinks).toBe(true);
      expect(result.linkedCIDs).toHaveLength(2);
      expect(result.convertedData.images[0].ipfs_url).toBe(
        'ipfs://QmMockUploadedCID1'
      );
      expect(result.convertedData.images[1].ipfs_url).toBe(
        'ipfs://QmMockUploadedCID2'
      );
    });

    it('should only process as image when it is an image file in ipfs_url field', async () => {
      const data = {
        ipfs_url: 'document.pdf', // Not an image
        image_url: 'photo.jpg', // Not ipfs_url field
      };

      const result = await ipldConverterService.convertToIPLD(data);

      // Should not process either field
      expect(result.hasLinks).toBe(false);
      expect(result.convertedData).toEqual(data);
      expect(mockPinataService.uploadBatch).not.toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('should throw error when no context for relative path', async () => {
      const dataWithRelativePath = {
        ipfs_url: './relative/image.png',
      };

      // No current file path provided, but converter only processes image files
      // Since this is an image file, it should try to process it
      const result =
        await ipldConverterService.convertToIPLD(dataWithRelativePath);

      // The path will be resolved relative to base directory
      expect(fsPromises.readFile).toHaveBeenCalledWith(
        '/test/base/relative/image.png'
      );
    });

    it('should throw error for missing image files', async () => {
      vi.mocked(fsPromises.readFile).mockRejectedValueOnce(
        new Error('ENOENT: no such file or directory')
      );

      const dataWithMissingFile = {
        ipfs_url: 'missing-image.png',
      };

      await expect(
        ipldConverterService.convertToIPLD(dataWithMissingFile)
      ).rejects.toThrow('ENOENT: no such file or directory');
    });

    it('should handle upload failures for images', async () => {
      vi.mocked(fsPromises.readFile).mockResolvedValueOnce(
        Buffer.from('image data')
      );

      mockPinataService.uploadBatch = vi.fn().mockResolvedValueOnce([
        {
          success: false,
          error: 'Upload failed',
          propertyCid: 'linked-content',
          dataGroupCid: 'linked-content',
        },
      ]);

      const dataWithImage = {
        ipfs_url: 'image.png',
      };

      await expect(
        ipldConverterService.convertToIPLD(dataWithImage)
      ).rejects.toThrow('Failed to upload linked file: Upload failed');
    });
  });
});
