import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  TransactionStatusCheckerService,
  TransactionRecord,
} from '../../../src/services/transaction-status-checker.service.js';
import { TransactionStatusService } from '../../../src/services/transaction-status.service.js';

vi.mock('../../../src/services/transaction-status.service.js');
vi.mock('../../../src/utils/logger.js', () => ({
  logger: {
    technical: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}));

describe('TransactionStatusCheckerService', () => {
  let service: TransactionStatusCheckerService;
  let mockStatusService: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockStatusService = {
      getTransactionStatus: vi.fn(),
    };
    vi.mocked(TransactionStatusService).mockImplementation(
      () => mockStatusService
    );
    service = new TransactionStatusCheckerService('http://test-rpc.com', 5);
  });

  describe('checkTransactionStatuses', () => {
    it('should check status for all transactions', async () => {
      const transactions: TransactionRecord[] = [
        {
          transactionHash: '0x123',
          batchIndex: 0,
          itemCount: 10,
          timestamp: '2024-01-01T00:00:00Z',
          status: 'pending',
        },
        {
          transactionHash: '0x456',
          batchIndex: 1,
          itemCount: 5,
          timestamp: '2024-01-01T00:01:00Z',
          status: 'pending',
        },
      ];

      mockStatusService.getTransactionStatus
        .mockResolvedValueOnce({
          hash: '0x123',
          status: 'success',
          blockNumber: 12345,
          gasUsed: '100000',
        })
        .mockResolvedValueOnce({
          hash: '0x456',
          status: 'failed',
          error: 'Transaction reverted',
        });

      const results = await service.checkTransactionStatuses(transactions);

      expect(results).toHaveLength(2);
      expect(results[0]).toMatchObject({
        transactionHash: '0x123',
        status: 'success',
        blockNumber: 12345,
        gasUsed: '100000',
      });
      expect(results[1]).toMatchObject({
        transactionHash: '0x456',
        status: 'failed',
        error: 'Transaction reverted',
      });
    });

    it('should call progress callback', async () => {
      const transactions: TransactionRecord[] = [
        {
          transactionHash: '0x123',
          batchIndex: 0,
          itemCount: 10,
          timestamp: '2024-01-01T00:00:00Z',
          status: 'pending',
        },
      ];

      mockStatusService.getTransactionStatus.mockResolvedValue({
        hash: '0x123',
        status: 'success',
      });

      const progressCallback = vi.fn();
      await service.checkTransactionStatuses(transactions, progressCallback);

      expect(progressCallback).toHaveBeenCalledWith(1, 1);
    });

    it('should handle pending transactions', async () => {
      const transactions: TransactionRecord[] = [
        {
          transactionHash: '0x789',
          batchIndex: 0,
          itemCount: 3,
          timestamp: '2024-01-01T00:00:00Z',
          status: 'pending',
        },
      ];

      mockStatusService.getTransactionStatus.mockResolvedValue({
        hash: '0x789',
        status: 'pending',
      });

      const results = await service.checkTransactionStatuses(transactions);

      expect(results[0].status).toBe('pending');
      expect(results[0].blockNumber).toBeUndefined();
      expect(results[0].gasUsed).toBeUndefined();
    });

    it('should handle transaction not found', async () => {
      const transactions: TransactionRecord[] = [
        {
          transactionHash: '0xabc',
          batchIndex: 0,
          itemCount: 1,
          timestamp: '2024-01-01T00:00:00Z',
          status: 'pending',
        },
      ];

      mockStatusService.getTransactionStatus.mockResolvedValue({
        hash: '0xabc',
        status: 'pending',
        error: 'Transaction not found on chain',
      });

      const results = await service.checkTransactionStatuses(transactions);

      expect(results[0].status).toBe('pending');
      expect(results[0].error).toBe('Transaction not found on chain');
    });

    it('should respect concurrency limit', async () => {
      const transactions: TransactionRecord[] = Array.from(
        { length: 10 },
        (_, i) => ({
          transactionHash: `0x${i}`,
          batchIndex: i,
          itemCount: 1,
          timestamp: '2024-01-01T00:00:00Z',
          status: 'pending',
        })
      );

      let concurrentCalls = 0;
      let maxConcurrentCalls = 0;

      mockStatusService.getTransactionStatus.mockImplementation(async () => {
        concurrentCalls++;
        maxConcurrentCalls = Math.max(maxConcurrentCalls, concurrentCalls);
        await new Promise((resolve) => setTimeout(resolve, 10));
        concurrentCalls--;
        return { hash: '0x0', status: 'success' };
      });

      await service.checkTransactionStatuses(transactions);

      expect(maxConcurrentCalls).toBeLessThanOrEqual(5);
    });
  });
});
