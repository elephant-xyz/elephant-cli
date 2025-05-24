import { describe, it, expect, jest, beforeEach } from '@jest/globals';

// --- Mock dependencies FIRST ---

// 1. Mock EventDecoderService
// This mock will be used when BlockchainService instantiates EventDecoderService
const mockParseElephantAssignedEvent = jest.fn();
jest.mock('../../../src/services/event-decoder.service', () => {
  return {
    EventDecoderService: jest.fn().mockImplementation(() => {
      return {
        parseElephantAssignedEvent: mockParseElephantAssignedEvent,
      };
    }),
  };
});

// 2. Mock ethers (used directly by BlockchainService for JsonRpcProvider and Contract)
const mockJsonRpcProviderInstance = {
  getBlockNumber: jest.fn<() => Promise<number>>(),
};
const mockContractInstance = {
  filters: {
    ElephantAssigned: jest.fn<(...args: any[]) => object>(),
  },
  queryFilter: jest.fn<(...args: any[]) => Promise<any[]>>(),
  getAddress: jest.fn<() => Promise<string>>(), // Added to satisfy Contract type if needed
  resolveName: jest.fn<() => Promise<string | null>>(), // Added
  runner: mockJsonRpcProviderInstance, // Added
  interface: {
    // Added basic interface mock
    getEvent: jest.fn(() => ({
      topicHash: 'mockTopicHashForElephantAssigned',
    })),
  },
};

// Define mockDefaultAbiCoder here if it's part of the ethers mock needed by other parts
// For this test, it's primarily EventDecoderService that uses it, which is fully mocked.
// However, if any other part of 'ethers' mock relies on it, define it.
// const mockDefaultAbiCoder = { decode: jest.fn() };

jest.mock('ethers', () => ({
  __esModule: true,
  JsonRpcProvider: jest
    .fn()
    .mockImplementation(() => mockJsonRpcProviderInstance),
  Contract: jest.fn().mockImplementation(() => mockContractInstance),
  // Interface and AbiCoder are not directly used by BlockchainService,
  // but by EventDecoderService, which is now fully mocked above.
  // So, we might not need to mock Interface and AbiCoder here anymore
  // unless BlockchainService starts using them directly.
  // For safety, keeping minimal mocks if other parts of 'ethers' are accessed.
  Interface: jest.fn().mockImplementation(() => ({
    getEvent: jest.fn(() => ({ name: 'SomeEvent', inputs: [] })),
  })),
  AbiCoder: {
    defaultAbiCoder: { decode: jest.fn() }, // Minimal mock for AbiCoder
  },
  EventLog: class MockEventLog {}, // if EventLog is used
}));

// --- Import SUT (BlockchainService) AFTER mocks ---
import { BlockchainService } from '../../../src/services/blockchain.service';
import { ABI, RawEventData, ElephantAssignment } from '../../../src/types'; // Assuming types are needed
// EventDecoderService is imported by BlockchainService, so the mocked version will be used.

