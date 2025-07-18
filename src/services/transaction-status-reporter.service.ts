import { createWriteStream, WriteStream } from 'fs';
import { dirname } from 'path';
import { mkdir } from 'fs/promises';
import { TransactionStatusEntry } from '../types/submit.types.js';
import { logger } from '../utils/logger.js';

export class TransactionStatusReporterService {
  private csvPath: string;
  private writeStream?: WriteStream;
  private hasWrittenHeader: boolean = false;

  constructor(csvPath: string) {
    this.csvPath = csvPath;
  }

  async initialize(): Promise<void> {
    try {
      // Ensure directory exists
      await mkdir(dirname(this.csvPath), { recursive: true });

      // Create write stream
      this.writeStream = createWriteStream(this.csvPath, { flags: 'w' });

      // Write CSV header
      const header =
        'batchIndex,transactionHash,status,blockNumber,gasUsed,itemCount,error,timestamp\n';
      this.writeStream.write(header);
      this.hasWrittenHeader = true;

      logger.technical(
        `Transaction status CSV initialized at: ${this.csvPath}`
      );
    } catch (error) {
      const errorMsg = `Failed to initialize transaction status CSV: ${
        error instanceof Error ? error.message : String(error)
      }`;
      logger.error(errorMsg);
      throw new Error(errorMsg);
    }
  }

  async logTransaction(entry: TransactionStatusEntry): Promise<void> {
    if (!this.writeStream || !this.hasWrittenHeader) {
      throw new Error('TransactionStatusReporterService not initialized');
    }

    const row = [
      entry.batchIndex,
      entry.transactionHash,
      entry.status,
      entry.blockNumber || '',
      entry.gasUsed || '',
      entry.itemCount,
      entry.error ? `"${entry.error.replace(/"/g, '""')}"` : '',
      entry.timestamp,
    ].join(',');

    this.writeStream.write(row + '\n');
  }

  async finalize(): Promise<void> {
    if (this.writeStream) {
      await new Promise<void>((resolve, reject) => {
        this.writeStream!.end((error: Error | null | undefined) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      });
      logger.technical(`Transaction status CSV finalized at: ${this.csvPath}`);
    }
  }
}
