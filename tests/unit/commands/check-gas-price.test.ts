import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
import { registerCheckGasPriceCommand } from '../../../src/commands/check-gas-price.js';
import { GasPriceService } from '../../../src/services/gas-price.service.js';

vi.mock('../../../src/services/gas-price.service.js');
vi.mock('../../../src/utils/logger.js', () => ({
  logger: {
    technical: vi.fn(),
    error: vi.fn(),
  },
}));

describe('check-gas-price command', () => {
  let program: Command;
  let mockGasPriceService: any;
  let consoleLogSpy: any;
  let consoleErrorSpy: any;
  let processExitSpy: any;

  beforeEach(() => {
    vi.clearAllMocks();
    program = new Command();
    program.exitOverride();
    registerCheckGasPriceCommand(program);

    mockGasPriceService = {
      getGasPrice: vi.fn(),
    };
    vi.mocked(GasPriceService).mockImplementation(() => mockGasPriceService);

    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    processExitSpy.mockRestore();
  });

  it('should display legacy gas price', async () => {
    mockGasPriceService.getGasPrice.mockResolvedValue({
      legacy: {
        gasPrice: '30.5',
      },
      blockNumber: 12345,
    });

    await program.parseAsync(['node', 'test', 'check-gas-price']);

    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('Current Gas Prices')
    );
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('Legacy (Type 0) Transaction')
    );
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('30.5'));
  });

  it('should display EIP-1559 gas prices', async () => {
    mockGasPriceService.getGasPrice.mockResolvedValue({
      eip1559: {
        maxFeePerGas: '50.2',
        maxPriorityFeePerGas: '2.1',
        baseFeePerGas: '30.0',
      },
      blockNumber: 12345,
    });

    await program.parseAsync(['node', 'test', 'check-gas-price']);

    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('EIP-1559 (Type 2) Transaction')
    );
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('50.2'));
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('2.1'));
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('30.0'));
  });

  it('should display both legacy and EIP-1559 when available', async () => {
    mockGasPriceService.getGasPrice.mockResolvedValue({
      legacy: {
        gasPrice: '30.5',
      },
      eip1559: {
        maxFeePerGas: '50.2',
        maxPriorityFeePerGas: '2.1',
        baseFeePerGas: '30.0',
      },
      blockNumber: 12345,
    });

    await program.parseAsync(['node', 'test', 'check-gas-price']);

    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('Legacy (Type 0) Transaction')
    );
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('EIP-1559 (Type 2) Transaction')
    );
  });

  it('should display block number', async () => {
    mockGasPriceService.getGasPrice.mockResolvedValue({
      legacy: {
        gasPrice: '30.5',
      },
      blockNumber: 99999,
    });

    await program.parseAsync(['node', 'test', 'check-gas-price']);

    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('99999')
    );
  });

  it('should handle missing base fee per gas', async () => {
    mockGasPriceService.getGasPrice.mockResolvedValue({
      eip1559: {
        maxFeePerGas: '50.2',
        maxPriorityFeePerGas: '2.1',
      },
      blockNumber: 12345,
    });

    await program.parseAsync(['node', 'test', 'check-gas-price']);

    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('EIP-1559 (Type 2) Transaction')
    );
    expect(consoleLogSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('Base Fee Per Gas')
    );
  });

  it('should display warning when no gas data available', async () => {
    mockGasPriceService.getGasPrice.mockResolvedValue({
      blockNumber: 12345,
    });

    await program.parseAsync(['node', 'test', 'check-gas-price']);

    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('No gas price data available')
    );
  });

  it('should use custom RPC URL', async () => {
    mockGasPriceService.getGasPrice.mockResolvedValue({
      legacy: {
        gasPrice: '30.5',
      },
      blockNumber: 12345,
    });

    await program.parseAsync([
      'node',
      'test',
      'check-gas-price',
      '--rpc-url',
      'https://custom-rpc.com',
    ]);

    expect(GasPriceService).toHaveBeenCalledWith('https://custom-rpc.com');
  });

  it('should handle errors gracefully', async () => {
    mockGasPriceService.getGasPrice.mockRejectedValue(
      new Error('Network error')
    );

    try {
      await program.parseAsync(['node', 'test', 'check-gas-price']);
    } catch (error) {
      // Expected to throw due to process.exit mock
    }

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Network error')
    );
    expect(processExitSpy).toHaveBeenCalledWith(1);
  });

  it('should show completion message', async () => {
    mockGasPriceService.getGasPrice.mockResolvedValue({
      legacy: {
        gasPrice: '30.5',
      },
      blockNumber: 12345,
    });

    await program.parseAsync(['node', 'test', 'check-gas-price']);

    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('Gas price check complete')
    );
  });
});
