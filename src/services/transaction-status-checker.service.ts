import pLimit, { type LimitFunction } from 'p-limit';
import { TransactionStatusService } from './transaction-status.service.js';
import { logger } from '../utils/logger.js';

export interface TransactionRecord {
  transactionHash: string;
  batchIndex: number;
  itemCount: number;
  timestamp: string;
  status: string;
}

export interface TransactionStatusResult extends TransactionRecord {
  blockNumber?: number;
  gasUsed?: string;
  checkTimestamp: string;
  error?: string;
}

export class TransactionStatusCheckerService {
  private statusService: TransactionStatusService;
  private limit: LimitFunction;

  constructor(rpcUrl: string, maxConcurrent: number = 10) {
    this.statusService = new TransactionStatusService(rpcUrl);
    this.limit = pLimit(maxConcurrent);
    logger.technical(
      `Transaction status checker initialized with max concurrent: ${maxConcurrent}`
    );
  }

  async checkTransactionStatuses(
    transactions: TransactionRecord[],
    onProgress?: (completed: number, total: number) => void
  ): Promise<TransactionStatusResult[]> {
    let completed = 0;

    const promises = transactions.map((record) =>
      this.limit(async () => {
        const status = await this.statusService.getTransactionStatus(
          record.transactionHash
        );

        completed++;
        onProgress?.(completed, transactions.length);

        return {
          ...record,
          status: status.status,
          blockNumber: status.blockNumber,
          gasUsed: status.gasUsed,
          checkTimestamp: new Date().toISOString(),
          error: status.error,
        };
      })
    );

    return Promise.all(promises);
  }
}
