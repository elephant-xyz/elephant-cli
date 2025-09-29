import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFile, unlink, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { tmpdir } from 'os';
import { CsvReporterService } from '../../../src/services/csv-reporter.service';
import { ErrorEntry, WarningEntry } from '../../../src/types/submit.types';

describe('CsvReporterService', () => {
  let csvReporter: CsvReporterService;
  let tempDir: string;
  let errorCsvPath: string;
  let warningCsvPath: string;

  beforeEach(async () => {
    // Create unique temporary directory for each test
    tempDir = join(
      tmpdir(),
      `csv-reporter-test-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    );
    await mkdir(tempDir, { recursive: true });

    errorCsvPath = join(tempDir, 'errors.csv');
    warningCsvPath = join(tempDir, 'warnings.csv');

    csvReporter = new CsvReporterService(errorCsvPath, warningCsvPath);
  });

  afterEach(async () => {
    // Clean up CSV files and temp directory
    try {
      if (existsSync(errorCsvPath)) await unlink(errorCsvPath);
      if (existsSync(warningCsvPath)) await unlink(warningCsvPath);
      if (existsSync(tempDir)) {
        // Remove directory (it should be empty after removing files)
        await unlink(tempDir).catch(() => {
          // Directory might have other files, try rmdir
          const { rmdir } = require('fs/promises');
          return rmdir(tempDir, { recursive: true }).catch(() => {
            // Ignore cleanup errors in tests
          });
        });
      }
    } catch (error) {
      // Ignore cleanup errors in tests
    }
  });

  describe('initialization', () => {
    it('should initialize successfully and create CSV headers', async () => {
      await csvReporter.initialize();

      // Check that files exist
      expect(existsSync(errorCsvPath)).toBe(true);
      expect(existsSync(warningCsvPath)).toBe(true);

      // Check headers
      const errorContent = await readFile(errorCsvPath, 'utf-8');
      const warningContent = await readFile(warningCsvPath, 'utf-8');

      expect(errorContent).toBe(
        'property_cid,data_group_cid,file_path,error_path,error_message,currentValue,timestamp\n'
      );
      expect(warningContent).toBe(
        'property_cid,data_group_cid,file_path,reason,timestamp\n'
      );
    });

    it('should create directories if they do not exist', async () => {
      const nestedErrorPath = join(tempDir, 'nested', 'errors.csv');
      const nestedWarningPath = join(tempDir, 'other', 'warnings.csv');

      const nestedCsvReporter = new CsvReporterService(
        nestedErrorPath,
        nestedWarningPath
      );

      await nestedCsvReporter.initialize();

      expect(existsSync(nestedErrorPath)).toBe(true);
      expect(existsSync(nestedWarningPath)).toBe(true);

      await nestedCsvReporter.finalize();

      // Cleanup
      await unlink(nestedErrorPath).catch(() => {});
      await unlink(nestedWarningPath).catch(() => {});
    });

    it('should have zero counts initially', () => {
      expect(csvReporter.getErrorCount()).toBe(0);
      expect(csvReporter.getWarningCount()).toBe(0);
    });
  });

  describe('logError', () => {
    beforeEach(async () => {
      await csvReporter.initialize();
    });

    it('should log a single error entry', async () => {
      const errorEntry: ErrorEntry = {
        propertyCid: 'QmPropertyCid123',
        dataGroupCid: 'QmDataGroupCid456',
        filePath: '/path/to/file.json',
        errorPath: 'root',
        errorMessage: 'JSON validation failed',
        currentValue: 'invalid_value',
        timestamp: '2023-01-01T00:00:00.000Z',
      };

      await csvReporter.logError(errorEntry);

      const content = await readFile(errorCsvPath, 'utf-8');
      const lines = content.trim().split('\n');

      expect(lines).toHaveLength(2); // Header + 1 data line
      expect(lines[1]).toBe(
        'QmPropertyCid123,QmDataGroupCid456,/path/to/file.json,root,JSON validation failed,invalid_value,2023-01-01T00:00:00.000Z'
      );
      expect(csvReporter.getErrorCount()).toBe(1);
    });

    it('should escape CSV values containing commas', async () => {
      const errorEntry: ErrorEntry = {
        propertyCid: 'QmPropertyCid123',
        dataGroupCid: 'QmDataGroupCid456',
        filePath: '/path/to/file,with,commas.json',
        errorPath: 'property.name',
        errorMessage: 'Error message, with commas',
        currentValue: 'test,value',
        timestamp: '2023-01-01T00:00:00.000Z',
      };

      await csvReporter.logError(errorEntry);

      const content = await readFile(errorCsvPath, 'utf-8');
      const lines = content.trim().split('\n');

      expect(lines[1]).toBe(
        'QmPropertyCid123,QmDataGroupCid456,"/path/to/file,with,commas.json",property.name,"Error message, with commas","test,value",2023-01-01T00:00:00.000Z'
      );
    });

    it('should escape CSV values containing quotes', async () => {
      const errorEntry: ErrorEntry = {
        propertyCid: 'QmPropertyCid123',
        dataGroupCid: 'QmDataGroupCid456',
        filePath: '/path/to/file.json',
        errorPath: 'data.value',
        errorMessage: 'Error with "quotes" in message',
        currentValue: '"quoted_value"',
        timestamp: '2023-01-01T00:00:00.000Z',
      };

      await csvReporter.logError(errorEntry);

      const content = await readFile(errorCsvPath, 'utf-8');
      const lines = content.trim().split('\n');

      expect(lines[1]).toBe(
        'QmPropertyCid123,QmDataGroupCid456,/path/to/file.json,data.value,"Error with ""quotes"" in message","""quoted_value""",2023-01-01T00:00:00.000Z'
      );
    });

    it('should log multiple error entries', async () => {
      const errorEntry1: ErrorEntry = {
        propertyCid: 'QmPropertyCid1',
        dataGroupCid: 'QmDataGroupCid1',
        filePath: '/path/to/file1.json',
        errorPath: 'root',
        errorMessage: 'First error',
        currentValue: 'value1',
        timestamp: '2023-01-01T00:00:00.000Z',
      };

      const errorEntry2: ErrorEntry = {
        propertyCid: 'QmPropertyCid2',
        dataGroupCid: 'QmDataGroupCid2',
        filePath: '/path/to/file2.json',
        errorPath: 'property.name',
        errorMessage: 'Second error',
        currentValue: 'value2',
        timestamp: '2023-01-01T00:01:00.000Z',
      };

      await csvReporter.logError(errorEntry1);
      await csvReporter.logError(errorEntry2);

      const content = await readFile(errorCsvPath, 'utf-8');
      const lines = content.trim().split('\n');

      expect(lines).toHaveLength(3); // Header + 2 data lines
      expect(csvReporter.getErrorCount()).toBe(2);
    });

    it('should throw error if not initialized', async () => {
      const uninitializedReporter = new CsvReporterService(
        '/tmp/test.csv',
        '/tmp/test2.csv'
      );
      const errorEntry: ErrorEntry = {
        propertyCid: 'QmPropertyCid123',
        dataGroupCid: 'QmDataGroupCid456',
        filePath: '/path/to/file.json',
        errorPath: 'root',
        errorMessage: 'Test error',
        currentValue: 'test_value',
        timestamp: '2023-01-01T00:00:00.000Z',
      };

      await expect(uninitializedReporter.logError(errorEntry)).rejects.toThrow(
        'CSV reporter not initialized'
      );
    });
  });

  describe('logWarning', () => {
    beforeEach(async () => {
      await csvReporter.initialize();
    });

    it('should log a single warning entry', async () => {
      const warningEntry: WarningEntry = {
        propertyCid: 'QmPropertyCid123',
        dataGroupCid: 'QmDataGroupCid456',
        filePath: '/path/to/file.json',
        reason: 'File already submitted',
        timestamp: '2023-01-01T00:00:00.000Z',
      };

      await csvReporter.logWarning(warningEntry);

      const content = await readFile(warningCsvPath, 'utf-8');
      const lines = content.trim().split('\n');

      expect(lines).toHaveLength(2); // Header + 1 data line
      expect(lines[1]).toBe(
        'QmPropertyCid123,QmDataGroupCid456,/path/to/file.json,File already submitted,2023-01-01T00:00:00.000Z'
      );
      expect(csvReporter.getWarningCount()).toBe(1);
    });

    it('should escape CSV values in warnings', async () => {
      const warningEntry: WarningEntry = {
        propertyCid: 'QmPropertyCid123',
        dataGroupCid: 'QmDataGroupCid456',
        filePath: '/path/to/file.json',
        reason: 'Reason with, commas and "quotes"',
        timestamp: '2023-01-01T00:00:00.000Z',
      };

      await csvReporter.logWarning(warningEntry);

      const content = await readFile(warningCsvPath, 'utf-8');
      const lines = content.trim().split('\n');

      expect(lines[1]).toBe(
        'QmPropertyCid123,QmDataGroupCid456,/path/to/file.json,"Reason with, commas and ""quotes""",2023-01-01T00:00:00.000Z'
      );
    });

    it('should throw error if not initialized', async () => {
      const uninitializedReporter = new CsvReporterService(
        '/tmp/test.csv',
        '/tmp/test2.csv'
      );
      const warningEntry: WarningEntry = {
        propertyCid: 'QmPropertyCid123',
        dataGroupCid: 'QmDataGroupCid456',
        filePath: '/path/to/file.json',
        reason: 'Test warning',
        timestamp: '2023-01-01T00:00:00.000Z',
      };

      await expect(
        uninitializedReporter.logWarning(warningEntry)
      ).rejects.toThrow('CSV reporter not initialized');
    });
  });

  describe('finalize', () => {
    beforeEach(async () => {
      await csvReporter.initialize();
    });

    it('should return summary with correct counts', async () => {
      const errorEntry: ErrorEntry = {
        propertyCid: 'QmPropertyCid1',
        dataGroupCid: 'QmDataGroupCid1',
        filePath: '/path/to/file1.json',
        errorPath: 'root',
        errorMessage: 'Test error',
        currentValue: 'error_value',
        timestamp: '2023-01-01T00:00:00.000Z',
      };

      const warningEntry: WarningEntry = {
        propertyCid: 'QmPropertyCid2',
        dataGroupCid: 'QmDataGroupCid2',
        filePath: '/path/to/file2.json',
        reason: 'Test warning',
        timestamp: '2023-01-01T00:00:00.000Z',
      };

      await csvReporter.logError(errorEntry);
      await csvReporter.logWarning(warningEntry);

      // Add small delay to ensure time passes
      await new Promise((resolve) => setTimeout(resolve, 1));

      const summary = await csvReporter.finalize();

      expect(summary.errorCount).toBe(1);
      expect(summary.warningCount).toBe(1);
      expect(summary.duration).toBeGreaterThanOrEqual(0);
      expect(summary.startTime).toBeInstanceOf(Date);
      expect(summary.endTime).toBeInstanceOf(Date);
      expect(summary.endTime.getTime()).toBeGreaterThanOrEqual(
        summary.startTime.getTime()
      );
    });

    it('should close streams and prevent further writes', async () => {
      const summary = await csvReporter.finalize();

      expect(summary).toBeDefined();

      // Attempting to log after finalize should throw
      const errorEntry: ErrorEntry = {
        propertyCid: 'QmPropertyCid123',
        dataGroupCid: 'QmDataGroupCid456',
        filePath: '/path/to/file.json',
        errorPath: 'root',
        errorMessage: 'Test error',
        currentValue: 'final_test_value',
        timestamp: '2023-01-01T00:00:00.000Z',
      };

      await expect(csvReporter.logError(errorEntry)).rejects.toThrow();
    });
  });
});
