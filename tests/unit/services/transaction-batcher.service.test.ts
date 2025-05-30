import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  ethers,
  Wallet as MockableWallet,
  Contract as MockableContract,
} from 'ethers'; // This should import our mocked ethers
import { TransactionBatcherService } from '../../../src/services/transaction-batcher.service';
import {
  DataItem,
  BatchSubmissionResult,
} from '../../../src/types/contract.types';
import { SUBMIT_CONTRACT_METHODS } from '../../../src/config/constants';
import { DEFAULT_SUBMIT_CONFIG } from '../../../src/config/submit.config';

// Mock ethers
vi.mock('ethers', async (importOriginal) => {
  const actualEthers = await importOriginal<typeof import('ethers')>();

  const walletMock = vi.fn().mockImplementation((privateKey, provider) => ({
    privateKey,
    provider,
    address: 'mockWalletAddress',
    getNonce: vi.fn().mockResolvedValue(0),
  }));

  const contractMock = vi.fn().mockImplementation((address, abi, signer) => {
    const submitBatchDataMethodMock = vi.fn();
    submitBatchDataMethodMock.estimateGas = vi
      .fn()
      .mockResolvedValue(BigInt(100000));
    return {
      address,
      interface: abi,
      runner: signer,
      [SUBMIT_CONTRACT_METHODS.SUBMIT_BATCH_DATA]: submitBatchDataMethodMock,
    };
  });

  const jsonRpcProviderMock = vi.fn().mockImplementation(() => ({
    // Mock provider methods if needed
  }));

  // This is the namespace object for `import { ethers } from 'ethers'`
  const ethersNamespaceMock = {
    JsonRpcProvider: jsonRpcProviderMock,
    // Add other properties to ethersNamespaceMock if SUT uses them via `ethers.something`
    // For TransactionBatcherService, only ethers.JsonRpcProvider seems to be used from the namespace.
  };

  return {
    // Export for `import { ethers } from 'ethers'`
    ethers: ethersNamespaceMock,

    // Direct exports for `import { Wallet, Contract, ... } from 'ethers'`
    Wallet: walletMock,
    Contract: contractMock,
    JsonRpcProvider: jsonRpcProviderMock, // Also export directly in case of `import { JsonRpcProvider } from 'ethers'`
    toUtf8Bytes: actualEthers.toUtf8Bytes,
    hexlify: actualEthers.hexlify,

    // Other necessary exports from actualEthers can be added here if SUT/tests need them.
    // Types like TransactionResponse, TransactionReceipt are compile-time and don't need runtime mocks.
  };
});

// Mock logger (remains unchanged)
vi.mock('../../../src/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    technical: vi.fn(),
    progress: vi.fn(),
  },
}));

// Mock validation utils for hash extraction
vi.mock('../../../src/utils/validation', () => ({
  extractHashFromCID: vi
    .fn()
    .mockReturnValue(
      '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
    ),
}));

