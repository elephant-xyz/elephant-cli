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

    // Write CSV header with hash and CID columns for each submitter
    const headers = [
      'propertyHash',
      'dataGroupHash',
      'consensusReached',
      'totalSubmitters',
      'uniqueDataHashes',
    ];

    // Add hash and CID columns for each submitter
    for (const submitter of this.submitterColumns) {
      headers.push(submitter);
      headers.push(`${submitter}_cid`);
    }

    // Add difference analysis columns
    headers.push('totalDifferences');
    headers.push('differenceSummary');

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
      analysis.totalSubmitters.toString(),
      analysis.uniqueDataHashes.toString(),
    ];

    // Add submitter hash and CID columns
    const submitterFields: string[] = [];
    for (const submitter of this.submitterColumns) {
      const data = analysis.submitterData.get(submitter);
      if (data) {
        submitterFields.push(data.hash);
        submitterFields.push(data.cid || '-');
      } else {
        submitterFields.push('-');
        submitterFields.push('-');
      }
    }

    // Add difference analysis fields
    const differenceFields: string[] = [];
    if (analysis.comparisonResult) {
      differenceFields.push(
        analysis.comparisonResult.totalDifferences.toString()
      );
      // Format the summary for CSV - preserve structure but make it CSV-friendly
      // Keep newlines as | separators, but preserve the hierarchical information
      const summary = analysis.comparisonResult.summary
        .replace(/\n\n/g, ' || ') // Double newlines become double pipes
        .replace(/\n/g, ' | ') // Single newlines become single pipes
        .replace(/"/g, '""'); // Escape quotes for CSV
      differenceFields.push(summary);
    } else {
      differenceFields.push('-');
      differenceFields.push('-');
    }

    return [...baseFields, ...submitterFields, ...differenceFields]
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
