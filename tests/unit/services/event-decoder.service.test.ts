import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { EventDecoderService } from '../../../src/services/event-decoder.service';

// Create mock decode function
const mockDecode = jest.fn();

// Create mock AbiCoder instance
const mockAbiCoderInstance = {
  decode: mockDecode
};

// Mock ethers
jest.mock('ethers', () => {
  return {
    AbiCoder: {
      defaultAbiCoder: jest.fn(() => mockAbiCoderInstance)
    },
    getAddress: jest.fn((address: string) => address),
    dataSlice: jest.fn((data: string, offset: number) => {
      // Simulate dataSlice behavior - remove 0x prefix and slice
      const cleanData = data.startsWith('0x') ? data.slice(2) : data;
      return '0x' + cleanData.slice(offset * 2);
    })
  };
});

// Import ethers to access mocked functions
import { ethers } from 'ethers';

describe('EventDecoderService', () => {
  let eventDecoderService: EventDecoderService;

  beforeEach(() => {
    jest.clearAllMocks();
    
    eventDecoderService = new EventDecoderService();
  });

  describe('decodePropertyCid', () => {
    it('should decode CID with leading dot correctly', () => {
      const encodedData = '0x0000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000002e2e516d575554576d756f6453594575485650677874724152477261325670737375734170344671543946576f627555000000000000000000000000000000';
      const cidWithDot = '.QmWUnTmuodSYEuHVPgxtrARGra2VpzsusAp4FqT9FWobuU';
      const expectedCid = 'QmWUnTmuodSYEuHVPgxtrARGra2VpzsusAp4FqT9FWobuU';

      mockDecode.mockReturnValue([cidWithDot]);

      const result = eventDecoderService.decodePropertyCid(encodedData);

      expect(mockDecode).toHaveBeenCalledWith(['string'], encodedData);
      expect(result).toBe(expectedCid);
    });

    it('should decode CID without leading dot correctly', () => {
      const encodedData = '0xencoded';
      const cidWithoutDot = 'QmXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';

      mockDecode.mockReturnValue([cidWithoutDot]);

      const result = eventDecoderService.decodePropertyCid(encodedData);

      expect(result).toBe(cidWithoutDot);
    });

    it('should handle CIDv1 format starting with ba', () => {
      const encodedData = '0xencoded';
      const cidV1 = 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi';

      mockDecode.mockReturnValue([cidV1]);

      const result = eventDecoderService.decodePropertyCid(encodedData);

      expect(result).toBe(cidV1);
    });

    it('should throw error for invalid CID format', () => {
      const encodedData = '0xencoded';
      const invalidCid = 'InvalidCID123';

      mockDecode.mockReturnValue([invalidCid]);

      expect(() => {
        eventDecoderService.decodePropertyCid(encodedData);
      }).toThrow('Invalid CID format: InvalidCID123');
    });

    it('should throw error when decode fails', () => {
      const encodedData = '0xencoded';
      mockDecode.mockImplementation(() => {
        throw new Error('Decode error');
      });

      expect(() => {
        eventDecoderService.decodePropertyCid(encodedData);
      }).toThrow('Decode error');
    });
  });

  describe('parseElephantAssignedEvent', () => {
    const mockEvent = {
      data: '0x0000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000002e2e516d575554576d756f6453594575485650677874724152477261325670737375734170344671543946576f627555000000000000000000000000000000',
      topics: [
        '0xeventtopic',
        '0x0000000000000000000000000e44bfab0f7e1943cf47942221929f898e181505'
      ],
      blockNumber: 71875870,
      transactionHash: '0xtxhash123',
    } as any;

    beforeEach(() => {
      mockDecode.mockReturnValue(['.QmWUnTmuodSYEuHVPgxtrARGra2VpzsusAp4FqT9FWobuU']);
    });

    it('should parse event with indexed elephant address', () => {
      const result = eventDecoderService.parseElephantAssignedEvent(mockEvent);

      expect(result).toEqual({
        cid: 'QmWUnTmuodSYEuHVPgxtrARGra2VpzsusAp4FqT9FWobuU',
        elephant: '0x0e44bfab0f7e1943cf47942221929f898e181505',
        blockNumber: 71875870,
        transactionHash: '0xtxhash123',
      });

      expect(ethers.dataSlice).toHaveBeenCalledWith(mockEvent.topics[1], 12);
      expect(ethers.getAddress).toHaveBeenCalled();
    });

    it('should handle event without indexed elephant address', () => {
      const eventWithoutIndexed = {
        ...mockEvent,
        topics: ['0xeventtopic'],
      };

      const result = eventDecoderService.parseElephantAssignedEvent(eventWithoutIndexed);

      expect(result).toEqual({
        cid: 'QmWUnTmuodSYEuHVPgxtrARGra2VpzsusAp4FqT9FWobuU',
        elephant: '',
        blockNumber: 71875870,
        transactionHash: '0xtxhash123',
      });
    });

    it('should throw error for invalid CID in event', () => {
      mockDecode.mockReturnValue(['InvalidCID']);

      expect(() => {
        eventDecoderService.parseElephantAssignedEvent(mockEvent);
      }).toThrow('Invalid CID format: InvalidCID');
    });

    it('should handle events with different CID formats', () => {
      // Test with CIDv1
      mockDecode.mockReturnValue(['bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi']);

      const result = eventDecoderService.parseElephantAssignedEvent(mockEvent);

      expect(result.cid).toBe('bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi');
    });

    it('should handle malformed event data gracefully', () => {
      const malformedEvent = {
        ...mockEvent,
        data: '0xinvalid',
      };

      mockDecode.mockImplementation(() => {
        throw new Error('Invalid data');
      });

      expect(() => {
        eventDecoderService.parseElephantAssignedEvent(malformedEvent);
      }).toThrow('Invalid data');
    });
  });
});