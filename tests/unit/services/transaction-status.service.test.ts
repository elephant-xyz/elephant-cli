import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TransactionStatusService } from '../../../src/services/transaction-status.service.js';

// Mock ethers module
vi.mock('ethers', () => ({
  ethers: {
    JsonRpcProvider: vi.fn(),
  },
}));

describe('TransactionStatusService', () => {
  let service: TransactionStatusService;
  let mockProvider: any;

  beforeEach(async () => {
    vi.clearAllMocks();

    mockProvider = {
      getTransaction: vi.fn(),
      getTransactionReceipt: vi.fn(),
    };

    const { ethers } = await import('ethers');
    vi.mocked(ethers.JsonRpcProvider).mockImplementation(
      () => mockProvider as any
    );

    service = new TransactionStatusService('https://rpc.test.com');
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
  describe('waitForTransaction', () => {
    const mockTxHash = '0x1234567890abcdef';

    it('should return success status for confirmed transaction', async () => {
      mockProvider.getTransaction.mockResolvedValue({ hash: mockTxHash });
      mockProvider.getTransactionReceipt.mockResolvedValue({
        status: 1,
        blockNumber: 12345,
        gasUsed: BigInt(21000),
      });

      const result = await service.waitForTransaction(mockTxHash);

      expect(result).toEqual({
        hash: mockTxHash,
        status: 'success',
        blockNumber: 12345,
        gasUsed: '21000',
      });
    });

    it('should return failed status for reverted transaction', async () => {
      mockProvider.getTransaction.mockResolvedValue({ hash: mockTxHash });
      mockProvider.getTransactionReceipt.mockResolvedValue({
        status: 0,
        blockNumber: 12345,
        gasUsed: BigInt(21000),
      });

      const result = await service.waitForTransaction(mockTxHash);

      expect(result).toEqual({
        hash: mockTxHash,
        status: 'failed',
        blockNumber: 12345,
        gasUsed: '21000',
        error: 'Transaction reverted by EVM',
      });
    });

    it('should poll until transaction is found', async () => {
      mockProvider.getTransaction
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ hash: mockTxHash });

      mockProvider.getTransactionReceipt.mockResolvedValue({
        status: 1,
        blockNumber: 12345,
        gasUsed: BigInt(21000),
      });

      const result = await service.waitForTransaction(mockTxHash, 10000);

      expect(result.status).toBe('success');
      expect(mockProvider.getTransaction).toHaveBeenCalledTimes(3);
    });

    it('should timeout if transaction not confirmed', async () => {
      mockProvider.getTransaction.mockResolvedValue(null);

      const result = await service.waitForTransaction(mockTxHash, 100); // 100ms timeout

      expect(result).toEqual({
        hash: mockTxHash,
        status: 'pending',
        error: 'Transaction confirmation timeout after 0.1s',
      });
    });

    it('should handle provider errors gracefully', async () => {
      mockProvider.getTransaction.mockRejectedValue(new Error('Network error'));

      const result = await service.waitForTransaction(mockTxHash, 100);

      expect(result.status).toBe('pending');
      expect(result.error).toContain('timeout');
    });
  });

  describe('waitForMultipleTransactions', () => {
    it('should wait for multiple transactions in parallel', async () => {
      const txHashes = ['0x111', '0x222', '0x333'];

      mockProvider.getTransaction.mockResolvedValue({ hash: 'mock' });
      mockProvider.getTransactionReceipt.mockImplementation(() =>
        Promise.resolve({
          status: 1,
          blockNumber: 12345,
          gasUsed: BigInt(21000),
        })
      );

      const results = await service.waitForMultipleTransactions(txHashes);

      expect(results).toHaveLength(3);
      expect(results.every((r) => r.status === 'success')).toBe(true);
    });

    it('should call progress callback', async () => {
      const txHashes = ['0x111', '0x222'];
      const progressCallback = vi.fn();

      mockProvider.getTransaction.mockResolvedValue({ hash: 'mock' });
      mockProvider.getTransactionReceipt.mockResolvedValue({
        status: 1,
        blockNumber: 12345,
        gasUsed: BigInt(21000),
      });

      await service.waitForMultipleTransactions(txHashes, progressCallback);

      expect(progressCallback).toHaveBeenCalledWith(1, 2);
      expect(progressCallback).toHaveBeenCalledWith(2, 2);
    });
  });

  describe('getTransactionStatus', () => {
    const mockTxHash = '0x1234567890abcdef';

    it('should return success status for mined transaction', async () => {
      mockProvider.getTransactionReceipt.mockResolvedValue({
        status: 1,
        blockNumber: 12345,
        gasUsed: BigInt(21000),
      });

      const result = await service.getTransactionStatus(mockTxHash);

      expect(result).toEqual({
        hash: mockTxHash,
        status: 'success',
        blockNumber: 12345,
        gasUsed: '21000',
      });
    });

    it('should return failed status for reverted transaction', async () => {
      mockProvider.getTransactionReceipt.mockResolvedValue({
        status: 0,
        blockNumber: 12345,
        gasUsed: BigInt(21000),
      });

      const result = await service.getTransactionStatus(mockTxHash);

      expect(result).toEqual({
        hash: mockTxHash,
        status: 'failed',
        blockNumber: 12345,
        gasUsed: '21000',
      });
    });

    it('should return pending status for unmined transaction', async () => {
      mockProvider.getTransactionReceipt.mockResolvedValue(null);
      mockProvider.getTransaction.mockResolvedValue({ hash: mockTxHash });

      const result = await service.getTransactionStatus(mockTxHash);

      expect(result).toEqual({
        hash: mockTxHash,
        status: 'pending',
      });
    });

    it('should return dropped for non-existent transaction', async () => {
      mockProvider.getTransactionReceipt.mockResolvedValue(null);
      mockProvider.getTransaction.mockResolvedValue(null);

      const result = await service.getTransactionStatus(mockTxHash);

      expect(result).toEqual({
        hash: mockTxHash,
        status: 'dropped',
        error: 'Transaction dropped - not found in mempool or blockchain',
      });
    });

    it('should handle provider errors gracefully', async () => {
      mockProvider.getTransactionReceipt.mockRejectedValue(
        new Error('Network error')
      );

      const result = await service.getTransactionStatus(mockTxHash);

      expect(result).toEqual({
        hash: mockTxHash,
        status: 'pending',
        error: 'Network error',
      });
    });
  });
});
