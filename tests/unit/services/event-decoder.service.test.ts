import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import {
  BytesLike,
  Result,
  InterfaceAbi,
  Log,
  LogParams,
  JsonRpcProvider,
} from 'ethers';

// Define mock implementations for ethers utilities
const mockDecodeImplementation = jest.fn();
const mockDataSliceImplementation =
  jest.fn<(data: BytesLike, offset: number, endOffset?: number) => string>();

// Mock for ethers.Interface constructor and its methods
const mockInterfaceGetEventImplementation = jest.fn();
const mockInterfaceInstance = {
  getEvent: mockInterfaceGetEventImplementation,
  // Add other Interface methods if EventDecoderService uses them
};

// Use var so it gets hoisted and can be used in the mock
var MockInterfaceConstructor = jest.fn(
  (abi: InterfaceAbi) => mockInterfaceInstance
);

jest.mock('ethers', () => ({
  __esModule: true,
  AbiCoder: {
    defaultAbiCoder: () => ({
      decode: (...args: [ReadonlyArray<any>, BytesLike]) =>
        mockDecodeImplementation(...args),
    }),
  },
  dataSlice: (...args: [BytesLike, number, (number | undefined)?]) =>
    mockDataSliceImplementation(...args),
  getAddress: (address: string) => address, // Simple mock that returns the input
  Interface: MockInterfaceConstructor,
  JsonRpcProvider: jest.fn().mockImplementation(() => ({})),
  Log: jest.fn().mockImplementation((params: any, provider: any) => ({
    ...params,
    toJSON: () => params, // Add toJSON method for tests
  })),
}));

// Import SUT after mocks
import { EventDecoderService } from '../../../src/services/event-decoder.service';
import { ABI } from '../../../src/types'; // ABI type is used

describe('EventDecoderService', () => {
  let eventDecoderService: EventDecoderService;
  const mockContractInterfaceAbi: ABI = [
    {
      type: 'event',
      name: 'ElephantAssigned',
      inputs: [
        { name: 'propertyCid', type: 'bytes', indexed: false },
        { name: 'elephant', type: 'address', indexed: true },
      ],
    },
  ];

  beforeEach(() => {
    mockDecodeImplementation.mockClear();
    mockDataSliceImplementation.mockClear();
    MockInterfaceConstructor.mockClear();
    mockInterfaceGetEventImplementation.mockClear();

    // Set up default mock return values
    mockDecodeImplementation.mockReturnValue(['.QmWUnTmuodSYEuHVPgxtrARGra2VpzsusAp4FqT9FWobuU']);
    mockDataSliceImplementation.mockReturnValue(
      '0x0e44bfab0f7e1943cF47942221929F898E181505'
    );

    // Provide a default mock for getEvent to return something sensible
    mockInterfaceGetEventImplementation.mockReturnValue({
      name: 'ElephantAssigned',
      // Mock other properties of EventFragment if needed by the SUT's logic
      // For example, if it checks `eventFragment.inputs`
      inputs: [
        { name: 'propertyCid', type: 'bytes', indexed: false },
        { name: 'elephant', type: 'address', indexed: true },
      ],
    });

    eventDecoderService = new EventDecoderService();
  });

  describe('constructor', () => {
    it('should initialize AbiCoder properly', () => {
      expect(eventDecoderService).toBeInstanceOf(EventDecoderService);
      // The constructor initializes AbiCoder internally
      expect(eventDecoderService['abiCoder']).toBeDefined();
    });
  });

  describe('parseElephantAssignedEvent', () => {
    const mockRawEvent = new Log(
      {
        address: '0x1234567890123456789012345678901234567890',
        blockHash: '0xBlockHash123',
        data: '0xSomeData',
        topics: [
          '0xTopic0Sig_ElephantAssigned',
          '0x0000000000000000000000001234567890123456789012345678901234567890',
        ],
        blockNumber: 12345,
        transactionHash: '0xTxHash123',
        index: 0,
        transactionIndex: 0,
        removed: false,
      } as LogParams,
      new JsonRpcProvider('http://localhost:8545')
    );
    const mockElephantAddressFromTopic =
      '0x1234567890123456789012345678901234567890';

    it('should correctly parse a valid ElephantAssigned event', () => {
      const decodedCidString =
        '.QmWUnTmuodSYEuHVPgxtrARGra2VpzsusAp4FqT9FWobuU';
      const expectedCid = 'QmWUnTmuodSYEuHVPgxtrARGra2VpzsusAp4FqT9FWobuU';

      mockDecodeImplementation.mockReturnValueOnce([
        decodedCidString,
      ] as Result);

      const parsedEvent =
        eventDecoderService.parseElephantAssignedEvent(mockRawEvent);

      expect(mockDecodeImplementation).toHaveBeenCalledWith(
        ['string'],
        mockRawEvent.data
      );
      expect(parsedEvent).toEqual({
        cid: expectedCid,
        elephant: '0x0e44bfab0f7e1943cF47942221929F898E181505', // Address from the mock
        blockNumber: mockRawEvent.blockNumber,
        transactionHash: mockRawEvent.transactionHash,
      });
    });

    it('should handle CID without leading dot', () => {
      const decodedCidString = 'QmWUnTmuodSYEuHVPgxtrARGra2VpzsusAp4FqT9FWobuU';
      mockDecodeImplementation.mockReturnValueOnce([
        decodedCidString,
      ] as unknown as Result);

      const parsedEvent =
        eventDecoderService.parseElephantAssignedEvent(mockRawEvent);
      expect(parsedEvent.cid).toBe(decodedCidString);
    });

    it('should throw an error if event data is invalid for decoding', () => {
      mockDecodeImplementation.mockImplementationOnce(() => {
        throw new Error('Decoding failed');
      });
      expect(() =>
        eventDecoderService.parseElephantAssignedEvent(mockRawEvent)
      ).toThrow('Decoding failed');
    });

    it('should handle missing topics gracefully', () => {
      const logParams: LogParams = mockRawEvent.toJSON() as LogParams;
      logParams.topics = [];
      const incompleteRawEvent = new Log(logParams, mockRawEvent.provider);
      
      const result = eventDecoderService.parseElephantAssignedEvent(incompleteRawEvent);
      
      // Service returns empty elephant address when topics are missing
      expect(result.elephant).toBe('');
      expect(result.cid).toBe('QmWUnTmuodSYEuHVPgxtrARGra2VpzsusAp4FqT9FWobuU');
    });

    it('should process events regardless of interface availability', () => {
      mockInterfaceGetEventImplementation.mockReturnValue(null);
      
      const result = eventDecoderService.parseElephantAssignedEvent(mockRawEvent);
      
      // Service processes the event data directly, doesn't rely on interface
      expect(result.cid).toBe('QmWUnTmuodSYEuHVPgxtrARGra2VpzsusAp4FqT9FWobuU');
    });
  });
});
