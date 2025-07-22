import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { IPLDConverterService } from '../../../src/services/ipld-converter.service.js';
import { PinataService } from '../../../src/services/pinata.service.js';
import { CidCalculatorService } from '../../../src/services/cid-calculator.service.js';
import { promises as fsPromises } from 'fs';

vi.mock('fs', () => ({
  promises: {
    readFile: vi.fn(),
  },
}));

describe('IPLDConverterService - ipfs_url field handling', () => {
  let ipldConverterService: IPLDConverterService;
  let mockPinataService: PinataService;
  let mockCidCalculatorService: CidCalculatorService;

  beforeEach(() => {
    vi.clearAllMocks();

    mockPinataService = {
      uploadBatch: vi.fn().mockResolvedValue([
        {
          success: true,
          cid: 'QmMockUploadedCID1234567890123456789012345678',
        },
      ]),
    } as any;

    mockCidCalculatorService = {
      calculateCidAutoFormat: vi.fn().mockResolvedValue('QmMockCalculatedCID'),
      calculateCidV1ForRawData: vi.fn().mockResolvedValue('bafkreimockrawcid'),
    } as any;

    ipldConverterService = new IPLDConverterService(
      '/test/base',
      mockPinataService,
      mockCidCalculatorService
    );
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('ipfs_url field conversion', () => {
    it('should convert ipfs_url field with local image path to IPFS URI', async () => {
      const dataWithIpfsUrl = {
        name: 'Test Product',
        ipfs_url: './image.png'
      };

      // Mock file read for image
      vi.mocked(fsPromises.readFile).mockResolvedValueOnce(
        Buffer.from('fake image data')
      );

      const result = await ipldConverterService.convertToIPLD(dataWithIpfsUrl);

      expect(result.hasLinks).toBe(true);
      expect(result.linkedCIDs).toHaveLength(1);
      expect(result.convertedData.ipfs_url).toBe('ipfs://QmMockUploadedCID1234567890123456789012345678');
      expect(result.convertedData.name).toBe('Test Product');
    });

    it('should not convert non-ipfs_url fields', async () => {
      const dataWithOtherFields = {
        name: 'Test Product',
        image: './image.png',
        description: './description.txt'
      };

      const result = await ipldConverterService.convertToIPLD(dataWithOtherFields);

      expect(result.hasLinks).toBe(false);
      expect(result.linkedCIDs).toHaveLength(0);
      expect(result.convertedData).toEqual(dataWithOtherFields);
    });

    it('should not convert ipfs_url field if already an IPFS URI', async () => {
      const dataWithIpfsUri = {
        name: 'Test Product',
        ipfs_url: 'ipfs://bafkreiexistingcid'
      };

      const result = await ipldConverterService.convertToIPLD(dataWithIpfsUri);

      expect(result.hasLinks).toBe(false);
      expect(result.convertedData.ipfs_url).toBe('ipfs://bafkreiexistingcid');
    });

    it.skip('should convert bare CID in ipfs_url field to IPFS URI - not implemented', async () => {
      const dataWithCid = {
        name: 'Test Product',
        ipfs_url: 'bafkreiexistingcid'
      };

      const result = await ipldConverterService.convertToIPLD(dataWithCid);

      expect(result.hasLinks).toBe(false); // No file uploads, just formatting
      expect(result.convertedData.ipfs_url).toBe('ipfs://bafkreiexistingcid');
    });

    it('should handle nested ipfs_url fields', async () => {
      const nestedData = {
        label: 'Product',
        relationships: [{
          name: 'Relation 1',
          ipfs_url: './nested-image.jpg'
        }]
      };

      vi.mocked(fsPromises.readFile).mockResolvedValueOnce(
        Buffer.from('fake image data')
      );

      const result = await ipldConverterService.convertToIPLD(nestedData);

      expect(result.hasLinks).toBe(true);
      expect(result.linkedCIDs).toHaveLength(1);
      expect(result.convertedData.relationships[0].ipfs_url).toBe('ipfs://QmMockUploadedCID1234567890123456789012345678');
    });

    it('should handle multiple ipfs_url fields', async () => {
      const dataWithMultiple = {
        primary: {
          ipfs_url: './image1.png'
        },
        secondary: {
          ipfs_url: './image2.jpg'
        }
      };

      vi.mocked(fsPromises.readFile)
        .mockResolvedValueOnce(Buffer.from('image1 data'))
        .mockResolvedValueOnce(Buffer.from('image2 data'));

      const result = await ipldConverterService.convertToIPLD(dataWithMultiple);

      expect(result.hasLinks).toBe(true);
      expect(result.linkedCIDs).toHaveLength(2);
      expect(result.convertedData.primary.ipfs_url).toBe('ipfs://QmMockUploadedCID1234567890123456789012345678');
      expect(result.convertedData.secondary.ipfs_url).toBe('ipfs://QmMockUploadedCID1234567890123456789012345678');
    });

    it('should not convert ipfs_url field if value is not an image', async () => {
      const dataWithNonImage = {
        name: 'Test',
        ipfs_url: './document.txt'
      };

      const result = await ipldConverterService.convertToIPLD(dataWithNonImage);

      expect(result.hasLinks).toBe(false);
      expect(result.convertedData.ipfs_url).toBe('./document.txt');
    });

    it('should check hasIPLDLinks correctly for ipfs_url fields', () => {
      const dataWithIpfsUrl = {
        name: 'Test',
        ipfs_url: './image.png'
      };

      const hasLinks = ipldConverterService.hasIPLDLinks(dataWithIpfsUrl);
      expect(hasLinks).toBe(true);
    });

    it('should not detect links when ipfs_url already has IPFS URI', () => {
      const dataWithIpfsUri = {
        name: 'Test',
        ipfs_url: 'ipfs://bafkreiexisting'
      };

      const hasLinks = ipldConverterService.hasIPLDLinks(dataWithIpfsUri);
      expect(hasLinks).toBe(false);
    });
  });

  describe('IPLD file references (not converted)', () => {
    it('should not convert IPLD file references', async () => {
      const dataWithIpldRef = {
        reference: { '/': './referenced.json' }
      };

      const result = await ipldConverterService.convertToIPLD(dataWithIpldRef);

      expect(result.hasLinks).toBe(false);
      expect(result.convertedData.reference).toEqual({ '/': './referenced.json' });
    });
  });
});