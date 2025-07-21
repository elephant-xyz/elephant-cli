import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFile, unlink, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { tmpdir } from 'os';
import { UnsignedTransactionJsonService } from '../../../src/services/unsigned-transaction-json.service';
import { DataItem } from '../../../src/types/contract.types';

// Mock validation module to avoid CID validation errors in tests
vi.mock('../../../src/utils/validation.js', () => ({
  extractHashFromCID: vi.fn().mockImplementation((cid: string) => {
    // Return a mock hash for any CID
    return '0x' + '1'.repeat(64);
  }),
}));

// Mock ethers module
vi.mock('ethers', async () => {
  const actual = await vi.importActual('ethers');

  const mockContract = {
    submitBatchData: {
      estimateGas: vi.fn().mockResolvedValue(BigInt('300000')),
    },
  };

  const mockProvider = {
    getTransactionCount: vi.fn().mockResolvedValue(42),
    send: vi.fn().mockResolvedValue('0x493e0'), // 300000 in hex
    getFeeData: vi.fn().mockResolvedValue({
      maxFeePerGas: BigInt('50000000000'), // 50 gwei
      maxPriorityFeePerGas: BigInt('2000000000'), // 2 gwei
    }),
  };

  const mockInterface = {
    encodeFunctionData: vi.fn().mockReturnValue('0x1234567890abcdef'),
  };

  return {
    ...actual,
    JsonRpcProvider: vi.fn().mockImplementation(() => mockProvider),
    Contract: vi.fn().mockImplementation(() => mockContract),
    Interface: vi.fn().mockImplementation(() => mockInterface),
    parseUnits: vi.fn().mockImplementation((value, unit) => {
      if (unit === 'gwei') {
        return BigInt(value) * BigInt('1000000000');
      }
      return BigInt(value);
    }),
  };
});

