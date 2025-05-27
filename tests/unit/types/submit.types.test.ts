import { describe, it, expect } from 'vitest';
import {
  FileEntry,
  ValidationResult,
  ProcessingState,
  ProcessedFile,
  UploadResult,
  ErrorEntry,
  WarningEntry,
  ReportSummary,
} from '../../../src/types/submit.types';

describe('Submit Types', () => {
  describe('FileEntry', () => {
    it('should have required properties', () => {
      const fileEntry: FileEntry = {
        propertyCid: 'QmPropertyCid123',
        dataGroupCid: 'QmDataGroupCid456',
        filePath: '/path/to/file.json',
      };

      expect(fileEntry.propertyCid).toBe('QmPropertyCid123');
      expect(fileEntry.dataGroupCid).toBe('QmDataGroupCid456');
      expect(fileEntry.filePath).toBe('/path/to/file.json');
    });
  });

  describe('ValidationResult', () => {
    it('should represent successful validation', () => {
      const result: ValidationResult = {
        success: true,
        filePath: '/path/to/file.json',
        propertyCid: 'QmPropertyCid123',
        dataGroupCid: 'QmDataGroupCid456',
      };

      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should represent failed validation with error', () => {
      const result: ValidationResult = {
        success: false,
        error: 'Invalid JSON schema',
        filePath: '/path/to/file.json',
        propertyCid: 'QmPropertyCid123',
        dataGroupCid: 'QmDataGroupCid456',
      };

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid JSON schema');
    });
  });

  describe('ProcessingState', () => {
    it('should track processing metrics', () => {
      const state: ProcessingState = {
        totalFiles: 1000,
        processed: 250,
        errors: 5,
        warnings: 10,
        uploaded: 200,
        submitted: 150,
      };

      expect(state.totalFiles).toBe(1000);
      expect(state.processed).toBe(250);
      expect(state.errors).toBe(5);
      expect(state.warnings).toBe(10);
      expect(state.uploaded).toBe(200);
      expect(state.submitted).toBe(150);
    });
  });

  describe('ProcessedFile', () => {
    it('should contain all processing results', () => {
      const processedFile: ProcessedFile = {
        propertyCid: 'QmPropertyCid123',
        dataGroupCid: 'QmDataGroupCid456',
        filePath: '/path/to/file.json',
        canonicalJson: '{"key":"value"}',
        calculatedCid: 'QmCalculatedCid789',
        validationPassed: true,
      };

      expect(processedFile.propertyCid).toBe('QmPropertyCid123');
      expect(processedFile.canonicalJson).toBe('{"key":"value"}');
      expect(processedFile.calculatedCid).toBe('QmCalculatedCid789');
      expect(processedFile.validationPassed).toBe(true);
    });
  });

  describe('UploadResult', () => {
    it('should represent successful upload', () => {
      const result: UploadResult = {
        success: true,
        cid: 'QmUploadedCid123',
        propertyCid: 'QmPropertyCid123',
        dataGroupCid: 'QmDataGroupCid456',
      };

      expect(result.success).toBe(true);
      expect(result.cid).toBe('QmUploadedCid123');
      expect(result.error).toBeUndefined();
    });

    it('should represent failed upload', () => {
      const result: UploadResult = {
        success: false,
        error: 'Upload timeout',
        propertyCid: 'QmPropertyCid123',
        dataGroupCid: 'QmDataGroupCid456',
      };

      expect(result.success).toBe(false);
      expect(result.error).toBe('Upload timeout');
      expect(result.cid).toBeUndefined();
    });
  });

  describe('ErrorEntry', () => {
    it('should contain error details', () => {
      const errorEntry: ErrorEntry = {
        propertyCid: 'QmPropertyCid123',
        dataGroupCid: 'QmDataGroupCid456',
        filePath: '/path/to/file.json',
        error: 'JSON validation failed',
        timestamp: '2023-01-01T00:00:00.000Z',
      };

      expect(errorEntry.propertyCid).toBe('QmPropertyCid123');
      expect(errorEntry.error).toBe('JSON validation failed');
      expect(errorEntry.timestamp).toBe('2023-01-01T00:00:00.000Z');
    });
  });

  describe('WarningEntry', () => {
    it('should contain warning details', () => {
      const warningEntry: WarningEntry = {
        propertyCid: 'QmPropertyCid123',
        dataGroupCid: 'QmDataGroupCid456',
        filePath: '/path/to/file.json',
        reason: 'File already submitted',
        timestamp: '2023-01-01T00:00:00.000Z',
      };

      expect(warningEntry.propertyCid).toBe('QmPropertyCid123');
      expect(warningEntry.reason).toBe('File already submitted');
      expect(warningEntry.timestamp).toBe('2023-01-01T00:00:00.000Z');
    });
  });

  describe('ReportSummary', () => {
    it('should contain complete processing summary', () => {
      const startTime = new Date('2023-01-01T00:00:00.000Z');
      const endTime = new Date('2023-01-01T01:00:00.000Z');

      const summary: ReportSummary = {
        totalFiles: 1000,
        processedFiles: 950,
        errorCount: 25,
        warningCount: 25,
        uploadedFiles: 900,
        submittedBatches: 5,
        startTime,
        endTime,
        duration: 3600000, // 1 hour in ms
      };

      expect(summary.totalFiles).toBe(1000);
      expect(summary.processedFiles).toBe(950);
      expect(summary.errorCount).toBe(25);
      expect(summary.warningCount).toBe(25);
      expect(summary.uploadedFiles).toBe(900);
      expect(summary.submittedBatches).toBe(5);
      expect(summary.startTime).toBe(startTime);
      expect(summary.endTime).toBe(endTime);
      expect(summary.duration).toBe(3600000);
    });
  });
});
