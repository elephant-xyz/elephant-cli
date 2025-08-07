import { createWriteStream, WriteStream } from 'fs';
import { dirname } from 'path';
import { mkdir } from 'fs/promises';
import { ConsensusAnalysis } from '../types/index.js';
import { logger } from '../utils/logger.js';

export class ConsensusReporterService {
  private writeStream: WriteStream | null = null;
  private headerWritten = false;
  private submitterColumns: string[] = [];

  constructor(private outputPath: string) {}

  public async initialize(allSubmitters: Set<string>): Promise<void> {
    // Ensure directory exists
    await mkdir(dirname(this.outputPath), { recursive: true });

    this.writeStream = createWriteStream(this.outputPath);
    this.submitterColumns = Array.from(allSubmitters).sort();

    // Write CSV header
    const headers = [
      'propertyHash',
      'dataGroupHash',
      'consensusReached',
      'consensusDataHash',
      'consensusDataCid',
      'totalSubmitters',
      'uniqueDataHashes',
      ...this.submitterColumns,
    ];

    this.writeStream.write(headers.join(',') + '\n');
    this.headerWritten = true;

    logger.debug(
      `CSV reporter initialized with ${this.submitterColumns.length} submitter columns`
    );
  }

  public async writeAnalysis(analysisData: ConsensusAnalysis[]): Promise<void> {
    if (!this.headerWritten || !this.writeStream) {
      throw new Error('CSV reporter must be initialized before writing');
    }

    for (const analysis of analysisData) {
      const row = this.formatRow(analysis);
      this.writeStream.write(row + '\n');
    }
  }

  private formatRow(analysis: ConsensusAnalysis): string {
    const baseFields = [
      analysis.propertyHash,
      analysis.dataGroupHash,
      analysis.consensusReached === true
        ? 'true'
        : analysis.consensusReached === 'partial'
          ? 'partial'
          : 'false',
      analysis.consensusDataHash || '',
      analysis.consensusDataCid || '',
      analysis.totalSubmitters.toString(),
      analysis.uniqueDataHashes.toString(),
    ];

    // Add submitter columns
    const submitterFields = this.submitterColumns.map((submitter) => {
      // Find which dataHash this submitter submitted
      for (const [dataHash, submitters] of analysis.submissionsByDataHash) {
        if (submitters.includes(submitter)) {
          return dataHash;
        }
      }
      return '-';
    });

    return [...baseFields, ...submitterFields]
      .map((field) => this.escapeCSV(field))
      .join(',');
  }

  private escapeCSV(field: string): string {
    // Escape fields that contain commas, quotes, or newlines
    if (field.includes(',') || field.includes('"') || field.includes('\n')) {
      return `"${field.replace(/"/g, '""')}"`;
    }
    return field;
  }

  public async close(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.writeStream) {
        resolve();
        return;
      }

      this.writeStream.end();

      this.writeStream.on('finish', () => {
        logger.info(`CSV report written to ${this.outputPath}`);
        resolve();
      });

      this.writeStream.on('error', (error) => {
        logger.error(`Error writing CSV: ${error}`);
        reject(error);
      });
    });
  }

  // Static method for one-shot CSV generation (non-streaming)
  public static async generateCSV(
    analysisData: ConsensusAnalysis[],
    outputPath: string
  ): Promise<void> {
    // Collect all unique submitters
    const allSubmitters = new Set<string>();
    for (const analysis of analysisData) {
      for (const submitters of analysis.submissionsByDataHash.values()) {
        submitters.forEach((s) => allSubmitters.add(s));
      }
    }

    const reporter = new ConsensusReporterService(outputPath);
    await reporter.initialize(allSubmitters);
    await reporter.writeAnalysis(analysisData);
    await reporter.close();
  }
}
