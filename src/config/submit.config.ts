export interface SubmitConfig {
  // Concurrency limits
  maxConcurrentReads: number;
  maxConcurrentValidations: number;
  maxConcurrentUploads: number;
  maxConcurrentChainQueries: number;

  // Batching configuration
  validationBatchSize: number;
  transactionBatchSize: number;
  fileScanBatchSize: number;
  chainQueryBatchSize: number;

  // Caching configuration
  schemaCacheSize: number;
  enableDiskCache: boolean;
  chainStateCacheTTL: number; // in milliseconds

  // Retry configuration
  maxRetries: number;
  retryDelay: number; // in milliseconds
  retryBackoffMultiplier: number;

  // Timeout configuration
  uploadTimeout: number; // in milliseconds
  chainQueryTimeout: number; // in milliseconds

  // Output configuration
  errorCsvPath: string;
  warningCsvPath: string;
  checkpointPath: string;

  // Progress configuration
  progressUpdateInterval: number; // in milliseconds
  enableProgressBar: boolean;
}

export const DEFAULT_SUBMIT_CONFIG: SubmitConfig = {
  // Concurrency limits
  maxConcurrentReads: 100,
  maxConcurrentValidations: Math.max(1, require('os').cpus().length - 1),
  maxConcurrentUploads: 10,
  maxConcurrentChainQueries: 20,

  // Batching configuration
  validationBatchSize: 100,
  transactionBatchSize: 200,
  fileScanBatchSize: 1000,
  chainQueryBatchSize: 50,

  // Caching configuration
  schemaCacheSize: 1000,
  enableDiskCache: true,
  chainStateCacheTTL: 5 * 60 * 1000, // 5 minutes

  // Retry configuration
  maxRetries: 3,
  retryDelay: 1000, // 1 second
  retryBackoffMultiplier: 2,

  // Timeout configuration
  uploadTimeout: 30 * 1000, // 30 seconds
  chainQueryTimeout: 10 * 1000, // 10 seconds

  // Output configuration
  errorCsvPath: './submit_errors.csv',
  warningCsvPath: './submit_warnings.csv',
  checkpointPath: './submit_checkpoint.json',

  // Progress configuration
  progressUpdateInterval: 500, // 500ms
  enableProgressBar: true,
};

export function createSubmitConfig(
  overrides: Partial<SubmitConfig> = {}
): SubmitConfig {
  return {
    ...DEFAULT_SUBMIT_CONFIG,
    ...overrides,
  };
}