describe('TransactionBatcherService', () => {
  const mockRpcUrl = 'http://localhost:8545';
  const mockContractAddress = '0x1234567890123456789012345678901234567890';
  const mockPrivateKey =
    '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

  let service: TransactionBatcherService;
  let mockWalletInstance: any;
  let mockContractInstance: any;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new TransactionBatcherService(
      mockRpcUrl,
      mockContractAddress,
      mockPrivateKey
    );

    // Access .mock.results[0].value from the directly imported mock functions
    mockWalletInstance = (MockableWallet as any).mock.results[0].value;
    mockContractInstance = (MockableContract as any).mock.results[0].value;
  });

  describe('constructor', () => {
    it('should initialize Wallet and Contract', () => {
      // Check if the mock Wallet constructor (MockableWallet) was called
      expect(MockableWallet).toHaveBeenCalledWith(
        mockPrivateKey,
        expect.any(Object) // The JsonRpcProvider instance from ethers.JsonRpcProvider
      );
      // Check if the mock Contract constructor (MockableContract) was called
      expect(MockableContract).toHaveBeenCalledWith(
        mockContractAddress,
        expect.any(Array),
        mockWalletInstance
      );
      expect(mockWalletInstance.address).toBe('mockWalletAddress');
    });
  });

  describe('groupItemsIntoBatches', () => {
    it('should group items according to transactionBatchSize', () => {
      const items: DataItem[] = Array(
        DEFAULT_SUBMIT_CONFIG.transactionBatchSize * 2 + 10
      )
        .fill(0)
        .map((_, i) => ({
          propertyCid: `p${i}`,
          dataGroupCID: `g${i}`,
          dataCID: `d${i}`,
        }));
      const batches = service.groupItemsIntoBatches(items);
      expect(batches).toHaveLength(3);
      expect(batches[0]).toHaveLength(
        DEFAULT_SUBMIT_CONFIG.transactionBatchSize
      );
      expect(batches[1]).toHaveLength(
        DEFAULT_SUBMIT_CONFIG.transactionBatchSize
      );
      expect(batches[2]).toHaveLength(10);
    });

    it('should handle empty items array', () => {
      const batches = service.groupItemsIntoBatches([]);
      expect(batches).toEqual([]);
    });

    it('should handle items less than batch size', () => {
      const items: DataItem[] = [
        { propertyCid: 'p1', dataGroupCID: 'g1', dataCID: 'd1' },
      ];
      const batches = service.groupItemsIntoBatches(items);
      expect(batches).toHaveLength(1);
      expect(batches[0]).toHaveLength(1);
    });
  });

  describe('submitBatch', () => {
    const batchItems: DataItem[] = [
      { propertyCid: 'p1', dataGroupCID: 'g1', dataCID: 'd1' },
    ];
    const mockTxResponse = { hash: '0xtxhash_submitBatch', wait: vi.fn() };
    const mockTxReceipt = {
      hash: '0xtxhash_submitBatch',
      blockNumber: 123,
      gasUsed: BigInt(90000),
      status: 1,
    };

    beforeEach(() => {
      mockWalletInstance.getNonce.mockResolvedValue(0);
      // @ts-ignore
      service.nonce = undefined;

      mockContractInstance[
        SUBMIT_CONTRACT_METHODS.SUBMIT_BATCH_DATA
      ].mockResolvedValue(mockTxResponse);
      mockTxResponse.wait.mockResolvedValue(mockTxReceipt);
    });

    it('should submit a batch successfully', async () => {
      const result = await service.submitBatch(batchItems);
      expect(mockWalletInstance.getNonce).toHaveBeenCalledTimes(1);
      expect(
        mockContractInstance[SUBMIT_CONTRACT_METHODS.SUBMIT_BATCH_DATA]
          .estimateGas
      ).toHaveBeenCalled();
      expect(
        mockContractInstance[SUBMIT_CONTRACT_METHODS.SUBMIT_BATCH_DATA]
      ).toHaveBeenCalled();
      expect(mockTxResponse.wait).toHaveBeenCalled();
      expect(result).toEqual({
        transactionHash: mockTxReceipt.hash,
        blockNumber: mockTxReceipt.blockNumber,
        gasUsed: mockTxReceipt.gasUsed.toString(),
        itemsSubmitted: batchItems.length,
      });
      // @ts-ignore
      expect(service.nonce).toBe(1);
    });

    it('should retry on failure and then succeed', async () => {
      mockContractInstance[SUBMIT_CONTRACT_METHODS.SUBMIT_BATCH_DATA]
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce(mockTxResponse);
      mockWalletInstance.getNonce
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(1);

      const result = await service.submitBatch(batchItems);
      expect(
        mockContractInstance[SUBMIT_CONTRACT_METHODS.SUBMIT_BATCH_DATA]
      ).toHaveBeenCalledTimes(2);
      expect(result.transactionHash).toBe(mockTxReceipt.hash);
      // @ts-ignore
      expect(service.nonce).toBe(2);
    });

    it('should throw error for empty batch', async () => {
      await expect(service.submitBatch([])).rejects.toThrow(
        'Cannot submit an empty batch.'
      );
    });
  });

  describe('submitAll', () => {
    const allItems: DataItem[] = Array(5)
      .fill(0)
      .map((_, i) => ({
        propertyCid: `p${i}`,
        dataGroupCID: `g${i}`,
        dataCID: `d${i}`,
      }));
    const mockTxResponse = { hash: '0xtxhash_submitAll', wait: vi.fn() };
    const mockTxReceipt = {
      hash: '0xtxhash_submitAll',
      blockNumber: 123,
      gasUsed: BigInt(90000),
      status: 1,
    };

    beforeEach(() => {
      service = new TransactionBatcherService(
        mockRpcUrl,
        mockContractAddress,
        mockPrivateKey,
        { transactionBatchSize: 2 }
      );
      // Use the aliased imports for accessing mock properties
      mockWalletInstance = (MockableWallet as any).mock.results[1].value;
      mockContractInstance = (MockableContract as any).mock.results[1].value;

      mockWalletInstance.getNonce.mockImplementation(async () => {
        let currentNonce =
          mockWalletInstance.currentNonce === undefined
            ? 0
            : mockWalletInstance.currentNonce;
        mockWalletInstance.currentNonce = currentNonce + 1;
        return currentNonce;
      });
      mockContractInstance[
        SUBMIT_CONTRACT_METHODS.SUBMIT_BATCH_DATA
      ].mockResolvedValue(mockTxResponse);
      mockTxResponse.wait.mockResolvedValue(mockTxReceipt);
    });

    afterEach(() => {
      if (mockWalletInstance) mockWalletInstance.currentNonce = undefined;
    });

    it('should submit all items in batches and yield results', async () => {
      const results: BatchSubmissionResult[] = [];
      for await (const result of service.submitAll(allItems)) {
        results.push(result);
      }
      expect(results).toHaveLength(3);
      expect(
        mockContractInstance[SUBMIT_CONTRACT_METHODS.SUBMIT_BATCH_DATA]
      ).toHaveBeenCalledTimes(3);
      results.forEach((result) =>
        expect(result.transactionHash).toBe(mockTxReceipt.hash)
      );
    });
  });
});
