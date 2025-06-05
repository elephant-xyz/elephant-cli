import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AssignmentCheckerService } from '../../../src/services/assignment-checker.service';
import { BlockchainService } from '../../../src/services/blockchain.service';
import { OracleAssignment } from '../../../src/types/index';

// Mock BlockchainService
vi.mock('../../../src/services/blockchain.service');

// Mock logger
vi.mock('../../../src/utils/logger', () => ({
  logger: {
    technical: vi.fn(),
    error: vi.fn(),
  },
}));

const MockedBlockchainService = BlockchainService as unknown as vi.Mocked<
  typeof BlockchainService
>;

describe('AssignmentCheckerService', () => {
  let assignmentCheckerService: AssignmentCheckerService;
  let mockBlockchainServiceInstance: vi.Mocked<
    InstanceType<typeof BlockchainService>
  >;

  const mockRpcUrl = 'http://localhost:8545';
  const mockContractAddress = '0x1234567890123456789012345678901234567890';
  const mockElephantAddress = '0xabcdef1234567890123456789012345678901234';

  beforeEach(() => {
    vi.clearAllMocks();

    // Create mock instance
    mockBlockchainServiceInstance = {
      getCurrentBlock: vi.fn(),
      getOracleAssignedEvents: vi.fn(),
    } as any;

    // Mock the constructor to return our mock instance
    MockedBlockchainService.mockImplementation(
      () => mockBlockchainServiceInstance
    );

    assignmentCheckerService = new AssignmentCheckerService(
      mockRpcUrl,
      mockContractAddress
    );
  });

  describe('fetchAssignedCids', () => {
    it('should fetch and cache assigned CIDs successfully', async () => {
      const mockEvents: OracleAssignment[] = [
        {
          cid: 'QmTestCid1',
          elephant: mockElephantAddress,
          blockNumber: 100,
          transactionHash: '0xhash1',
        },
        {
          cid: 'QmTestCid2',
          elephant: mockElephantAddress,
          blockNumber: 101,
          transactionHash: '0xhash2',
        },
      ];

      mockBlockchainServiceInstance.getCurrentBlock.mockResolvedValue(1000);
      mockBlockchainServiceInstance.getOracleAssignedEvents.mockResolvedValue(
        mockEvents
      );

      const result =
        await assignmentCheckerService.fetchAssignedCids(mockElephantAddress);

      expect(
        mockBlockchainServiceInstance.getCurrentBlock
      ).toHaveBeenCalledTimes(1);
      expect(
        mockBlockchainServiceInstance.getOracleAssignedEvents
      ).toHaveBeenCalledWith(mockElephantAddress, 72310501, 1000);

      expect(result.size).toBe(2);
      expect(result.has('QmTestCid1')).toBe(true);
      expect(result.has('QmTestCid2')).toBe(true);
    });

    it('should handle custom block range', async () => {
      const mockEvents: OracleAssignment[] = [
        {
          cid: 'QmTestCid1',
          elephant: mockElephantAddress,
          blockNumber: 100,
          transactionHash: '0xhash1',
        },
      ];

      mockBlockchainServiceInstance.getOracleAssignedEvents.mockResolvedValue(
        mockEvents
      );

      const result = await assignmentCheckerService.fetchAssignedCids(
        mockElephantAddress,
        50,
        200
      );

      expect(
        mockBlockchainServiceInstance.getCurrentBlock
      ).not.toHaveBeenCalled();
      expect(
        mockBlockchainServiceInstance.getOracleAssignedEvents
      ).toHaveBeenCalledWith(mockElephantAddress, 50, 200);

      expect(result.size).toBe(1);
      expect(result.has('QmTestCid1')).toBe(true);
    });

    it('should handle no assigned CIDs', async () => {
      mockBlockchainServiceInstance.getCurrentBlock.mockResolvedValue(1000);
      mockBlockchainServiceInstance.getOracleAssignedEvents.mockResolvedValue(
        []
      );

      const result =
        await assignmentCheckerService.fetchAssignedCids(mockElephantAddress);

      expect(result.size).toBe(0);
    });

    it('should handle blockchain service errors', async () => {
      const error = new Error('Blockchain service error');
      mockBlockchainServiceInstance.getCurrentBlock.mockRejectedValue(error);

      await expect(
        assignmentCheckerService.fetchAssignedCids(mockElephantAddress)
      ).rejects.toThrow('Blockchain service error');
    });
  });

  describe('isCidAssigned', () => {
    beforeEach(async () => {
      const mockEvents: OracleAssignment[] = [
        {
          cid: 'QmTestCid1',
          elephant: mockElephantAddress,
          blockNumber: 100,
          transactionHash: '0xhash1',
        },
        {
          cid: 'QmTestCid2',
          elephant: mockElephantAddress,
          blockNumber: 101,
          transactionHash: '0xhash2',
        },
      ];

      mockBlockchainServiceInstance.getCurrentBlock.mockResolvedValue(1000);
      mockBlockchainServiceInstance.getOracleAssignedEvents.mockResolvedValue(
        mockEvents
      );

      await assignmentCheckerService.fetchAssignedCids(mockElephantAddress);
    });

    it('should return true for assigned CIDs', () => {
      expect(assignmentCheckerService.isCidAssigned('QmTestCid1')).toBe(true);
      expect(assignmentCheckerService.isCidAssigned('QmTestCid2')).toBe(true);
    });

    it('should return false for non-assigned CIDs', () => {
      expect(assignmentCheckerService.isCidAssigned('QmNotAssigned')).toBe(
        false
      );
    });
  });

  describe('getAssignedCids', () => {
    it('should return a copy of assigned CIDs', async () => {
      const mockEvents: OracleAssignment[] = [
        {
          cid: 'QmTestCid1',
          elephant: mockElephantAddress,
          blockNumber: 100,
          transactionHash: '0xhash1',
        },
      ];

      mockBlockchainServiceInstance.getCurrentBlock.mockResolvedValue(1000);
      mockBlockchainServiceInstance.getOracleAssignedEvents.mockResolvedValue(
        mockEvents
      );

      await assignmentCheckerService.fetchAssignedCids(mockElephantAddress);
      const result = assignmentCheckerService.getAssignedCids();

      expect(result.size).toBe(1);
      expect(result.has('QmTestCid1')).toBe(true);

      // Verify it's a copy (modifying returned set shouldn't affect internal state)
      result.add('QmNewCid');
      expect(assignmentCheckerService.isCidAssigned('QmNewCid')).toBe(false);
    });
  });

  describe('getAssignedCidsCount', () => {
    it('should return correct count of assigned CIDs', async () => {
      const mockEvents: OracleAssignment[] = [
        {
          cid: 'QmTestCid1',
          elephant: mockElephantAddress,
          blockNumber: 100,
          transactionHash: '0xhash1',
        },
        {
          cid: 'QmTestCid2',
          elephant: mockElephantAddress,
          blockNumber: 101,
          transactionHash: '0xhash2',
        },
      ];

      mockBlockchainServiceInstance.getCurrentBlock.mockResolvedValue(1000);
      mockBlockchainServiceInstance.getOracleAssignedEvents.mockResolvedValue(
        mockEvents
      );

      await assignmentCheckerService.fetchAssignedCids(mockElephantAddress);

      expect(assignmentCheckerService.getAssignedCidsCount()).toBe(2);
    });

    it('should return 0 when no CIDs are assigned', () => {
      expect(assignmentCheckerService.getAssignedCidsCount()).toBe(0);
    });
  });
});
