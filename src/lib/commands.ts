import {
  handleTransform,
  TransformCommandOptions,
} from '../commands/transform/index.js';
import {
  handleValidate,
  ValidateCommandOptions,
} from '../commands/validate.js';
import { handleHash, HashCommandOptions } from '../commands/hash.js';
import { handleUpload, UploadCommandOptions } from '../commands/upload.js';
import {
  handleSubmitToContract,
  SubmitToContractCommandOptions,
} from '../commands/submit-to-contract.js';

// Transform function interface
export interface TransformOptions {
  outputZip?: string;
  scriptsZip?: string;
  inputZip: string;
  legacyMode?: boolean;
}

export interface TransformResult {
  success: boolean;
  outputPath: string;
  error?: string;
}

// Validate function interface
export interface ValidateOptions {
  input: string;
  outputCsv?: string;
  maxConcurrentTasks?: number;
}

export interface ValidateResult {
  success: boolean;
  totalFiles: number;
  errors: number;
  processed: number;
  skipped: number;
  errorCsvPath: string;
  error?: string;
}

// Hash function interface
export interface HashOptions {
  input: string;
  outputZip?: string;
  outputCsv?: string;
  maxConcurrentTasks?: number;
  propertyCid?: string;
}

export interface HashResult {
  success: boolean;
  outputZipPath: string;
  outputCsvPath: string;
  totalFiles: number;
  processed: number;
  errors: number;
  error?: string;
}

// Upload function interface
export interface UploadOptions {
  input: string;
  pinataJwt: string;
  outputCsv?: string;
}

export interface UploadResult {
  success: boolean;
  uploadedDirectories: Array<{
    name: string;
    cid: string;
    mediaCid?: string;
  }>;
  outputCsvPath?: string;
  error?: string;
}

// Submit-to-Contract function interface
export interface SubmitToContractOptions {
  csvFile: string;
  rpcUrl?: string;
  contractAddress?: string;
  privateKey?: string;
  transactionBatchSize?: number;
  gasPrice?: string | number;
  dryRun?: boolean;
  unsignedTransactionsJson?: string;
  fromAddress?: string;
  domain?: string;
  apiKey?: string;
  oracleKeyId?: string;
  checkEligibility?: boolean;
  transactionIdsCsv?: string;
}

export interface SubmitToContractResult {
  success: boolean;
  totalRecords: number;
  eligibleItems: number;
  skippedItems: number;
  submittedTransactions: number;
  totalItemsSubmitted: number;
  transactionIdsCsvPath?: string;
  error?: string;
}

// Transform function wrapper
export async function transform(
  options: TransformOptions
): Promise<TransformResult> {
  try {
    const transformOptions: TransformCommandOptions = {
      outputZip: options.outputZip || 'transformed-data.zip',
      scriptsZip: options.scriptsZip,
      inputZip: options.inputZip,
      legacyMode: options.legacyMode || false,
      silent: true, // Enable silent mode for library usage
    };

    await handleTransform(transformOptions);

    return {
      success: true,
      outputPath: transformOptions.outputZip!,
    };
  } catch (error) {
    return {
      success: false,
      outputPath: options.outputZip || 'transformed-data.zip',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// Validate function wrapper
export async function validate(
  options: ValidateOptions
): Promise<ValidateResult> {
  try {
    const validateOptions: ValidateCommandOptions = {
      input: options.input,
      outputCsv: options.outputCsv || 'submit_errors.csv',
      maxConcurrentTasks: options.maxConcurrentTasks,
      silent: true, // Enable silent mode for library usage
    };

    await handleValidate(validateOptions);

    return {
      success: true,
      totalFiles: 0, // This would need to be returned from handleValidate
      errors: 0,
      processed: 0,
      skipped: 0,
      errorCsvPath: validateOptions.outputCsv!,
    };
  } catch (error) {
    return {
      success: false,
      totalFiles: 0,
      errors: 1,
      processed: 0,
      skipped: 0,
      errorCsvPath: options.outputCsv ?? 'submit_errors.csv',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// Hash function wrapper
export async function hash(options: HashOptions): Promise<HashResult> {
  try {
    const hashOptions: HashCommandOptions = {
      input: options.input,
      outputZip: options.outputZip || 'hashed-data.zip',
      outputCsv: options.outputCsv || 'hash-results.csv',
      maxConcurrentTasks: options.maxConcurrentTasks,
      propertyCid: options.propertyCid,
      silent: true, // Enable silent mode for library usage
    };

    await handleHash(hashOptions);

    return {
      success: true,
      outputZipPath: hashOptions.outputZip,
      outputCsvPath: hashOptions.outputCsv,
      totalFiles: 0, // This would need to be returned from handleHash
      processed: 0,
      errors: 0,
    };
  } catch (error) {
    return {
      success: false,
      outputZipPath: options.outputZip || 'hashed-data.zip',
      outputCsvPath: options.outputCsv || 'hash-results.csv',
      totalFiles: 0,
      processed: 0,
      errors: 1,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// Upload function wrapper
export async function upload(options: UploadOptions): Promise<UploadResult> {
  try {
    const uploadOptions: UploadCommandOptions = {
      input: options.input,
      pinataJwt: options.pinataJwt,
      outputCsv: options.outputCsv || 'upload-results.csv',
      silent: true, // Enable silent mode for library usage
    };

    await handleUpload(uploadOptions);

    return {
      success: true,
      uploadedDirectories: [], // This would need to be returned from handleUpload
      outputCsvPath: uploadOptions.outputCsv,
    };
  } catch (error) {
    return {
      success: false,
      uploadedDirectories: [],
      outputCsvPath: options.outputCsv || 'upload-results.csv',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// Submit-to-Contract function wrapper
export async function submitToContract(
  options: SubmitToContractOptions
): Promise<SubmitToContractResult> {
  try {
    const submitOptions: SubmitToContractCommandOptions = {
      csvFile: options.csvFile,
      rpcUrl:
        options.rpcUrl || process.env.RPC_URL || 'https://polygon-rpc.com/',
      contractAddress:
        options.contractAddress ||
        process.env.SUBMIT_CONTRACT_ADDRESS ||
        '0x1234567890123456789012345678901234567890',
      privateKey: options.privateKey || process.env.ELEPHANT_PRIVATE_KEY || '',
      transactionBatchSize: options.transactionBatchSize || 200,
      gasPrice: options.gasPrice || 30,
      dryRun: options.dryRun || false,
      unsignedTransactionsJson: options.unsignedTransactionsJson,
      fromAddress: options.fromAddress,
      domain: options.domain,
      apiKey: options.apiKey,
      oracleKeyId: options.oracleKeyId,
      checkEligibility: options.checkEligibility || false,
      transactionIdsCsv: options.transactionIdsCsv,
      silent: true, // Enable silent mode for library usage
    };

    await handleSubmitToContract(submitOptions);

    return {
      success: true,
      totalRecords: 0, // This would need to be returned from handleSubmitToContract
      eligibleItems: 0,
      skippedItems: 0,
      submittedTransactions: 0,
      totalItemsSubmitted: 0,
      transactionIdsCsvPath: submitOptions.transactionIdsCsv,
    };
  } catch (error) {
    return {
      success: false,
      totalRecords: 0,
      eligibleItems: 0,
      skippedItems: 0,
      submittedTransactions: 0,
      totalItemsSubmitted: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
