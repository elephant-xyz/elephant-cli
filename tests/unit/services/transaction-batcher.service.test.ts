import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ethers } from 'ethers';
import { TransactionBatcherService } from '../../../src/services/transaction-batcher.service';
import { DataItem, BatchSubmissionResult } from '../../../src/types/contract.types';
import { SUBMIT_CONTRACT_METHODS } from '../../../src/config/constants';
import { DEFAULT_SUBMIT_CONFIG } from '../../../src/config/submit.config';

// Mock ethers
vi.mock('ethers', async (importOriginal) => {
  const actualEthers = await importOriginal<typeof ethers>();
  return {
    ...actualEthers,
    Wallet: vi.fn().mockImplementation((privateKey, provider) => ({
      privateKey,
      provider,
      address: 'mockWalletAddress',
      getNonce: vi.fn().mockResolvedValue(0), // Initial nonce
      // estimateGas, sendTransaction etc. are on the Contract instance
    })),
    Contract: vi.fn().mockImplementation((address, abi, signer) => {
      const mockContract: any = {
        address,
        interface: abi, // Simplified
        runner: signer, // signer is providerOrSigner in ethers v6
        [SUBMIT_CONTRACT_METHODS.SUBMIT_BATCH_DATA]: vi.fn(),
      };
      // Mock estimateGas for the specific method
      mockContract[SUBMIT_CONTRACT_METHODS.SUBMIT_BATCH_DATA].estimateGas = vi.fn().mockResolvedValue(BigInt(100000));
      return mockContract;
    }),
    JsonRpcProvider: vi.fn().mockImplementation(() => ({
      // Mock provider methods if needed, e.g., getTransactionCount for nonce
    })),
    toUtf8Bytes: actualEthers.toUtf8Bytes, // Use actual implementation
  };
});

