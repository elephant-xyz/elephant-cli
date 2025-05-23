import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { BlockchainService } from '../../../src/services/blockchain.service';
import { EventDecoderService } from '../../../src/services/event-decoder.service';
import type { Mock } from 'jest-mock';

// Create mock classes with proper typing
const mockProvider = {
  getBlockNumber: jest.fn() as Mock<Promise<number>>,
};

const mockContract = {
  filters: {
    ElephantAssigned: jest.fn() as Mock<string>,
  },
  queryFilter: jest.fn() as Mock<Promise<any[]>>,
};

const mockEventDecoder = {
  parseElephantAssignedEvent: jest.fn() as Mock<any>,
};

// Mock constructors with proper typing
const MockJsonRpcProvider = jest.fn(() => mockProvider) as Mock<typeof mockProvider>;
const MockContract = jest.fn(() => mockContract) as Mock<typeof mockContract>;
const MockEventDecoderService = jest.fn(() => mockEventDecoder) as Mock<typeof mockEventDecoder>;

// Mock ethers
jest.mock('ethers', () => ({
  JsonRpcProvider: MockJsonRpcProvider,
  Contract: MockContract,
}));

// Mock EventDecoderService
jest.mock('../../../src/services/event-decoder.service', () => ({
  EventDecoderService: MockEventDecoderService,
}));

describe('BlockchainService', () => {
  let blockchainService: BlockchainService;

  const TEST_RPC_URL = 'https://test.rpc.url';
  const TEST_CONTRACT_ADDRESS = '0x1234567890123456789012345678901234567890';
  const TEST_ABI = ['event ElephantAssigned(bytes propertyCid, address indexed elephant)'];
  const TEST_ELEPHANT_ADDRESS = '0x0e44bfab0f7e1943cF47942221929F898E181505';

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Create service instance
    blockchainService = new BlockchainService(TEST_RPC_URL, TEST_CONTRACT_ADDRESS, TEST_ABI);
  });

  describe('constructor', () => {
    it('should initialize with correct parameters', () => {
      expect(MockJsonRpcProvider).toHaveBeenCalledWith(TEST_RPC_URL);
      expect(MockContract).toHaveBeenCalledWith(TEST_CONTRACT_ADDRESS, TEST_ABI, mockProvider);
      expect(MockEventDecoderService).toHaveBeenCalled();
    });
  });

  describe('getCurrentBlock', () => {
    it('should return current block number', async () => {
      const currentBlock = 12345678;
      (mockProvider.getBlockNumber as Mock).mockResolvedValue(currentBlock);

      const result = await blockchainService.getCurrentBlock();

      expect(result).toBe(currentBlock);
      expect(mockProvider.getBlockNumber as Mock).toHaveBeenCalledTimes(1);
    });

    it('should throw error when provider fails', async () => {
      const error = new Error('Network error');
      (mockProvider.getBlockNumber as Mock).mockRejectedValue(error);

      await expect(blockchainService.getCurrentBlock()).rejects.toThrow('Network error');
    });
  });

  describe('getElephantAssignedEvents', () => {
    const mockEvents = [
      {
        data: '0x0000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000002e2e516d575554576d756f6453594575485650677874724152477261325670737375734170344671543946576f627555000000000000000000000000000000',
        topics: [
          '0xeventtopic',
          '0x0000000000000000000000000e44bfab0f7e1943cf47942221929f898e181505'
        ],
        blockNumber: 71875870,
        transactionHash: '0xtxhash123',
      },
      {
        data: '0x0000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000002e2e516d58585858585858585858585858585858585858585858585858585858585858585858585858585858585858000000000000000000000000000000',
        topics: [
          '0xeventtopic',
          '0x0000000000000000000000000e44bfab0f7e1943cf47942221929f898e181505'
        ],
        blockNumber: 71875871,
        transactionHash: '0xtxhash456',
      },
    ];

    const mockParsedEvents = [
      {
        cid: 'QmWUnTmuodSYEuHVPgxtrARGra2VpzsusAp4FqT9FWobuU',
        elephant: TEST_ELEPHANT_ADDRESS,
        blockNumber: 71875870,
        transactionHash: '0xtxhash123',
      },
      {
        cid: 'QmXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
        elephant: TEST_ELEPHANT_ADDRESS,
        blockNumber: 71875871,
        transactionHash: '0xtxhash456',
      },
    ];

    beforeEach(() => {
      (mockContract.filters.ElephantAssigned as Mock).mockReturnValue('filter');
      (mockContract.queryFilter as Mock).mockResolvedValue(mockEvents);
      (mockEventDecoder.parseElephantAssignedEvent as Mock)
        .mockReturnValueOnce(mockParsedEvents[0])
        .mockReturnValueOnce(mockParsedEvents[1]);
    });

    it('should fetch and parse events correctly', async () => {
      const fromBlock = 71875850;
      const toBlock = 71875900;

      const result = await blockchainService.getElephantAssignedEvents(
        TEST_ELEPHANT_ADDRESS,
        fromBlock,
        toBlock
      );

      expect(mockContract.filters.ElephantAssigned as Mock).toHaveBeenCalledWith(null, TEST_ELEPHANT_ADDRESS);
      expect(mockContract.queryFilter as Mock).toHaveBeenCalledWith('filter', fromBlock, toBlock);
      expect(mockEventDecoder.parseElephantAssignedEvent as Mock).toHaveBeenCalledTimes(2);
      expect(mockEventDecoder.parseElephantAssignedEvent as Mock).toHaveBeenCalledWith(mockEvents[0]);
      expect(mockEventDecoder.parseElephantAssignedEvent as Mock).toHaveBeenCalledWith(mockEvents[1]);
      expect(result).toEqual(mockParsedEvents);
    });

    it('should handle empty event list', async () => {
      (mockContract.queryFilter as Mock).mockResolvedValue([]);

      const result = await blockchainService.getElephantAssignedEvents(
        TEST_ELEPHANT_ADDRESS,
        71875850,
        71875900
      );

      expect(result).toEqual([]);
      expect(mockEventDecoder.parseElephantAssignedEvent as Mock).not.toHaveBeenCalled();
    });

    it('should work without toBlock parameter', async () => {
      const fromBlock = 71875850;

      await blockchainService.getElephantAssignedEvents(
        TEST_ELEPHANT_ADDRESS,
        fromBlock
      );

      expect(mockContract.queryFilter as Mock).toHaveBeenCalledWith('filter', fromBlock, undefined);
    });

    it('should throw error when query fails', async () => {
      const error = new Error('RPC error');
      (mockContract.queryFilter as Mock).mockRejectedValue(error);

      await expect(
        blockchainService.getElephantAssignedEvents(TEST_ELEPHANT_ADDRESS, 0)
      ).rejects.toThrow('RPC error');
    });

    it('should propagate decoder errors', async () => {
      (mockContract.queryFilter as Mock).mockResolvedValue([mockEvents[0]]);
      (mockEventDecoder.parseElephantAssignedEvent as Mock).mockImplementation(() => {
        throw new Error('Invalid CID format');
      });

      await expect(
        blockchainService.getElephantAssignedEvents(TEST_ELEPHANT_ADDRESS, 0)
      ).rejects.toThrow('Invalid CID format');
    });
  });
});