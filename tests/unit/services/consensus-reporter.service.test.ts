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

// Helper function to create test data with all required fields
function createTestAnalysis(partial: {
  propertyHash: string;
  dataGroupHash: string;
  consensusReached: boolean | 'partial';
  submissionsByDataHash: Map<string, string[]>;
  totalSubmitters: number;
  uniqueDataHashes: number;
}): ConsensusAnalysis {
  // Create submitterData from submissionsByDataHash
  const submitterData = new Map<string, { hash: string; cid: string }>();
  for (const [hash, submitters] of partial.submissionsByDataHash) {
    // Create a mock CID for testing
    const mockCid = `bafkrei${hash.replace('0x', '').substring(0, 10)}`;
    for (const submitter of submitters) {
      submitterData.set(submitter, { hash, cid: mockCid });
    }
  }

  return {
    ...partial,
    submitterData,
  };
}

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
        createTestAnalysis({
          propertyHash: '0xprop1',
          dataGroupHash: '0xgroup1',
          consensusReached: true,
          submissionsByDataHash: new Map([
            ['0xdata1', ['0xsubmitter1', '0xsubmitter2', '0xsubmitter3']],
            ['0xdata2', ['0xsubmitter4']],
          ]),
          totalSubmitters: 4,
          uniqueDataHashes: 2,
        }),
        createTestAnalysis({
          propertyHash: '0xprop2',
          dataGroupHash: '0xgroup2',
          consensusReached: false,

          submissionsByDataHash: new Map([
            ['0xdata3', ['0xsubmitter1']],
            ['0xdata4', ['0xsubmitter2', '0xsubmitter3']],
          ]),
          totalSubmitters: 3,
          uniqueDataHashes: 2,
        }),
      ];

      await ConsensusReporterService.generateCSV(analysisData, outputPath);

      // Read and verify the generated CSV
      const csvContent = await fs.readFile(outputPath, 'utf-8');
      const lines = csvContent.trim().split('\n');

      // Check header - now includes hash and CID columns for each submitter plus difference columns
      expect(lines[0]).toBe(
        'propertyHash,dataGroupHash,consensusReached,totalSubmitters,uniqueDataHashes,0xsubmitter1,0xsubmitter1_cid,0xsubmitter2,0xsubmitter2_cid,0xsubmitter3,0xsubmitter3_cid,0xsubmitter4,0xsubmitter4_cid,totalDifferences,differenceSummary'
      );

      // Check first data row (full consensus with 3 submitters)
      expect(lines[1]).toBe(
        '0xprop1,0xgroup1,true,4,2,0xdata1,bafkreidata1,0xdata1,bafkreidata1,0xdata1,bafkreidata1,0xdata2,bafkreidata2,-,-'
      );

      // Check second data row (no consensus)
      expect(lines[2]).toBe(
        '0xprop2,0xgroup2,false,3,2,0xdata3,bafkreidata3,0xdata4,bafkreidata4,0xdata4,bafkreidata4,-,-,-,-'
      );
    });

    it('should handle partial consensus correctly', async () => {
      const analysisData: ConsensusAnalysis[] = [
        createTestAnalysis({
          propertyHash: '0xprop1',
          dataGroupHash: '0xgroup1',
          consensusReached: true,

          submissionsByDataHash: new Map([
            ['0xdata1', ['0xsubmitter1', '0xsubmitter2', '0xsubmitter3']],
          ]),
          totalSubmitters: 3,
          uniqueDataHashes: 1,
        }),
        createTestAnalysis({
          propertyHash: '0xprop2',
          dataGroupHash: '0xgroup2',
          consensusReached: 'partial',

          submissionsByDataHash: new Map([
            ['0xdata2', ['0xsubmitter1', '0xsubmitter2']],
            ['0xdata3', ['0xsubmitter3']],
          ]),
          totalSubmitters: 3,
          uniqueDataHashes: 2,
        }),
        createTestAnalysis({
          propertyHash: '0xprop3',
          dataGroupHash: '0xgroup3',
          consensusReached: false,

          submissionsByDataHash: new Map([
            ['0xdata4', ['0xsubmitter1']],
            ['0xdata5', ['0xsubmitter2']],
            ['0xdata6', ['0xsubmitter3']],
          ]),
          totalSubmitters: 3,
          uniqueDataHashes: 3,
        }),
      ];

      await ConsensusReporterService.generateCSV(analysisData, outputPath);

      const csvContent = await fs.readFile(outputPath, 'utf-8');
      const lines = csvContent.trim().split('\n');

      // Check header
      expect(lines[0]).toBe(
        'propertyHash,dataGroupHash,consensusReached,totalSubmitters,uniqueDataHashes,0xsubmitter1,0xsubmitter1_cid,0xsubmitter2,0xsubmitter2_cid,0xsubmitter3,0xsubmitter3_cid,totalDifferences,differenceSummary'
      );

      // Check full consensus row
      expect(lines[1]).toBe(
        '0xprop1,0xgroup1,true,3,1,0xdata1,bafkreidata1,0xdata1,bafkreidata1,0xdata1,bafkreidata1,-,-'
      );

      // Check partial consensus row
      expect(lines[2]).toBe(
        '0xprop2,0xgroup2,partial,3,2,0xdata2,bafkreidata2,0xdata2,bafkreidata2,0xdata3,bafkreidata3,-,-'
      );

      // Check no consensus row
      expect(lines[3]).toBe(
        '0xprop3,0xgroup3,false,3,3,0xdata4,bafkreidata4,0xdata5,bafkreidata5,0xdata6,bafkreidata6,-,-'
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
        'propertyHash,dataGroupHash,consensusReached,totalSubmitters,uniqueDataHashes,totalDifferences,differenceSummary'
      );
    });

    it('should escape CSV fields with special characters', async () => {
      const analysisData: ConsensusAnalysis[] = [
        createTestAnalysis({
          propertyHash: '0xprop,with,commas',
          dataGroupHash: '0xgroup"with"quotes',
          consensusReached: true,

          submissionsByDataHash: new Map([
            ['0xdata,special', ['0xsubmitter1']],
          ]),
          totalSubmitters: 1,
          uniqueDataHashes: 1,
        }),
      ];

      await ConsensusReporterService.generateCSV(analysisData, outputPath);

      const csvContent = await fs.readFile(outputPath, 'utf-8');
      const lines = csvContent.trim().split('\n');

      // Check that special characters are properly escaped
      expect(lines[1]).toContain('"0xprop,with,commas"');
      expect(lines[1]).toContain('"0xgroup""with""quotes"');
      // Check that the special data hash is properly escaped
      expect(lines[1]).toContain('"0xdata,special"');
    });
  });

  describe('streaming functionality', () => {
    it('should support incremental writing', async () => {
      const reporter = new ConsensusReporterService(outputPath);

      // Initialize with submitters
      await reporter.initialize(new Set(['0xsubmitter1', '0xsubmitter2']));

      // Write first batch
      const batch1: ConsensusAnalysis[] = [
        createTestAnalysis({
          propertyHash: '0xprop1',
          dataGroupHash: '0xgroup1',
          consensusReached: true,

          submissionsByDataHash: new Map([
            ['0xdata1', ['0xsubmitter1', '0xsubmitter2']],
          ]),
          totalSubmitters: 2,
          uniqueDataHashes: 1,
        }),
      ];
      await reporter.writeAnalysis(batch1);

      // Write second batch
      const batch2: ConsensusAnalysis[] = [
        createTestAnalysis({
          propertyHash: '0xprop2',
          dataGroupHash: '0xgroup2',
          consensusReached: false,

          submissionsByDataHash: new Map([
            ['0xdata2', ['0xsubmitter1']],
            ['0xdata3', ['0xsubmitter2']],
          ]),
          totalSubmitters: 2,
          uniqueDataHashes: 2,
        }),
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
        createTestAnalysis({
          propertyHash: '0xprop1',
          dataGroupHash: '0xgroup1',
          consensusReached: true,

          submissionsByDataHash: new Map(),
          totalSubmitters: 0,
          uniqueDataHashes: 0,
        }),
      ];

      await expect(reporter.writeAnalysis(data)).rejects.toThrow(
        'CSV reporter must be initialized before writing'
      );
    });
  });
});
