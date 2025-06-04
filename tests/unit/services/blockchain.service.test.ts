import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mock dependencies FIRST ---

// 1. Mock EventDecoderService
// This mock will be used when BlockchainService instantiates EventDecoderService
const mockParseOracleAssignedEvent = vi.fn();
vi.mock('../../../src/services/event-decoder.service', () => {
  return {
    EventDecoderService: vi.fn().mockImplementation(() => {
      return {
        parseOracleAssignedEvent: mockParseOracleAssignedEvent,
      };
    }),
  };
});

// 2. Mock ethers (used directly by BlockchainService for JsonRpcProvider and Contract)

// Define simplified interfaces for mocks
interface MockProvider {
  getBlockNumber: ReturnType<typeof vi.fn<[], Promise<number>>>;
  // Add other provider methods if needed by the service and not part of runner
}

interface MockContract {
  filters: {
    OracleAssigned: ReturnType<typeof vi.fn<any[], object>>;
    // Add other filter types if used
  };
  queryFilter: ReturnType<typeof vi.fn<any[], Promise<any[]>>>;
  getAddress: ReturnType<typeof vi.fn<[], Promise<string>>>;
  resolveName: ReturnType<typeof vi.fn<[], Promise<string | null>>>;
  runner: MockProvider | null; // Runner can be a provider or null
  interface: any; // Simplified for now
  // Add other contract methods if needed
}

const mockJsonRpcProviderInstance: MockProvider = {
  getBlockNumber: vi.fn((): Promise<number> => Promise.resolve(100)), // Default for tests
};

const mockContractInstance: MockContract = {
  filters: {
    OracleAssigned: vi.fn((..._args: any[]): object => ({})),
  },
  queryFilter: vi.fn((..._args: any[]): Promise<any[]> => Promise.resolve([])),
  getAddress: vi.fn(
    (): Promise<string> => Promise.resolve('mockContractAddress')
  ),
  resolveName: vi.fn((): Promise<string | null> => Promise.resolve(null)),
  runner: mockJsonRpcProviderInstance, // Link runner to the provider instance
  interface: {
    getEvent: vi.fn(() => ({
      topicHash: 'mockTopicHashForOracleAssigned',
    })),
  },
};

// Define mockDefaultAbiCoder here if it's part of the ethers mock needed by other parts
// For this test, it's primarily EventDecoderService that uses it, which is fully mocked.
// However, if any other part of 'ethers' mock relies on it, define it.
// const mockDefaultAbiCoder = { decode: vi.fn() };

vi.mock('ethers', () => ({
  __esModule: true,
  JsonRpcProvider: vi
    .fn()
    .mockImplementation(() => mockJsonRpcProviderInstance),
  Contract: vi.fn().mockImplementation(() => mockContractInstance),
  // Interface and AbiCoder are not directly used by BlockchainService,
  // but by EventDecoderService, which is now fully mocked above.
  // So, we might not need to mock Interface and AbiCoder here anymore
  // unless BlockchainService starts using them directly.
  // For safety, keeping minimal mocks if other parts of 'ethers' are accessed.
  Interface: vi.fn().mockImplementation(() => ({
    getEvent: vi.fn(() => ({ name: 'SomeEvent', inputs: [] })),
  })),
  AbiCoder: {
    defaultAbiCoder: { decode: vi.fn() }, // Minimal mock for AbiCoder
  },
  EventLog: class MockEventLog {}, // if EventLog is used
}));

// --- Import SUT (BlockchainService) AFTER mocks ---
import { BlockchainService } from '../../../src/services/blockchain.service';
import { ABI, OracleAssignment } from '../../../src/types'; // Assuming types are needed
import { EventLog } from 'ethers';
// EventDecoderService is imported by BlockchainService, so the mocked version will be used.

