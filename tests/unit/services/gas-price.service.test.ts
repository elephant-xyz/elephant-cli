import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GasPriceService } from '../../../src/services/gas-price.service.js';

vi.mock('ethers', () => ({
  ethers: {
    JsonRpcProvider: vi.fn(),
    formatUnits: vi.fn((value, unit) => {
      if (unit === 'gwei') {
        return (Number(value) / 1e9).toString();
      }
      return value.toString();
    }),
  },
}));

describe('GasPriceService', () => {
  let service: GasPriceService;
  let mockProvider: any;

  beforeEach(async () => {
    vi.clearAllMocks();

    mockProvider = {
      getFeeData: vi.fn(),
      getBlock: vi.fn(),
    };

    const { ethers } = await import('ethers');
    vi.mocked(ethers.JsonRpcProvider).mockImplementation(
      () => mockProvider as any
    );

    service = new GasPriceService('https://rpc.test.com');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getGasPrice', () => {
    it('should return legacy gas price when available', async () => {
      mockProvider.getFeeData.mockResolvedValue({
        gasPrice: BigInt('30000000000'), // 30 Gwei
        maxFeePerGas: null,
        maxPriorityFeePerGas: null,
      });
      mockProvider.getBlock.mockResolvedValue({
        number: 12345,
        baseFeePerGas: null,
      });

      const result = await service.getGasPrice();

      expect(result.legacy).toBeDefined();
      expect(result.legacy?.gasPrice).toBe('30');
      expect(result.blockNumber).toBe(12345);
    });

    it('should return EIP-1559 gas prices when available', async () => {
      mockProvider.getFeeData.mockResolvedValue({
        gasPrice: null,
        maxFeePerGas: BigInt('50000000000'), // 50 Gwei
        maxPriorityFeePerGas: BigInt('2000000000'), // 2 Gwei
      });
      mockProvider.getBlock.mockResolvedValue({
        number: 12345,
        baseFeePerGas: BigInt('30000000000'), // 30 Gwei
      });

      const result = await service.getGasPrice();

      expect(result.eip1559).toBeDefined();
      expect(result.eip1559?.maxFeePerGas).toBe('50');
      expect(result.eip1559?.maxPriorityFeePerGas).toBe('2');
      expect(result.eip1559?.baseFeePerGas).toBe('30');
      expect(result.blockNumber).toBe(12345);
    });

    it('should return both legacy and EIP-1559 when both available', async () => {
      mockProvider.getFeeData.mockResolvedValue({
        gasPrice: BigInt('30000000000'), // 30 Gwei
        maxFeePerGas: BigInt('50000000000'), // 50 Gwei
        maxPriorityFeePerGas: BigInt('2000000000'), // 2 Gwei
      });
      mockProvider.getBlock.mockResolvedValue({
        number: 12345,
        baseFeePerGas: BigInt('30000000000'), // 30 Gwei
      });

      const result = await service.getGasPrice();

      expect(result.legacy).toBeDefined();
      expect(result.legacy?.gasPrice).toBe('30');
      expect(result.eip1559).toBeDefined();
      expect(result.eip1559?.maxFeePerGas).toBe('50');
      expect(result.eip1559?.maxPriorityFeePerGas).toBe('2');
      expect(result.eip1559?.baseFeePerGas).toBe('30');
    });

    it('should return block number when available', async () => {
      mockProvider.getFeeData.mockResolvedValue({
        gasPrice: BigInt('30000000000'),
        maxFeePerGas: null,
        maxPriorityFeePerGas: null,
      });
      mockProvider.getBlock.mockResolvedValue({
        number: 99999,
        baseFeePerGas: null,
      });

      const result = await service.getGasPrice();

      expect(result.blockNumber).toBe(99999);
    });

    it('should handle missing base fee per gas', async () => {
      mockProvider.getFeeData.mockResolvedValue({
        gasPrice: null,
        maxFeePerGas: BigInt('50000000000'),
        maxPriorityFeePerGas: BigInt('2000000000'),
      });
      mockProvider.getBlock.mockResolvedValue({
        number: 12345,
        baseFeePerGas: null,
      });

      const result = await service.getGasPrice();

      expect(result.eip1559).toBeDefined();
      expect(result.eip1559?.baseFeePerGas).toBeUndefined();
    });

    it('should handle null block', async () => {
      mockProvider.getFeeData.mockResolvedValue({
        gasPrice: BigInt('30000000000'),
        maxFeePerGas: null,
        maxPriorityFeePerGas: null,
      });
      mockProvider.getBlock.mockResolvedValue(null);

      const result = await service.getGasPrice();

      expect(result.legacy).toBeDefined();
      expect(result.blockNumber).toBeUndefined();
    });

    it('should return empty result when no gas data available', async () => {
      mockProvider.getFeeData.mockResolvedValue({
        gasPrice: null,
        maxFeePerGas: null,
        maxPriorityFeePerGas: null,
      });
      mockProvider.getBlock.mockResolvedValue({
        number: 12345,
        baseFeePerGas: null,
      });

      const result = await service.getGasPrice();

      expect(result.legacy).toBeUndefined();
      expect(result.eip1559).toBeUndefined();
      expect(result.blockNumber).toBe(12345);
    });
  });
});
