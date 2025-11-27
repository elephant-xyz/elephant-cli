import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  transform,
  TransformOptions,
  checkGasPrice,
  CheckGasPriceOptions,
} from '../../../src/lib/commands.js';

// Mock the transform handler to avoid actual execution
vi.mock('../../../src/commands/transform/index.js', () => ({
  handleTransform: vi.fn().mockResolvedValue(undefined),
}));

// Mock the gas price service
vi.mock('../../../src/services/gas-price.service.js', () => ({
  GasPriceService: vi.fn(),
}));

describe('Library Commands', () => {
  describe('transform', () => {
    it('should accept dataGroup option in TransformOptions interface', () => {
      // Test that the interface includes dataGroup
      const options: TransformOptions = {
        inputZip: 'test-input.zip',
        dataGroup: 'Property Improvement',
        scriptsZip: 'test-scripts.zip',
        outputZip: 'test-output.zip',
      };

      expect(options.dataGroup).toBe('Property Improvement');
      expect(options.inputZip).toBe('test-input.zip');
      expect(options.scriptsZip).toBe('test-scripts.zip');
      expect(options.outputZip).toBe('test-output.zip');
    });

    it('should pass dataGroup option to CLI implementation', async () => {
      const { handleTransform } = await import(
        '../../../src/commands/transform/index.js'
      );

      await transform({
        inputZip: 'test-input.zip',
        dataGroup: 'Property Improvement',
        scriptsZip: 'test-scripts.zip',
        outputZip: 'test-output.zip',
      });

      // Verify that handleTransform was called with dataGroup option
      expect(handleTransform).toHaveBeenCalledWith(
        expect.objectContaining({
          dataGroup: 'Property Improvement',
          inputZip: 'test-input.zip',
          scriptsZip: 'test-scripts.zip',
          outputZip: expect.stringContaining('test-output.zip'),
          silent: true,
        })
      );
    });

    it('should work without dataGroup option (County mode)', async () => {
      const { handleTransform } = await import(
        '../../../src/commands/transform/index.js'
      );

      await transform({
        inputZip: 'test-input.zip',
        scriptsZip: 'test-scripts.zip',
        outputZip: 'test-output.zip',
      });

      // Verify that handleTransform was called without dataGroup (defaults to County)
      expect(handleTransform).toHaveBeenCalledWith(
        expect.objectContaining({
          inputZip: 'test-input.zip',
          scriptsZip: 'test-scripts.zip',
          outputZip: expect.stringContaining('test-output.zip'),
          silent: true,
        })
      );
    });
  });

  describe('checkGasPrice', () => {
    let mockGasPriceService: any;
    let GasPriceServiceMock: any;

    beforeEach(async () => {
      const module = await import('../../../src/services/gas-price.service.js');
      GasPriceServiceMock = module.GasPriceService;

      mockGasPriceService = {
        getGasPrice: vi.fn().mockResolvedValue({
          blockNumber: 12345,
          legacy: {
            gasPrice: '30.5',
          },
          eip1559: {
            maxFeePerGas: '50.2',
            maxPriorityFeePerGas: '2.1',
            baseFeePerGas: '30.0',
          },
        }),
      };

      vi.mocked(GasPriceServiceMock).mockImplementation(
        () => mockGasPriceService
      );
    });

    it('should accept CheckGasPriceOptions interface', () => {
      const options: CheckGasPriceOptions = {
        rpcUrl: 'https://custom-rpc.com',
      };

      expect(options.rpcUrl).toBe('https://custom-rpc.com');
    });

    it('should work without options (uses default RPC)', async () => {
      const result = await checkGasPrice();

      expect(result.blockNumber).toBe(12345);
      expect(result.legacy?.gasPrice).toBe('30.5');
      expect(result.eip1559?.maxFeePerGas).toBe('50.2');
      expect(GasPriceServiceMock).toHaveBeenCalled();
    });

    it('should use custom RPC URL when provided', async () => {
      await checkGasPrice({
        rpcUrl: 'https://custom-rpc.com',
      });

      expect(GasPriceServiceMock).toHaveBeenCalledWith(
        'https://custom-rpc.com'
      );
    });

    it('should return gas price information', async () => {
      const result = await checkGasPrice();

      expect(result).toHaveProperty('blockNumber');
      expect(result).toHaveProperty('legacy');
      expect(result).toHaveProperty('eip1559');
      expect(result.legacy).toHaveProperty('gasPrice');
      expect(result.eip1559).toHaveProperty('maxFeePerGas');
      expect(result.eip1559).toHaveProperty('maxPriorityFeePerGas');
    });

    it('should handle missing legacy gas price', async () => {
      mockGasPriceService.getGasPrice.mockResolvedValue({
        blockNumber: 12345,
        eip1559: {
          maxFeePerGas: '50.2',
          maxPriorityFeePerGas: '2.1',
        },
      });

      const result = await checkGasPrice();

      expect(result.legacy).toBeUndefined();
      expect(result.eip1559).toBeDefined();
    });

    it('should handle missing EIP-1559 gas price', async () => {
      mockGasPriceService.getGasPrice.mockResolvedValue({
        blockNumber: 12345,
        legacy: {
          gasPrice: '30.5',
        },
      });

      const result = await checkGasPrice();

      expect(result.eip1559).toBeUndefined();
      expect(result.legacy).toBeDefined();
    });
  });
});
