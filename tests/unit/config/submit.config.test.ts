import { describe, it, expect } from 'vitest';
import {
  SubmitConfig,
  DEFAULT_SUBMIT_CONFIG,
  createSubmitConfig,
} from '../../../src/config/submit.config';

describe('SubmitConfig', () => {
  describe('DEFAULT_SUBMIT_CONFIG', () => {
    it('should have correct default values', () => {
      expect(DEFAULT_SUBMIT_CONFIG.maxConcurrentReads).toBe(100);
      expect(
        DEFAULT_SUBMIT_CONFIG.maxConcurrentValidations
      ).toBeGreaterThanOrEqual(1);
      expect(DEFAULT_SUBMIT_CONFIG.maxConcurrentUploads).toBe(10);
      expect(DEFAULT_SUBMIT_CONFIG.maxConcurrentChainQueries).toBe(20);

      expect(DEFAULT_SUBMIT_CONFIG.validationBatchSize).toBe(100);
      expect(DEFAULT_SUBMIT_CONFIG.transactionBatchSize).toBe(200);
      expect(DEFAULT_SUBMIT_CONFIG.fileScanBatchSize).toBe(1000);
      expect(DEFAULT_SUBMIT_CONFIG.chainQueryBatchSize).toBe(50);

      expect(DEFAULT_SUBMIT_CONFIG.schemaCacheSize).toBe(1000);
      expect(DEFAULT_SUBMIT_CONFIG.enableDiskCache).toBe(true);
      expect(DEFAULT_SUBMIT_CONFIG.chainStateCacheTTL).toBe(5 * 60 * 1000);

      expect(DEFAULT_SUBMIT_CONFIG.maxRetries).toBe(3);
      expect(DEFAULT_SUBMIT_CONFIG.retryDelay).toBe(1000);
      expect(DEFAULT_SUBMIT_CONFIG.retryBackoffMultiplier).toBe(2);

      expect(DEFAULT_SUBMIT_CONFIG.uploadTimeout).toBe(30 * 1000);
      expect(DEFAULT_SUBMIT_CONFIG.chainQueryTimeout).toBe(10 * 1000);

      expect(DEFAULT_SUBMIT_CONFIG.errorCsvPath).toBe('./submit_errors.csv');
      expect(DEFAULT_SUBMIT_CONFIG.warningCsvPath).toBe(
        './submit_warnings.csv'
      );
      expect(DEFAULT_SUBMIT_CONFIG.checkpointPath).toBe(
        './submit_checkpoint.json'
      );

      expect(DEFAULT_SUBMIT_CONFIG.progressUpdateInterval).toBe(500);
      expect(DEFAULT_SUBMIT_CONFIG.enableProgressBar).toBe(true);
    });

    it('should calculate dynamic defaults correctly', () => {
      // Example: maxConcurrentValidations depends on CPU cores
      const cpus = require('os').cpus().length;
      expect(DEFAULT_SUBMIT_CONFIG.maxConcurrentValidations).toBe(
        Math.max(1, cpus - 1)
      );
    });
  });

  describe('createSubmitConfig', () => {
    it('should return default config if no overrides provided', () => {
      const config = createSubmitConfig();
      expect(config).toEqual(DEFAULT_SUBMIT_CONFIG);
    });

    it('should override default values correctly', () => {
      const overrides: Partial<SubmitConfig> = {
        maxConcurrentUploads: 5,
        transactionBatchSize: 100,
        enableProgressBar: false,
      };
      const config = createSubmitConfig(overrides);

      expect(config.maxConcurrentUploads).toBe(5);
      expect(config.transactionBatchSize).toBe(100);
      expect(config.enableProgressBar).toBe(false);

      // Check that other defaults are preserved
      expect(config.maxConcurrentReads).toBe(
        DEFAULT_SUBMIT_CONFIG.maxConcurrentReads
      );
      expect(config.errorCsvPath).toBe(DEFAULT_SUBMIT_CONFIG.errorCsvPath);
    });

    it('should handle all partial overrides', () => {
      const partialOverrides: Partial<SubmitConfig> = {
        maxConcurrentReads: 50,
      };
      const config = createSubmitConfig(partialOverrides);
      expect(config.maxConcurrentReads).toBe(50);
      expect(config.maxConcurrentUploads).toBe(
        DEFAULT_SUBMIT_CONFIG.maxConcurrentUploads
      ); // Stays default
    });
  });
});
