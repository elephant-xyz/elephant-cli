import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ConsensusReporterService } from '../../../src/services/consensus-reporter.service.js';
import { ConsensusAnalysis } from '../../../src/types/index.js';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

// Mock logger
vi.mock('../../../src/utils/logger.js', () => ({
  logger: {
    error: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

describe('ConsensusReporterService', () => {
  let tempDir: string;
  let outputPath: string;

  beforeEach(async () => {
    // Create a temporary directory for test files
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'consensus-test-'));
    outputPath = path.join(tempDir, 'test-output.csv');
  });

  afterEach(async () => {
    // Clean up temporary directory
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe('generateCSV', () => {
    it('should generate a CSV file with correct headers and data', async () => {
      const analysisData: ConsensusAnalysis[] = [
        {
          propertyHash: '0xprop1',
          dataGroupHash: '0xgroup1',
          consensusReached: true,
          consensusDataHash: '0xdata1',
          submissionsByDataHash: new Map([
            ['0xdata1', ['0xsubmitter1', '0xsubmitter2']],
            ['0xdata2', ['0xsubmitter3']],
          ]),
          totalSubmitters: 3,
          uniqueDataHashes: 2,
        },
        {
          propertyHash: '0xprop2',
          dataGroupHash: '0xgroup2',
          consensusReached: false,
          consensusDataHash: undefined,
          submissionsByDataHash: new Map([
            ['0xdata3', ['0xsubmitter1']],
            ['0xdata4', ['0xsubmitter2', '0xsubmitter3']],
          ]),
          totalSubmitters: 3,
          uniqueDataHashes: 2,
        },
      ];

      await ConsensusReporterService.generateCSV(analysisData, outputPath);

      // Read and verify the generated CSV
      const csvContent = await fs.readFile(outputPath, 'utf-8');
      const lines = csvContent.trim().split('\n');

      // Check header
      expect(lines[0]).toBe(
        'propertyHash,dataGroupHash,consensusReached,consensusDataHash,totalSubmitters,uniqueDataHashes,0xsubmitter1,0xsubmitter2,0xsubmitter3'
      );

      // Check first data row
      expect(lines[1]).toBe(
        '0xprop1,0xgroup1,true,0xdata1,3,2,0xdata1,0xdata1,0xdata2'
      );

      // Check second data row
      expect(lines[2]).toBe(
        '0xprop2,0xgroup2,false,,3,2,0xdata3,0xdata4,0xdata4'
      );
    });

    it('should handle empty analysis data', async () => {
      const analysisData: ConsensusAnalysis[] = [];

      await ConsensusReporterService.generateCSV(analysisData, outputPath);

      const csvContent = await fs.readFile(outputPath, 'utf-8');
      const lines = csvContent.trim().split('\n');

      // Should only have header
      expect(lines.length).toBe(1);
      expect(lines[0]).toBe(
        'propertyHash,dataGroupHash,consensusReached,consensusDataHash,totalSubmitters,uniqueDataHashes'
      );
    });

    it('should escape CSV fields with special characters', async () => {
      const analysisData: ConsensusAnalysis[] = [
        {
          propertyHash: '0xprop,with,commas',
          dataGroupHash: '0xgroup"with"quotes',
          consensusReached: true,
          consensusDataHash: '0xdata\nwith\nnewlines',
          submissionsByDataHash: new Map([
            ['0xdata,special', ['0xsubmitter1']],
          ]),
          totalSubmitters: 1,
          uniqueDataHashes: 1,
        },
      ];

      await ConsensusReporterService.generateCSV(analysisData, outputPath);

      const csvContent = await fs.readFile(outputPath, 'utf-8');
      const lines = csvContent.trim().split('\n');

      // Check that special characters are properly escaped
      expect(lines[1]).toContain('"0xprop,with,commas"');
      expect(lines[1]).toContain('"0xgroup""with""quotes"');
      // The newline in the CSV will be literal, not escaped
      expect(csvContent).toContain('0xdata\nwith\nnewlines');
    });
  });

  describe('streaming functionality', () => {
    it('should support incremental writing', async () => {
      const reporter = new ConsensusReporterService(outputPath);

      // Initialize with submitters
      await reporter.initialize(new Set(['0xsubmitter1', '0xsubmitter2']));

      // Write first batch
      const batch1: ConsensusAnalysis[] = [
        {
          propertyHash: '0xprop1',
          dataGroupHash: '0xgroup1',
          consensusReached: true,
          consensusDataHash: '0xdata1',
          submissionsByDataHash: new Map([
            ['0xdata1', ['0xsubmitter1', '0xsubmitter2']],
          ]),
          totalSubmitters: 2,
          uniqueDataHashes: 1,
        },
      ];
      await reporter.writeAnalysis(batch1);

      // Write second batch
      const batch2: ConsensusAnalysis[] = [
        {
          propertyHash: '0xprop2',
          dataGroupHash: '0xgroup2',
          consensusReached: false,
          consensusDataHash: undefined,
          submissionsByDataHash: new Map([
            ['0xdata2', ['0xsubmitter1']],
            ['0xdata3', ['0xsubmitter2']],
          ]),
          totalSubmitters: 2,
          uniqueDataHashes: 2,
        },
      ];
      await reporter.writeAnalysis(batch2);

      // Close the reporter
      await reporter.close();

      // Verify the file contains both batches
      const csvContent = await fs.readFile(outputPath, 'utf-8');
      const lines = csvContent.trim().split('\n');

      expect(lines.length).toBe(3); // Header + 2 data rows
      expect(lines[1]).toContain('0xprop1');
      expect(lines[2]).toContain('0xprop2');
    });

    it('should throw error if writing before initialization', async () => {
      const reporter = new ConsensusReporterService(outputPath);

      const data: ConsensusAnalysis[] = [
        {
          propertyHash: '0xprop1',
          dataGroupHash: '0xgroup1',
          consensusReached: true,
          consensusDataHash: '0xdata1',
          submissionsByDataHash: new Map(),
          totalSubmitters: 0,
          uniqueDataHashes: 0,
        },
      ];

      await expect(reporter.writeAnalysis(data)).rejects.toThrow(
        'CSV reporter must be initialized before writing'
      );
    });
  });
});