describe('BlockchainService', () => {
  const mockRpcUrl = 'http://localhost:8545';
  const mockContractAddress = '0x1234567890123456789012345678901234567890';
  const mockAbi: ABI = [
    { type: 'event', name: 'ElephantAssigned', inputs: [] },
  ]; // Minimal ABI

  let blockchainService: BlockchainService;

  beforeEach(() => {
    jest.clearAllMocks(); // Clear all mocks including those for constructors

    // Reset mock implementations for each test
    mockJsonRpcProviderInstance.getBlockNumber.mockResolvedValue(100);
    (
      mockContractInstance.filters.ElephantAssigned as jest.Mock
    ).mockReturnValue({});
    mockContractInstance.queryFilter.mockResolvedValue([]);
    mockParseElephantAssignedEvent.mockImplementation((rawEvent: any) => ({
      cid: `parsed-cid-${rawEvent.transactionHash}`,
      elephant: `parsed-elephant-${rawEvent.transactionHash}`,
      blockNumber: rawEvent.blockNumber,
      transactionHash: rawEvent.transactionHash,
    }));

    // Instantiate BlockchainService, which will use the mocked EventDecoderService
    blockchainService = new BlockchainService(
      mockRpcUrl,
      mockContractAddress,
      mockAbi
    );
  });

  it('should initialize JsonRpcProvider and Contract correctly', () => {
    expect(jest.requireMock('ethers').JsonRpcProvider).toHaveBeenCalledWith(
      mockRpcUrl
    );
    expect(jest.requireMock('ethers').Contract).toHaveBeenCalledWith(
      mockContractAddress,
      mockAbi,
      mockJsonRpcProviderInstance
    );
    // Verify EventDecoderService mock constructor was called
    expect(
      jest.requireMock('../../../src/services/event-decoder.service')
        .EventDecoderService
    ).toHaveBeenCalledWith(mockAbi);
  });

  it('should get the current block number', async () => {
    const blockNumber = await blockchainService.getCurrentBlock();
    expect(mockJsonRpcProviderInstance.getBlockNumber).toHaveBeenCalled();
    expect(blockNumber).toBe(100);
  });

  describe('getElephantAssignedEvents', () => {
    const elephantAddress = '0xElephantAddress';
    const fromBlock = 0;
    const toBlock = 100;

    const mockRawEvents: Partial<RawEventData>[] = [
      {
        data: '0xdata1',
        topics: ['topic0_sig', 'topic1_elephant'],
        blockNumber: 10,
        transactionHash: '0xhash1',
      },
      {
        data: '0xdata2',
        topics: ['topic0_sig', 'topic1_elephant'],
        blockNumber: 20,
        transactionHash: '0xhash2',
      },
    ];

    it('should fetch, parse, and return ElephantAssigned events', async () => {
      (
        mockContractInstance.filters.ElephantAssigned as jest.Mock
      ).mockReturnValue('eventFilterObject');
      mockContractInstance.queryFilter.mockResolvedValue(mockRawEvents as any); // Cast as any if type is complex

      const events = await blockchainService.getElephantAssignedEvents(
        elephantAddress,
        fromBlock,
        toBlock
      );

      expect(
        mockContractInstance.filters.ElephantAssigned
      ).toHaveBeenCalledWith(null, elephantAddress);
      expect(mockContractInstance.queryFilter).toHaveBeenCalledWith(
        'eventFilterObject',
        fromBlock,
        toBlock
      );
      expect(mockParseElephantAssignedEvent).toHaveBeenCalledTimes(
        mockRawEvents.length
      );

      expect(events).toHaveLength(mockRawEvents.length);
      expect(events[0]).toEqual(
        expect.objectContaining({
          cid: `parsed-cid-0xhash1`,
          elephant: `parsed-elephant-0xhash1`,
          blockNumber: 10,
          transactionHash: '0xhash1',
        })
      );
      expect(events[1]).toEqual(
        expect.objectContaining({
          cid: `parsed-cid-0xhash2`,
          elephant: `parsed-elephant-0xhash2`,
          blockNumber: 20,
          transactionHash: '0xhash2',
        })
      );
    });

    it('should handle parsing errors and filter out null results', async () => {
      mockContractInstance.queryFilter.mockResolvedValue(mockRawEvents as any);
      mockParseElephantAssignedEvent
        .mockImplementationOnce(
          (rawEvent: any) =>
            ({
              cid: `parsed-cid-${rawEvent.transactionHash}`,
              elephant: `parsed-elephant-${rawEvent.transactionHash}`,
              blockNumber: rawEvent.blockNumber,
              transactionHash: rawEvent.transactionHash,
            }) as ElephantAssignment
        )
        .mockImplementationOnce(() => {
          throw new Error('Parsing failed');
        }); // Second event fails

      const events = await blockchainService.getElephantAssignedEvents(
        elephantAddress,
        fromBlock,
        toBlock
      );
      expect(events).toHaveLength(1);
      expect(events[0].transactionHash).toBe('0xhash1');
      // console.error would have been called for the parsing error, can assert if logger is spied on
    });

    it('should return an empty array if no events are found', async () => {
      mockContractInstance.queryFilter.mockResolvedValue([]);
      const events = await blockchainService.getElephantAssignedEvents(
        elephantAddress,
        fromBlock,
        toBlock
      );
      expect(events).toEqual([]);
      expect(mockParseElephantAssignedEvent).not.toHaveBeenCalled();
    });
  });
});
