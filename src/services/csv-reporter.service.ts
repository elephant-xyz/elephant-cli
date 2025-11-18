import { createWriteStream, WriteStream } from 'fs';
import { dirname } from 'path';
import { mkdir } from 'fs/promises';
import {
  ErrorEntry,
  WarningEntry,
  ReportSummary,
} from '../types/submit.types.js';

interface CsvReporterServiceOptions {
  pathFormatter?: (filePath: string) => string;
}

export class CsvReporterService {
  private errorStream: WriteStream | null = null;
  private warningStream: WriteStream | null = null;
  private errorCount = 0;
  private warningCount = 0;
  private startTime: Date;
  private readonly options: CsvReporterServiceOptions;
  private readonly seenErrorKeys = new Set<string>();

  constructor(
    private errorCsvPath: string,
    private warningCsvPath: string,
    options: CsvReporterServiceOptions = {}
  ) {
    this.startTime = new Date();
    this.options = options;
  }

  async initialize(): Promise<void> {
    await this.ensureDirectoriesExist();
    // Initialize CSV streams and write headers, awaiting write completion
    this.errorStream = createWriteStream(this.errorCsvPath, { flags: 'w' });
    await new Promise<void>((resolve, reject) => {
      this.errorStream!.write(
        'property_cid,data_group_cid,file_path,error_path,error_message,currentValue,timestamp\n',
        (err?: Error | null) => (err ? reject(err) : resolve())
      );
    });
    this.warningStream = createWriteStream(this.warningCsvPath, { flags: 'w' });
    await new Promise<void>((resolve, reject) => {
      this.warningStream!.write(
        'property_cid,data_group_cid,file_path,reason,timestamp\n',
        (err?: Error | null) => (err ? reject(err) : resolve())
      );
    });
  }

  private async ensureDirectoriesExist(): Promise<void> {
    const errorDir = dirname(this.errorCsvPath);
    const warningDir = dirname(this.warningCsvPath);

    await mkdir(errorDir, { recursive: true });
    if (warningDir !== errorDir) {
      await mkdir(warningDir, { recursive: true });
    }
  }

  async logError(entry: ErrorEntry): Promise<void> {
    if (!this.errorStream) {
      throw new Error('CSV reporter not initialized. Call initialize() first.');
    }

    const formattedFilePath = this.formatFilePath(entry.filePath);
    const dedupeKey = [
      entry.propertyCid,
      entry.dataGroupCid,
      formattedFilePath,
      entry.errorPath,
      entry.errorMessage,
      entry.currentValue,
    ].join('|');
    if (this.seenErrorKeys.has(dedupeKey)) {
      return;
    }
    this.seenErrorKeys.add(dedupeKey);

    const escapedErrorPath = this.escapeCsvValue(entry.errorPath);
    const escapedErrorMessage = this.escapeCsvValue(entry.errorMessage);
    const escapedFilePath = this.escapeCsvValue(formattedFilePath);
    const escapedCurrentValue = this.escapeCsvValue(entry.currentValue);

    const csvLine = `${entry.propertyCid},${entry.dataGroupCid},${escapedFilePath},${escapedErrorPath},${escapedErrorMessage},${escapedCurrentValue},${entry.timestamp}\n`;

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
          this.errorStream!.end((error?: Error) => {
            if (error) reject(error);
            else resolve();
          });
        })
      );
    }

    if (this.warningStream) {
      promises.push(
        new Promise((resolve, reject) => {
          this.warningStream!.end((error?: Error) => {
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

  private formatFilePath(filePath: string): string {
    if (!this.options.pathFormatter) {
      return filePath;
    }
    try {
      const formatted = this.options.pathFormatter(filePath);
      return formatted || filePath;
    } catch {
      return filePath;
    }
  }
}