describe('BlockchainService', () => {
  const mockRpcUrl = 'http://localhost:8545';
  const mockContractAddress = '0x1234567890123456789012345678901234567890';
  const mockAbi: ABI = [{ type: 'event', name: 'OracleAssigned', inputs: [] }]; // Minimal ABI

  let blockchainService: BlockchainService;

  beforeEach(() => {
    vi.clearAllMocks(); // Clear all mocks including those for constructors

    // Reset mock implementations for each test
    mockJsonRpcProviderInstance.getBlockNumber.mockResolvedValue(100);
    (mockContractInstance.filters.OracleAssigned as any).mockReturnValue({});
    mockContractInstance.queryFilter.mockResolvedValue([]);
    mockParseOracleAssignedEvent.mockImplementation((rawEvent: any) => ({
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

  it('should get the current block number', async () => {
    const blockNumber = await blockchainService.getCurrentBlock();
    expect(mockJsonRpcProviderInstance.getBlockNumber).toHaveBeenCalled();
    expect(blockNumber).toBe(100);
  });

  describe('getOracleAssignedEvents', () => {
    const elephantAddress = '0xElephantAddress';
    const fromBlock = 0;
    const toBlock = 100;

    const mockRawEvents: Partial<EventLog>[] = [
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

    it('should fetch, parse, and return OracleAssigned events', async () => {
      (mockContractInstance.filters.OracleAssigned as any).mockReturnValue(
        'eventFilterObject'
      );
      mockContractInstance.queryFilter.mockResolvedValue(mockRawEvents as any); // Cast as any if type is complex

      const events = await blockchainService.getOracleAssignedEvents(
        elephantAddress,
        fromBlock,
        toBlock
      );

      expect(mockContractInstance.filters.OracleAssigned).toHaveBeenCalledWith(
        null,
        elephantAddress
      );
      expect(mockContractInstance.queryFilter).toHaveBeenCalledWith(
        'eventFilterObject',
        fromBlock,
        toBlock
      );
      expect(mockParseOracleAssignedEvent).toHaveBeenCalledTimes(
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
      mockParseOracleAssignedEvent
        .mockImplementationOnce(
          (rawEvent: any) =>
            ({
              cid: `parsed-cid-${rawEvent.transactionHash}`,
              elephant: `parsed-elephant-${rawEvent.transactionHash}`,
              blockNumber: rawEvent.blockNumber,
              transactionHash: rawEvent.transactionHash,
            }) as OracleAssignment
        )
        .mockImplementationOnce(() => {
          throw new Error('Parsing failed');
        }); // Second event fails

      const events = await blockchainService.getOracleAssignedEvents(
        elephantAddress,
        fromBlock,
        toBlock
      );
      expect(events).toHaveLength(1);
      expect(events[0].transactionHash).toBe('0xhash1');
    });

    it('should return an empty array if no events are found', async () => {
      mockContractInstance.queryFilter.mockResolvedValue([]);
      const events = await blockchainService.getOracleAssignedEvents(
        elephantAddress,
        fromBlock,
        toBlock
      );
      expect(events).toEqual([]);
      expect(mockParseOracleAssignedEvent).not.toHaveBeenCalled();
    });

    // New tests for pagination
    it('should fetch events in a single chunk if range is within MAX_BLOCK_RANGE', async () => {
      const smallToBlock = fromBlock + 500; // Well within MAX_BLOCK_RANGE
      (mockContractInstance.filters.OracleAssigned as any).mockReturnValue(
        'eventFilterObject'
      );
      mockContractInstance.queryFilter.mockResolvedValue(mockRawEvents as any);

      await blockchainService.getOracleAssignedEvents(
        elephantAddress,
        fromBlock,
        smallToBlock
      );

      expect(mockContractInstance.queryFilter).toHaveBeenCalledTimes(1);
      expect(mockContractInstance.queryFilter).toHaveBeenCalledWith(
        'eventFilterObject',
        fromBlock,
        smallToBlock
      );
      expect(mockParseOracleAssignedEvent).toHaveBeenCalledTimes(
        mockRawEvents.length
      );
    });

    it('should fetch events in multiple chunks if range exceeds MAX_BLOCK_RANGE', async () => {
      const MAX_BLOCK_RANGE = 2000; // Same as in BlockchainService
      const largeFromBlock = 0;
      const largeToBlock = largeFromBlock + MAX_BLOCK_RANGE * 2.5; // e.g., 0 to 4999 for MAX_BLOCK_RANGE = 2000 (should be 3 chunks)

      const mockEventsChunk1: Partial<EventLog>[] = [
        { transactionHash: 'txHashChunk1' } as any,
      ];
      const mockEventsChunk2: Partial<EventLog>[] = [
        { transactionHash: 'txHashChunk2' } as any,
      ];
      const mockEventsChunk3: Partial<EventLog>[] = [
        { transactionHash: 'txHashChunk3' } as any,
      ];

      (mockContractInstance.filters.OracleAssigned as any).mockReturnValue(
        'eventFilterObject'
      );
      mockContractInstance.queryFilter
        .mockResolvedValueOnce(mockEventsChunk1 as any)
        .mockResolvedValueOnce(mockEventsChunk2 as any)
        .mockResolvedValueOnce(mockEventsChunk3 as any);

      mockParseOracleAssignedEvent.mockImplementation((rawEvent: any) => ({
        cid: `parsed-${rawEvent.transactionHash}`,
        elephant: elephantAddress,
        blockNumber: rawEvent.blockNumber || 0, // Ensure blockNumber is present
        transactionHash: rawEvent.transactionHash,
      }));

      const events = await blockchainService.getOracleAssignedEvents(
        elephantAddress,
        largeFromBlock,
        largeToBlock
      );

      expect(mockContractInstance.queryFilter).toHaveBeenCalledTimes(3);
      // Chunk 1
      expect(mockContractInstance.queryFilter).toHaveBeenNthCalledWith(
        1,
        'eventFilterObject',
        largeFromBlock,
        largeFromBlock + MAX_BLOCK_RANGE - 1
      );
      // Chunk 2
      expect(mockContractInstance.queryFilter).toHaveBeenNthCalledWith(
        2,
        'eventFilterObject',
        largeFromBlock + MAX_BLOCK_RANGE,
        largeFromBlock + MAX_BLOCK_RANGE * 2 - 1
      );
      // Chunk 3
      expect(mockContractInstance.queryFilter).toHaveBeenNthCalledWith(
        3,
        'eventFilterObject',
        largeFromBlock + MAX_BLOCK_RANGE * 2,
        largeToBlock
      );

      expect(mockParseOracleAssignedEvent).toHaveBeenCalledTimes(
        mockEventsChunk1.length +
          mockEventsChunk2.length +
          mockEventsChunk3.length
      );
      expect(events).toHaveLength(3);
      expect(events[0].cid).toBe('parsed-txHashChunk1');
      expect(events[1].cid).toBe('parsed-txHashChunk2');
      expect(events[2].cid).toBe('parsed-txHashChunk3');
    });

    it('should use current block number if toBlock is not provided', async () => {
      const currentBlock = 5000;
      mockJsonRpcProviderInstance.getBlockNumber.mockResolvedValue(
        currentBlock
      );
      (mockContractInstance.filters.OracleAssigned as any).mockReturnValue(
        'eventFilterObject'
      );
      mockContractInstance.queryFilter.mockResolvedValue([]); // No events for simplicity

      await blockchainService.getOracleAssignedEvents(
        elephantAddress,
        fromBlock
      );

      expect(mockJsonRpcProviderInstance.getBlockNumber).toHaveBeenCalled();
      expect(mockContractInstance.queryFilter).toHaveBeenCalledWith(
        'eventFilterObject',
        fromBlock,
        // This will be chunked if (currentBlock - fromBlock) > MAX_BLOCK_RANGE.
        // For this test, let's assume fromBlock=0, currentBlock=5000, MAX_BLOCK_RANGE=2000
        // First call will be (filter, 0, 1999)
        // Second call (filter, 2000, 3999)
        // Third call (filter, 4000, 5000)
        expect.anything() // First call's toBlock
      );
      // More detailed checks on chunking with currentBlock:
      // Re-calculate based on fromBlock=0, currentBlock=5000, MAX_BLOCK_RANGE=2000
      // Chunk 1: 0 to 1999
      // Chunk 2: 2000 to 3999
      // Chunk 3: 4000 to 5000
      expect(mockContractInstance.queryFilter).toHaveBeenNthCalledWith(
        1,
        'eventFilterObject',
        fromBlock, // 0
        fromBlock + 2000 - 1 // 1999
      );
      expect(mockContractInstance.queryFilter).toHaveBeenNthCalledWith(
        2,
        'eventFilterObject',
        fromBlock + 2000, // 2000
        fromBlock + 2000 * 2 - 1 // 3999
      );
      expect(mockContractInstance.queryFilter).toHaveBeenNthCalledWith(
        3,
        'eventFilterObject',
        fromBlock + 2000 * 2, // 4000
        currentBlock // 5000
      );
      expect(mockContractInstance.queryFilter).toHaveBeenCalledTimes(3);
    });

    it('should rethrow error if queryFilter fails during chunk fetching', async () => {
      const MAX_BLOCK_RANGE = 2000;
      const errorFromBlock = 0;
      const errorToBlock = errorFromBlock + MAX_BLOCK_RANGE * 1.5; // Two chunks
      const testError = new Error('RPC down');

      (mockContractInstance.filters.OracleAssigned as any).mockReturnValue(
        'eventFilterObject'
      );
      mockContractInstance.queryFilter
        .mockResolvedValueOnce([{ transactionHash: 'txHashChunk1' } as any]) // First chunk succeeds
        .mockRejectedValueOnce(testError); // Second chunk fails

      await expect(
        blockchainService.getOracleAssignedEvents(
          elephantAddress,
          errorFromBlock,
          errorToBlock
        )
      ).rejects.toThrow(testError);

      expect(mockContractInstance.queryFilter).toHaveBeenCalledTimes(2);
      // Chunk 1 attempt
      expect(mockContractInstance.queryFilter).toHaveBeenNthCalledWith(
        1,
        'eventFilterObject',
        errorFromBlock,
        errorFromBlock + MAX_BLOCK_RANGE - 1
      );
      // Chunk 2 attempt (which fails)
      expect(mockContractInstance.queryFilter).toHaveBeenNthCalledWith(
        2,
        'eventFilterObject',
        errorFromBlock + MAX_BLOCK_RANGE,
        errorToBlock
      );
      // mockParseOracleAssignedEvent should NOT have been called because the error occurs before parsing
      expect(mockParseOracleAssignedEvent).toHaveBeenCalledTimes(0);
    });
  });
});
