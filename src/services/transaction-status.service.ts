import { ethers, TransactionReceipt } from 'ethers';
import { TransactionStatus } from '../types/submit.types.js';
import { logger } from '../utils/logger.js';

export class TransactionStatusService {
  private provider: ethers.JsonRpcProvider;
  private pollingInterval: number = 2000; // 2 seconds
  private maxPollingTime: number = 15 * 60 * 1000; // 15 minutes

  constructor(rpcUrl: string) {
    this.provider = new ethers.JsonRpcProvider(rpcUrl);
    logger.technical(
      `Transaction status service initialized with RPC: ${rpcUrl}`
    );
  }

  /**
   * Wait for a transaction to be confirmed on the blockchain
   */
  async waitForTransaction(
    txHash: string,
    timeout: number = this.maxPollingTime
  ): Promise<TransactionStatus> {
    const startTime = Date.now();
    logger.info(`Waiting for transaction ${txHash} to be confirmed...`);

    while (Date.now() - startTime < timeout) {
      try {
        // Check if transaction exists
        const tx = await this.provider.getTransaction(txHash);

        if (!tx) {
          // Transaction not found yet, continue polling
          await new Promise((resolve) =>
            setTimeout(resolve, this.pollingInterval)
          );
          continue;
        }

        // Transaction found, wait for receipt
        const receipt: TransactionReceipt | null =
          await this.provider.getTransactionReceipt(txHash);

        if (receipt) {
          const status: TransactionStatus = {
            hash: txHash,
            status: receipt.status === 1 ? 'success' : 'failed',
            blockNumber: receipt.blockNumber,
            gasUsed: receipt.gasUsed.toString(),
          };

          if (receipt.status === 0) {
            status.error = 'Transaction reverted by EVM';
          }

          logger.info(
            `Transaction ${txHash} confirmed in block ${receipt.blockNumber} with status: ${status.status}`
          );

          return status;
        }

        // Transaction exists but no receipt yet, continue polling
        await new Promise((resolve) =>
          setTimeout(resolve, this.pollingInterval)
        );
      } catch (error) {
        logger.warn(
          `Error checking transaction status: ${error instanceof Error ? error.message : String(error)}`
        );
        // Continue polling on error
        await new Promise((resolve) =>
          setTimeout(resolve, this.pollingInterval)
        );
      }
    }

    // Timeout reached
    logger.error(
      `Transaction ${txHash} confirmation timeout after ${timeout / 1000}s`
    );
    return {
      hash: txHash,
      status: 'pending',
      error: `Transaction confirmation timeout after ${timeout / 1000}s`,
    };
  }

  /**
   * Wait for multiple transactions in parallel
   */
  async waitForMultipleTransactions(
    txHashes: string[],
    onProgress?: (completed: number, total: number) => void
  ): Promise<TransactionStatus[]> {
    logger.info(
      `Waiting for ${txHashes.length} transactions to be confirmed...`
    );

    let completed = 0;
    const results = await Promise.all(
      txHashes.map(async (txHash) => {
        const status = await this.waitForTransaction(txHash);
        completed++;
        if (onProgress) {
          onProgress(completed, txHashes.length);
        }
        return status;
      })
    );

    return results;
  }
}
