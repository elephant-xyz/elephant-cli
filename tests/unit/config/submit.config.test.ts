import { describe, it, expect, vi } from 'vitest';

// Mock os module before importing the config
vi.mock('os', () => ({
  cpus: vi.fn(() => Array(8).fill({})), // Mock 8 CPU cores
}));

import { 
  SubmitConfig, 
  DEFAULT_SUBMIT_CONFIG, 
  createSubmitConfig 
} from '../../../src/config/submit.config';

describe('Submit Configuration', () => {
  describe('DEFAULT_SUBMIT_CONFIG', () => {
    it('should have all required configuration properties', () => {
      expect(DEFAULT_SUBMIT_CONFIG).toHaveProperty('maxConcurrentReads');
      expect(DEFAULT_SUBMIT_CONFIG).toHaveProperty('maxConcurrentValidations');
      expect(DEFAULT_SUBMIT_CONFIG).toHaveProperty('maxConcurrentUploads');
      expect(DEFAULT_SUBMIT_CONFIG).toHaveProperty('maxConcurrentChainQueries');
      
      expect(DEFAULT_SUBMIT_CONFIG).toHaveProperty('validationBatchSize');
      expect(DEFAULT_SUBMIT_CONFIG).toHaveProperty('transactionBatchSize');
      expect(DEFAULT_SUBMIT_CONFIG).toHaveProperty('fileScanBatchSize');
      expect(DEFAULT_SUBMIT_CONFIG).toHaveProperty('chainQueryBatchSize');
      
      expect(DEFAULT_SUBMIT_CONFIG).toHaveProperty('validationWorkers');
      expect(DEFAULT_SUBMIT_CONFIG).toHaveProperty('serializationWorkers');
      
      expect(DEFAULT_SUBMIT_CONFIG).toHaveProperty('schemaCacheSize');
      expect(DEFAULT_SUBMIT_CONFIG).toHaveProperty('enableDiskCache');
      expect(DEFAULT_SUBMIT_CONFIG).toHaveProperty('chainStateCacheTTL');
      
      expect(DEFAULT_SUBMIT_CONFIG).toHaveProperty('maxRetries');
      expect(DEFAULT_SUBMIT_CONFIG).toHaveProperty('retryDelay');
      expect(DEFAULT_SUBMIT_CONFIG).toHaveProperty('retryBackoffMultiplier');
      
      expect(DEFAULT_SUBMIT_CONFIG).toHaveProperty('uploadTimeout');
      expect(DEFAULT_SUBMIT_CONFIG).toHaveProperty('chainQueryTimeout');
      
      expect(DEFAULT_SUBMIT_CONFIG).toHaveProperty('errorCsvPath');
      expect(DEFAULT_SUBMIT_CONFIG).toHaveProperty('warningCsvPath');
      expect(DEFAULT_SUBMIT_CONFIG).toHaveProperty('checkpointPath');
      
      expect(DEFAULT_SUBMIT_CONFIG).toHaveProperty('progressUpdateInterval');
      expect(DEFAULT_SUBMIT_CONFIG).toHaveProperty('enableProgressBar');
    });

    it('should have sensible default values', () => {
      expect(DEFAULT_SUBMIT_CONFIG.maxConcurrentReads).toBe(100);
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
      expect(DEFAULT_SUBMIT_CONFIG.warningCsvPath).toBe('./submit_warnings.csv');
      expect(DEFAULT_SUBMIT_CONFIG.checkpointPath).toBe('./submit_checkpoint.json');
      
      expect(DEFAULT_SUBMIT_CONFIG.progressUpdateInterval).toBe(500);
      expect(DEFAULT_SUBMIT_CONFIG.enableProgressBar).toBe(true);
    });

    it('should calculate worker counts based on CPU cores', () => {
      // The actual CPU count depends on the system, so we test the logic instead
      const actualCpuCount = require('os').cpus().length;
      
      expect(DEFAULT_SUBMIT_CONFIG.maxConcurrentValidations).toBe(Math.max(1, actualCpuCount - 1));
      expect(DEFAULT_SUBMIT_CONFIG.validationWorkers).toBe(Math.max(1, actualCpuCount - 1));
      expect(DEFAULT_SUBMIT_CONFIG.serializationWorkers).toBe(Math.max(1, Math.floor(actualCpuCount / 2)));
    });

    it('should handle minimum worker counts', () => {
      // Even with few cores, should have at least 1 worker
      expect(DEFAULT_SUBMIT_CONFIG.maxConcurrentValidations).toBeGreaterThanOrEqual(1);
      expect(DEFAULT_SUBMIT_CONFIG.validationWorkers).toBeGreaterThanOrEqual(1);
      expect(DEFAULT_SUBMIT_CONFIG.serializationWorkers).toBeGreaterThanOrEqual(1);
    });
  });

  describe('createSubmitConfig', () => {
    it('should return default config when no overrides provided', () => {
      const config = createSubmitConfig();
      expect(config).toEqual(DEFAULT_SUBMIT_CONFIG);
    });

    it('should merge overrides with default config', () => {
      const overrides: Partial<SubmitConfig> = {
        maxConcurrentUploads: 5,
        transactionBatchSize: 100,
        errorCsvPath: './custom_errors.csv',
        enableProgressBar: false,
      };

      const config = createSubmitConfig(overrides);
      
      expect(config.maxConcurrentUploads).toBe(5);
      expect(config.transactionBatchSize).toBe(100);
      expect(config.errorCsvPath).toBe('./custom_errors.csv');
      expect(config.enableProgressBar).toBe(false);
      
      // Should keep defaults for non-overridden values
      expect(config.maxConcurrentReads).toBe(DEFAULT_SUBMIT_CONFIG.maxConcurrentReads);
      expect(config.validationBatchSize).toBe(DEFAULT_SUBMIT_CONFIG.validationBatchSize);
      expect(config.schemaCacheSize).toBe(DEFAULT_SUBMIT_CONFIG.schemaCacheSize);
    });

    it('should handle partial overrides', () => {
      const config = createSubmitConfig({
        maxRetries: 5,
      });

      expect(config.maxRetries).toBe(5);
      expect(config.retryDelay).toBe(DEFAULT_SUBMIT_CONFIG.retryDelay);
      expect(config.retryBackoffMultiplier).toBe(DEFAULT_SUBMIT_CONFIG.retryBackoffMultiplier);
    });

    it('should handle empty overrides object', () => {
      const config = createSubmitConfig({});
      expect(config).toEqual(DEFAULT_SUBMIT_CONFIG);
    });

    it('should allow overriding all properties', () => {
      const customConfig: SubmitConfig = {
        maxConcurrentReads: 50,
        maxConcurrentValidations: 4,
        maxConcurrentUploads: 20,
        maxConcurrentChainQueries: 10,
        
        validationBatchSize: 200,
        transactionBatchSize: 150,
        fileScanBatchSize: 500,
        chainQueryBatchSize: 25,
        
        validationWorkers: 4,
        serializationWorkers: 2,
        
        schemaCacheSize: 500,
        enableDiskCache: false,
        chainStateCacheTTL: 10 * 60 * 1000,
        
        maxRetries: 5,
        retryDelay: 2000,
        retryBackoffMultiplier: 1.5,
        
        uploadTimeout: 60 * 1000,
        chainQueryTimeout: 5 * 1000,
        
        errorCsvPath: './custom_errors.csv',
        warningCsvPath: './custom_warnings.csv',
        checkpointPath: './custom_checkpoint.json',
        
        progressUpdateInterval: 1000,
        enableProgressBar: false,
      };

      const config = createSubmitConfig(customConfig);
      expect(config).toEqual(customConfig);
    });
  });

  describe('SubmitConfig interface', () => {
    it('should accept valid configuration object', () => {
      const validConfig: SubmitConfig = {
        maxConcurrentReads: 100,
        maxConcurrentValidations: 8,
        maxConcurrentUploads: 10,
        maxConcurrentChainQueries: 20,
        
        validationBatchSize: 100,
        transactionBatchSize: 200,
        fileScanBatchSize: 1000,
        chainQueryBatchSize: 50,
        
        validationWorkers: 8,
        serializationWorkers: 4,
        
        schemaCacheSize: 1000,
        enableDiskCache: true,
        chainStateCacheTTL: 300000,
        
        maxRetries: 3,
        retryDelay: 1000,
        retryBackoffMultiplier: 2,
        
        uploadTimeout: 30000,
        chainQueryTimeout: 10000,
        
        errorCsvPath: './errors.csv',
        warningCsvPath: './warnings.csv',
        checkpointPath: './checkpoint.json',
        
        progressUpdateInterval: 500,
        enableProgressBar: true,
      };

      expect(validConfig).toBeDefined();
      expect(typeof validConfig.maxConcurrentReads).toBe('number');
      expect(typeof validConfig.enableDiskCache).toBe('boolean');
      expect(typeof validConfig.errorCsvPath).toBe('string');
    });
  });
});