// Mock logger
vi.mock('../../../src/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('TransactionBatcherService', () => {
  const mockRpcUrl = 'http://localhost:8545';
  const mockContractAddress = '0x1234567890123456789012345678901234567890';
  const mockPrivateKey = '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  
  let service: TransactionBatcherService;
  let mockWalletInstance: any;
  let mockContractInstance: any;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new TransactionBatcherService(mockRpcUrl, mockContractAddress, mockPrivateKey);
    
    // Get mocked instances for assertions
    mockWalletInstance = (ethers.Wallet as any).mock.results[0].value;
    mockContractInstance = (ethers.Contract as any).mock.results[0].value;
  });

  describe('constructor', () => {
    it('should initialize Wallet and Contract', () => {
      expect(ethers.Wallet).toHaveBeenCalledWith(mockPrivateKey, expect.any(Object));
      expect(ethers.Contract).toHaveBeenCalledWith(mockContractAddress, expect.any(Array), mockWalletInstance);
      expect(mockWalletInstance.address).toBe('mockWalletAddress');
    });
  });

  describe('groupItemsIntoBatches', () => {
    it('should group items according to transactionBatchSize', () => {
      const items: DataItem[] = Array(DEFAULT_SUBMIT_CONFIG.transactionBatchSize * 2 + 10).fill(0).map((_, i) => ({
        propertyCid: \`p\${i}\`, dataGroupCID: \`g\${i}\`, dataCID: \`d\${i}\`
      }));
      const batches = service.groupItemsIntoBatches(items);
      expect(batches).toHaveLength(3);
      expect(batches[0]).toHaveLength(DEFAULT_SUBMIT_CONFIG.transactionBatchSize);
      expect(batches[1]).toHaveLength(DEFAULT_SUBMIT_CONFIG.transactionBatchSize);
      expect(batches[2]).toHaveLength(10);
    });

    it('should handle empty items array', () => {
      const batches = service.groupItemsIntoBatches([]);
      expect(batches).toEqual([]);
    });

    it('should handle items less than batch size', () => {
      const items: DataItem[] = [{ propertyCid: 'p1', dataGroupCID: 'g1', dataCID: 'd1' }];
      const batches = service.groupItemsIntoBatches(items);
      expect(batches).toHaveLength(1);
      expect(batches[0]).toHaveLength(1);
    });
  });

  describe('submitBatch', () => {
    const batchItems: DataItem[] = [{ propertyCid: 'p1', dataGroupCID: 'g1', dataCID: 'd1' }];
    const mockTxResponse = { hash: '0xtxhash', wait: vi.fn() };
    const mockTxReceipt = { hash: '0xtxhash', blockNumber: 123, gasUsed: BigInt(90000), status: 1 };

    beforeEach(() => {
      mockWalletInstance.getNonce.mockResolvedValue(0); // Reset nonce for each test
      // @ts-ignore access private member
      service.nonce = undefined; // Reset internal nonce tracking

      mockContractInstance[SUBMIT_CONTRACT_METHODS.SUBMIT_BATCH_DATA].mockResolvedValue(mockTxResponse);
      mockTxResponse.wait.mockResolvedValue(mockTxReceipt);
    });

    it('should submit a batch successfully', async () => {
      const result = await service.submitBatch(batchItems);

      expect(mockWalletInstance.getNonce).toHaveBeenCalledTimes(1);
      expect(mockContractInstance[SUBMIT_CONTRACT_METHODS.SUBMIT_BATCH_DATA].estimateGas).toHaveBeenCalled();
      expect(mockContractInstance[SUBMIT_CONTRACT_METHODS.SUBMIT_BATCH_DATA]).toHaveBeenCalledWith(
        expect.any(Array), // Prepared items
        expect.objectContaining({ nonce: 0 })
      );
      expect(mockTxResponse.wait).toHaveBeenCalled();
      expect(result).toEqual({
        transactionHash: mockTxReceipt.hash,
        blockNumber: mockTxReceipt.blockNumber,
        gasUsed: mockTxReceipt.gasUsed.toString(),
        itemsSubmitted: batchItems.length,
      });
      // @ts-ignore
      expect(service.nonce).toBe(1); // Nonce should be incremented
    });

    it('should retry on failure and then succeed', async () => {
      mockContractInstance[SUBMIT_CONTRACT_METHODS.SUBMIT_BATCH_DATA]
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce(mockTxResponse);
      
      // Mock getNonce to return incrementing values for retries
      mockWalletInstance.getNonce.mockResolvedValueOnce(0).mockResolvedValueOnce(1);


      const result = await service.submitBatch(batchItems);
      expect(mockContractInstance[SUBMIT_CONTRACT_METHODS.SUBMIT_BATCH_DATA]).toHaveBeenCalledTimes(2);
      expect(result.transactionHash).toBe(mockTxReceipt.hash);
      // @ts-ignore
      expect(service.nonce).toBe(2); // Nonce after successful retry
    });

    it('should throw after all retries fail', async () => {
      mockContractInstance[SUBMIT_CONTRACT_METHODS.SUBMIT_BATCH_DATA].mockRejectedValue(new Error('Persistent error'));
      
      mockWalletInstance.getNonce
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(2)
        .mockResolvedValueOnce(3);


      await expect(service.submitBatch(batchItems)).rejects.toThrow('Persistent error');
      expect(mockContractInstance[SUBMIT_CONTRACT_METHODS.SUBMIT_BATCH_DATA]).toHaveBeenCalledTimes(DEFAULT_SUBMIT_CONFIG.maxRetries + 1);
      // @ts-ignore
      expect(service.nonce).toBe(3); // Nonce was fetched 4 times, last one failed, so it's effectively 3 (0,1,2 used)
    });
    
    it('should throw error for empty batch', async () => {
      await expect(service.submitBatch([])).rejects.toThrow('Cannot submit an empty batch.');
    });

    it('should throw error if transaction reverts', async () => {
      const revertedReceipt = { ...mockTxReceipt, status: 0 };
      mockTxResponse.wait.mockResolvedValueOnce(revertedReceipt);
      mockContractInstance[SUBMIT_CONTRACT_METHODS.SUBMIT_BATCH_DATA].mockResolvedValueOnce(mockTxResponse);

      await expect(service.submitBatch(batchItems)).rejects.toThrow(`Transaction ${revertedReceipt.hash} reverted by EVM.`);
    });
  });

  describe('submitAll', () => {
    const allItems: DataItem[] = Array(5).fill(0).map((_, i) => ({
      propertyCid: \`p\${i}\`, dataGroupCID: \`g\${i}\`, dataCID: \`d\${i}\`
    }));
    const mockTxResponse = { hash: '0xtxhash', wait: vi.fn() };
    const mockTxReceipt = { hash: '0xtxhash', blockNumber: 123, gasUsed: BigInt(90000), status: 1 };

    beforeEach(() => {
      // Configure service for smaller batches for easier testing of submitAll
      service = new TransactionBatcherService(mockRpcUrl, mockContractAddress, mockPrivateKey, { transactionBatchSize: 2 });
      mockWalletInstance = (ethers.Wallet as any).mock.results[1].value; // Re-get for new service instance
      mockContractInstance = (ethers.Contract as any).mock.results[1].value; // Re-get

      mockWalletInstance.getNonce.mockImplementation(async () => {
        // @ts-ignore Simulate nonce increment for multiple calls within submitAll
        let currentNonce = (mockWalletInstance.currentNonce === undefined) ? 0 : mockWalletInstance.currentNonce;
        mockWalletInstance.currentNonce = currentNonce + 1;
        return currentNonce;
      });
      mockContractInstance[SUBMIT_CONTRACT_METHODS.SUBMIT_BATCH_DATA].mockResolvedValue(mockTxResponse);
      mockTxResponse.wait.mockResolvedValue(mockTxReceipt);
    });
    
    afterEach(() => {
        if(mockWalletInstance) mockWalletInstance.currentNonce = undefined; // Reset for next test
    });

    it('should submit all items in batches and yield results', async () => {
      const results: BatchSubmissionResult[] = [];
      for await (const result of service.submitAll(allItems)) {
        results.push(result);
      }

      // 5 items, batch size 2 => 3 batches (2, 2, 1)
      expect(results).toHaveLength(3);
      expect(mockContractInstance[SUBMIT_CONTRACT_METHODS.SUBMIT_BATCH_DATA]).toHaveBeenCalledTimes(3);
      results.forEach(result => {
        expect(result.transactionHash).toBe(mockTxReceipt.hash);
      });
      // Check nonce usage: 0, 1, 2
      expect(mockContractInstance[SUBMIT_CONTRACT_METHODS.SUBMIT_BATCH_DATA].mock.calls[0][1].nonce).toBe(0);
      expect(mockContractInstance[SUBMIT_CONTRACT_METHODS.SUBMIT_BATCH_DATA].mock.calls[1][1].nonce).toBe(1);
      expect(mockContractInstance[SUBMIT_CONTRACT_METHODS.SUBMIT_BATCH_DATA].mock.calls[2][1].nonce).toBe(2);
    });

    it('should stop and rethrow if a batch fails', async () => {
      mockContractInstance[SUBMIT_CONTRACT_METHODS.SUBMIT_BATCH_DATA]
        .mockResolvedValueOnce(mockTxResponse) // First batch succeeds
        .mockRejectedValueOnce(new Error('Batch 2 failed')); // Second batch fails

      const results: BatchSubmissionResult[] = [];
      try {
        for await (const result of service.submitAll(allItems)) {
          results.push(result);
        }
      } catch (error: any) {
        expect(error.message).toBe('Batch 2 failed');
      }

      expect(results).toHaveLength(1); // Only first batch succeeded
      expect(mockContractInstance[SUBMIT_CONTRACT_METHODS.SUBMIT_BATCH_DATA]).toHaveBeenCalledTimes(2); // Attempted 2 batches
    });
  });
});
