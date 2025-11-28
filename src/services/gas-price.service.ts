import { ethers } from 'ethers';
import { logger } from '../utils/logger.js';

export interface GasPriceInfo {
  legacy?: {
    gasPrice: string; // in Gwei
  };
  eip1559?: {
    maxFeePerGas: string; // in Gwei
    maxPriorityFeePerGas: string; // in Gwei
    baseFeePerGas?: string; // in Gwei
  };
  blockNumber?: number;
}

export class GasPriceService {
  private provider: ethers.JsonRpcProvider;

  constructor(rpcUrl: string) {
    this.provider = new ethers.JsonRpcProvider(rpcUrl);
    logger.technical(`Gas price service initialized with RPC: ${rpcUrl}`);
  }

  async getGasPrice(): Promise<GasPriceInfo> {
    const feeData = await this.provider.getFeeData();
    const block = await this.provider.getBlock('latest');

    const result: GasPriceInfo = {};

    if (feeData.gasPrice) {
      result.legacy = {
        gasPrice: ethers.formatUnits(feeData.gasPrice, 'gwei'),
      };
    }

    if (feeData.maxFeePerGas && feeData.maxPriorityFeePerGas) {
      result.eip1559 = {
        maxFeePerGas: ethers.formatUnits(feeData.maxFeePerGas, 'gwei'),
        maxPriorityFeePerGas: ethers.formatUnits(
          feeData.maxPriorityFeePerGas,
          'gwei'
        ),
      };

      if (block && block.baseFeePerGas) {
        result.eip1559.baseFeePerGas = ethers.formatUnits(
          block.baseFeePerGas,
          'gwei'
        );
      }
    }

    if (block) {
      result.blockNumber = block.number;
    }

    return result;
  }
}
