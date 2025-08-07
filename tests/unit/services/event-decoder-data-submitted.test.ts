import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventDecoderService } from '../../../src/services/event-decoder.service.js';

// Mock logger to avoid console output during tests
vi.mock('../../../src/utils/logger.js', () => ({
  logger: {
    error: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

describe('EventDecoderService - parseDataSubmittedEvent', () => {
  let eventDecoder: EventDecoderService;

  beforeEach(() => {
    eventDecoder = new EventDecoderService();
  });

  it('should parse a valid DataSubmitted event', () => {
    const mockEvent = {
      blockNumber: 12345,
      blockHash: '0xblockhash',
      transactionIndex: 0,
      removed: false,
      address: '0xcontractaddress',
      data: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef', // dataHash
      topics: [
        '0xeventSignature', // Event signature
        '0xabc1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab', // propertyHash
        '0xdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890cd', // dataGroupHash
        '0x0000000000000000000000001234567890123456789012345678901234567890', // submitter address (padded)
      ],
      transactionHash: '0xtxhash',
      index: 0,
    } as any; // Cast to any to avoid type issues in tests

    const result = eventDecoder.parseDataSubmittedEvent(mockEvent);

    expect(result).toBeDefined();
    expect(result).toEqual({
      propertyHash:
        '0xabc1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab',
      dataGroupHash:
        '0xdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890cd',
      submitter: '0x1234567890123456789012345678901234567890',
      dataHash:
        '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      blockNumber: 12345,
      transactionHash: '0xtxhash',
    });
  });

  it('should return null for event with wrong number of topics', () => {
    const mockEvent = {
      blockNumber: 12345,
      blockHash: '0xblockhash',
      transactionIndex: 0,
      removed: false,
      address: '0xcontractaddress',
      data: '0x1234567890abcdef',
      topics: ['0xeventSignature', '0xpropertyHash'], // Only 2 topics instead of 4
      transactionHash: '0xtxhash',
      index: 0,
    } as any;

    const result = eventDecoder.parseDataSubmittedEvent(mockEvent);
    expect(result).toBeNull();
  });

  it('should return null for event with invalid data', () => {
    const mockEvent = {
      blockNumber: 12345,
      blockHash: '0xblockhash',
      transactionIndex: 0,
      removed: false,
      address: '0xcontractaddress',
      data: '0xinvalid', // Invalid data that can't be decoded
      topics: [
        '0xeventSignature',
        '0xpropertyHash',
        '0xdataGroupHash',
        '0xsubmitter',
      ],
      transactionHash: '0xtxhash',
      index: 0,
    } as any;

    const result = eventDecoder.parseDataSubmittedEvent(mockEvent);
    expect(result).toBeNull();
  });

  it('should handle address extraction correctly', () => {
    const mockEvent = {
      blockNumber: 12345,
      blockHash: '0xblockhash',
      transactionIndex: 0,
      removed: false,
      address: '0xcontractaddress',
      data: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      topics: [
        '0xeventSignature',
        '0xpropertyHash',
        '0xdataGroupHash',
        '0x000000000000000000000000AbCdEf1234567890123456789012345678901234', // Mixed case address
      ],
      transactionHash: '0xtxhash',
      index: 0,
    } as any;

    const result = eventDecoder.parseDataSubmittedEvent(mockEvent);

    expect(result).toBeDefined();
    expect(result?.submitter).toBe(
      '0xabcdef1234567890123456789012345678901234'
    ); // Should be lowercase
  });
});
