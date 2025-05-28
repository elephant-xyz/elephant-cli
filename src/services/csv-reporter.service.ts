import { createWriteStream, WriteStream } from 'fs';
import { dirname } from 'path';
import { mkdir } from 'fs/promises';
import {
  ErrorEntry,
  WarningEntry,
  ReportSummary,
} from '../types/submit.types.js';

export class CsvReporterService {
  private errorStream: WriteStream | null = null;
  private warningStream: WriteStream | null = null;
  private errorCount = 0;
  private warningCount = 0;
  private startTime: Date;

  constructor(
    private errorCsvPath: string,
    private warningCsvPath: string
  ) {
    this.startTime = new Date();
  }

  async initialize(): Promise<void> {
    await this.ensureDirectoriesExist();
    await this.initializeStreams();
  }

  private async ensureDirectoriesExist(): Promise<void> {
    const errorDir = dirname(this.errorCsvPath);
    const warningDir = dirname(this.warningCsvPath);

    await mkdir(errorDir, { recursive: true });
    if (warningDir !== errorDir) {
      await mkdir(warningDir, { recursive: true });
    }
  }

  private async initializeStreams(): Promise<void> {
    // Initialize error CSV stream
    this.errorStream = createWriteStream(this.errorCsvPath, { flags: 'w' });
    this.errorStream.write(
      'property_cid,data_group_cid,file_path,error,timestamp\n'
    );

    // Initialize warning CSV stream
    this.warningStream = createWriteStream(this.warningCsvPath, { flags: 'w' });
    this.warningStream.write(
      'property_cid,data_group_cid,file_path,reason,timestamp\n'
    );

    // Wait for streams to be ready
    await Promise.all([
      new Promise<void>((resolve) => {
        if (this.errorStream?.writable) {
          this.errorStream.once('ready', resolve);
        } else {
          resolve();
        }
      }),
      new Promise<void>((resolve) => {
        if (this.warningStream?.writable) {
          this.warningStream.once('ready', resolve);
        } else {
          resolve();
        }
      }),
    ]);
  }

  async logError(entry: ErrorEntry): Promise<void> {
    if (!this.errorStream) {
      throw new Error('CSV reporter not initialized. Call initialize() first.');
    }

    const escapedError = this.escapeCsvValue(entry.error);
    const escapedFilePath = this.escapeCsvValue(entry.filePath);

    const csvLine = `${entry.propertyCid},${entry.dataGroupCid},${escapedFilePath},${escapedError},${entry.timestamp}\n`;

    return new Promise((resolve, reject) => {
      this.errorStream!.write(csvLine, (error) => {
        if (error) {
          reject(error);
        } else {
          this.errorCount++;
          resolve();
        }
      });
    });
  }

  async logWarning(entry: WarningEntry): Promise<void> {
    if (!this.warningStream) {
      throw new Error('CSV reporter not initialized. Call initialize() first.');
    }

    const escapedReason = this.escapeCsvValue(entry.reason);
    const escapedFilePath = this.escapeCsvValue(entry.filePath);

    const csvLine = `${entry.propertyCid},${entry.dataGroupCid},${escapedFilePath},${escapedReason},${entry.timestamp}\n`;

    return new Promise((resolve, reject) => {
      this.warningStream!.write(csvLine, (error) => {
        if (error) {
          reject(error);
        } else {
          this.warningCount++;
          resolve();
        }
      });
    });
  }

  private escapeCsvValue(value: string): string {
    // Escape double quotes by doubling them
    const escaped = value.replace(/"/g, '""');

    // Wrap in quotes if contains comma, newline, or quotes
    if (
      escaped.includes(',') ||
      escaped.includes('\n') ||
      escaped.includes('"')
    ) {
      return `"${escaped}"`;
    }

    return escaped;
  }

  async finalize(): Promise<ReportSummary> {
    const endTime = new Date();

    // Close streams
    await this.closeStreams();

    const summary: ReportSummary = {
      totalFiles: 0, // Will be set by caller
      processedFiles: 0, // Will be set by caller
      errorCount: this.errorCount,
      warningCount: this.warningCount,
      uploadedFiles: 0, // Will be set by caller
      submittedBatches: 0, // Will be set by caller
      startTime: this.startTime,
      endTime,
      duration: endTime.getTime() - this.startTime.getTime(),
    };

    return summary;
  }

  private async closeStreams(): Promise<void> {
    const promises: Promise<void>[] = [];

    if (this.errorStream) {
      promises.push(
        new Promise((resolve, reject) => {
          this.errorStream!.end((error) => {
            if (error) reject(error);
            else resolve();
          });
        })
      );
    }

    if (this.warningStream) {
      promises.push(
        new Promise((resolve, reject) => {
          this.warningStream!.end((error) => {
            if (error) reject(error);
            else resolve();
          });
        })
      );
    }

    await Promise.all(promises);
    this.errorStream = null;
    this.warningStream = null;
  }

  getErrorCount(): number {
    return this.errorCount;
  }

  getWarningCount(): number {
    return this.warningCount;
  }
}
