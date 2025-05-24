import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { BytesLike, Result, InterfaceAbi } from 'ethers';

// Define mock implementations for ethers utilities
const mockDecodeImplementation =
  jest.fn<(types: ReadonlyArray<any>, data: BytesLike) => Result>();
const mockDataSliceImplementation =
  jest.fn<(data: BytesLike, offset: number, endOffset?: number) => string>();

// Mock for ethers.Interface constructor and its methods
const mockInterfaceGetEventImplementation = jest.fn();
const mockInterfaceInstance = {
  getEvent: mockInterfaceGetEventImplementation,
  // Add other Interface methods if EventDecoderService uses them
};
const MockInterfaceConstructor = jest.fn(
  (abi: InterfaceAbi) => mockInterfaceInstance
);

jest.mock('ethers', () => ({
  __esModule: true,
  AbiCoder: {
    defaultAbiCoder: {
      decode: (...args: [ReadonlyArray<any>, BytesLike]) =>
        mockDecodeImplementation(...args),
    },
  },
  dataSlice: (...args: [BytesLike, number, (number | undefined)?]) =>
    mockDataSliceImplementation(...args),
  Interface: MockInterfaceConstructor, // Mock the Interface class
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
    it('should initialize Interface with the provided ABI', () => {
      expect(MockInterfaceConstructor).toHaveBeenCalledWith(
        mockContractInterfaceAbi
      );
      expect(eventDecoderService).toBeInstanceOf(EventDecoderService);
    });
  });

  describe('parseElephantAssignedEvent', () => {
    const mockRawEvent = {
      data: '0xSomeData',
      topics: [
        '0xTopic0Sig_ElephantAssigned',
        '0x0000000000000000000000001234567890123456789012345678901234567890',
      ], // Padded address
      blockNumber: 12345,
      transactionHash: '0xTxHash123',
    };
    const mockElephantAddressFromTopic =
      '0x1234567890123456789012345678901234567890';

    it('should correctly parse a valid ElephantAssigned event', () => {
      const decodedCidString =
        '.QmWUnTmuodSYEuHVPgxtrARGra2VpzsusAp4FqT9FWobuU';
      const expectedCid = 'QmWUnTmuodSYEuHVPgxtrARGra2VpzsusAp4FqT9FWobuU';

      mockDecodeImplementation.mockReturnValueOnce([
        decodedCidString,
      ] as unknown as Result);

      // Ensure getEvent is configured for the 'ElephantAssigned' event if logic relies on it by name
      // (already done in beforeEach with a default, but can be more specific)
      // mockInterfaceGetEventImplementation.mockImplementation((nameOrSignature: string) => {
      //   if (nameOrSignature === 'ElephantAssigned') {
      //     return { name: 'ElephantAssigned', inputs: [/*...inputs as above...*/] };
      //   }
      //   return null;
      // });

      const parsedEvent =
        eventDecoderService.parseElephantAssignedEvent(mockRawEvent);

      expect(mockDecodeImplementation).toHaveBeenCalledWith(
        ['bytes'],
        mockRawEvent.data
      );
      expect(parsedEvent).toEqual({
        cid: expectedCid,
        elephant: mockElephantAddressFromTopic, // Address should be unpadded from topic
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

    it('should throw an error if event topics are missing for indexed parameters', () => {
      const incompleteRawEvent = {
        ...mockRawEvent,
        topics: ['0xTopic0Sig_ElephantAssigned'],
      };
      expect(() =>
        eventDecoderService.parseElephantAssignedEvent(incompleteRawEvent)
      ).toThrow(
        'Invalid event structure: Missing topic for indexed parameter elephant'
      );
    });

    it('should throw an error if the event fragment is not found', () => {
      mockInterfaceGetEventImplementation.mockReturnValue(null); // Simulate event not found in ABI
      expect(() =>
        eventDecoderService.parseElephantAssignedEvent(mockRawEvent)
      ).toThrow(
        "Event 'ElephantAssigned' not found in ABI or ABI is malformed."
      );
    });
  });
});