describe('UnsignedTransactionJsonService', () => {
  let service: UnsignedTransactionJsonService;
  let tempDir: string;
  let jsonPath: string;
  const contractAddress = '0x79D5046e34D4A56D357E12636A18da6eaEfe0586';
  const rpcUrl = 'https://polygon-rpc.com';
  const userAddress = '0x742d35Cc6634C0532925a3b844Bc9e7595f89ce0';

  beforeEach(async () => {
    // Create unique temporary directory for each test
    tempDir = join(
      tmpdir(),
      `unsigned-tx-json-test-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    );
    await mkdir(tempDir, { recursive: true });

    jsonPath = join(tempDir, 'unsigned-transactions.json');
    service = new UnsignedTransactionJsonService(
      jsonPath,
      contractAddress,
      30, // gasPrice in gwei
      137, // Polygon chainId
      0 // starting nonce
    );
  });

  afterEach(async () => {
    // Clean up JSON file and temp directory
    try {
      if (existsSync(jsonPath)) await unlink(jsonPath);
      if (existsSync(tempDir)) {
        await unlink(tempDir).catch(() => {
          // Directory might have other files, try rmdir
          const { rmdir } = require('fs/promises');
          return rmdir(tempDir, { recursive: true }).catch(() => {
            // Ignore cleanup errors in tests
          });
        });
      }
    } catch (error) {
      // Ignore cleanup errors in tests
    }
  });

  describe('generateUnsignedTransactionsJson', () => {
    it('should generate JSON with unsigned transactions for numeric gas pricing (converted to EIP-1559)', async () => {
      const testData: DataItem[] = [
        {
          propertyCid: 'QmPropertyCid1',
          dataGroupCID: 'QmDataGroupCid1',
          dataCID: 'QmDataCid1',
        },
        {
          propertyCid: 'QmPropertyCid2',
          dataGroupCID: 'QmDataGroupCid2',
          dataCID: 'QmDataCid2',
        },
      ];

      const batches = [testData];

      await service.generateUnsignedTransactionsJson(
        batches,
        rpcUrl,
        userAddress
      );

      // Check that file exists
      expect(existsSync(jsonPath)).toBe(true);

      // Read and verify JSON content
      const jsonContent = await readFile(jsonPath, 'utf-8');
      const transactions = JSON.parse(jsonContent);

      // Should have one transaction
      expect(Array.isArray(transactions)).toBe(true);
      expect(transactions).toHaveLength(1);

      const transaction = transactions[0];
      expect(transaction.from).toBe(userAddress);
      expect(transaction.to).toBe(contractAddress);
      expect(transaction.gas).toMatch(/^0x[a-fA-F0-9]+$/); // hex-encoded gas limit
      expect(transaction.value).toBe('0x0');
      expect(transaction.data).toMatch(/^0x[a-fA-F0-9]+$/); // encoded function data
      expect(transaction.nonce).toMatch(/^0x[a-fA-F0-9]+$/); // hex-encoded nonce
      expect(transaction.type).toBe('0x2'); // Always EIP-1559 transaction
      expect(transaction.gasPrice).toBeUndefined(); // No gasPrice for EIP-1559
      expect(transaction.maxFeePerGas).toMatch(/^0x[a-fA-F0-9]+$/); // hex-encoded max fee
      expect(transaction.maxPriorityFeePerGas).toMatch(/^0x[a-fA-F0-9]+$/); // hex-encoded priority fee
    });

    it('should generate JSON with unsigned transactions for auto gas pricing (EIP-1559)', async () => {
      // Create service with auto gas pricing
      const serviceAuto = new UnsignedTransactionJsonService(
        jsonPath,
        contractAddress,
        'auto',
        137,
        0
      );

      const testData: DataItem[] = [
        {
          propertyCid: 'QmPropertyCid1',
          dataGroupCID: 'QmDataGroupCid1',
          dataCID: 'QmDataCid1',
        },
      ];

      const batches = [testData];

      await serviceAuto.generateUnsignedTransactionsJson(
        batches,
        rpcUrl,
        userAddress
      );

      const jsonContent = await readFile(jsonPath, 'utf-8');
      const transactions = JSON.parse(jsonContent);
      const transaction = transactions[0];

      expect(transaction.gasPrice).toBeUndefined(); // No gasPrice for EIP-1559
      expect(transaction.maxFeePerGas).toMatch(/^0x[a-fA-F0-9]+$/); // hex-encoded max fee
      expect(transaction.maxPriorityFeePerGas).toMatch(/^0x[a-fA-F0-9]+$/); // hex-encoded priority fee
      expect(transaction.type).toBe('0x2'); // EIP-1559 transaction
    }, { timeout: 60000 });

    it('should handle multiple batches correctly', async () => {
      const batch1: DataItem[] = [
        {
          propertyCid: 'QmPropertyCid1',
          dataGroupCID: 'QmDataGroupCid1',
          dataCID: 'QmDataCid1',
        },
      ];

      const batch2: DataItem[] = [
        {
          propertyCid: 'QmPropertyCid2',
          dataGroupCID: 'QmDataGroupCid2',
          dataCID: 'QmDataCid2',
        },
      ];

      const batches = [batch1, batch2];

      await service.generateUnsignedTransactionsJson(
        batches,
        rpcUrl,
        userAddress
      );

      const jsonContent = await readFile(jsonPath, 'utf-8');
      const transactions = JSON.parse(jsonContent);

      expect(transactions).toHaveLength(2); // 2 batches = 2 transactions

      // Check first transaction
      expect(transactions[0].nonce).toBe('0x0'); // nonce from provider (0)
      // Check second transaction
      expect(transactions[1].nonce).toBe('0x1'); // incremented nonce (1)
    }, { timeout: 30000 });

    it('should handle empty batches array', async () => {
      const batches: DataItem[][] = [];

      await service.generateUnsignedTransactionsJson(
        batches,
        rpcUrl,
        userAddress
      );

      const jsonContent = await readFile(jsonPath, 'utf-8');
      const transactions = JSON.parse(jsonContent);

      // Should be empty array
      expect(Array.isArray(transactions)).toBe(true);
      expect(transactions).toHaveLength(0);
    });

    it('should create directories if they do not exist', async () => {
      const nestedPath = join(
        tempDir,
        'nested',
        'deep',
        'unsigned-transactions.json'
      );
      const nestedService = new UnsignedTransactionJsonService(
        nestedPath,
        contractAddress,
        30,
        137,
        0
      );

      const testData: DataItem[] = [
        {
          propertyCid: 'QmPropertyCid1',
          dataGroupCID: 'QmDataGroupCid1',
          dataCID: 'QmDataCid1',
        },
      ];

      const batches = [testData];

      await nestedService.generateUnsignedTransactionsJson(
        batches,
        rpcUrl,
        userAddress
      );

      expect(existsSync(nestedPath)).toBe(true);

      // Cleanup
      await unlink(nestedPath).catch(() => {});
    });
  });

  describe('gas estimation behavior', () => {
    it('should use eth_estimateGas with 30% buffer when estimation succeeds', async () => {
      const testData: DataItem[] = [
        {
          propertyCid: 'QmPropertyCid1',
          dataGroupCID: 'QmDataGroupCid1',
          dataCID: 'QmDataCid1',
        },
      ];

      const batches = [testData];

      await service.generateUnsignedTransactionsJson(
        batches,
        rpcUrl,
        userAddress
      );

      const jsonContent = await readFile(jsonPath, 'utf-8');
      const transactions = JSON.parse(jsonContent);
      const transaction = transactions[0];

      // The actual gas limit should be a hex-encoded value
      expect(transaction.gas).toMatch(/^0x[a-fA-F0-9]+$/);

      // Convert back to decimal to verify it's reasonable
      const gasLimitDecimal = parseInt(transaction.gas, 16);
      expect(gasLimitDecimal).toBeGreaterThan(300000); // Should be higher than base estimate
      expect(gasLimitDecimal).toBeLessThan(1000000); // Should be reasonable upper bound
    });

    it('should use fallback gas when estimation fails', async () => {
      // Create service with a provider that will fail gas estimation
      const testService = new UnsignedTransactionJsonService(
        jsonPath,
        contractAddress,
        30,
        137,
        0
      );

      const testData: DataItem[] = [
        {
          propertyCid: 'QmPropertyCid1',
          dataGroupCID: 'QmDataGroupCid1',
          dataCID: 'QmDataCid1',
        },
      ];

      const batches = [testData];

      // Use invalid RPC URL to trigger fallback
      await testService.generateUnsignedTransactionsJson(
        batches,
        'invalid-rpc-url',
        userAddress
      );

      const jsonContent = await readFile(jsonPath, 'utf-8');
      const transactions = JSON.parse(jsonContent);
      const transaction = transactions[0];

      // Should use fallback gas limit of 650000 (0x9eb10)
      expect(transaction.gas).toBe('0x9eb10');
    });
  });
});
