import path from 'path';
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
  cwd?: string;
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
  cwd?: string;
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
  cwd?: string;
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
  cwd?: string;
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
  cwd?: string;
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
    const workingDir = options.cwd || process.cwd();
    const outputZip = options.outputZip || 'transformed-data.zip';
    const transformOptions: TransformCommandOptions = {
      outputZip,
      scriptsZip: options.scriptsZip,
      inputZip: options.inputZip,
      legacyMode: options.legacyMode || false,
      silent: true, // Enable silent mode for library usage
      cwd: options.cwd,
    };

    await handleTransform(transformOptions);

    return {
      success: true,
      outputPath: path.resolve(workingDir, outputZip),
    };
  } catch (error) {
    const workingDir = options.cwd || process.cwd();
    const outputZip = options.outputZip || 'transformed-data.zip';
    return {
      success: false,
      outputPath: path.resolve(workingDir, outputZip),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// Validate function wrapper
export async function validate(
  options: ValidateOptions
): Promise<ValidateResult> {
  try {
    const workingDir = options.cwd || process.cwd();
    const outputCsv = options.outputCsv || 'submit_errors.csv';
    const validateOptions: ValidateCommandOptions = {
      input: options.input,
      outputCsv,
      maxConcurrentTasks: options.maxConcurrentTasks,
      silent: true, // Enable silent mode for library usage
      cwd: options.cwd,
    };

    await handleValidate(validateOptions);

    return {
      success: true,
      totalFiles: 0, // This would need to be returned from handleValidate
      errors: 0,
      processed: 0,
      skipped: 0,
      errorCsvPath: path.resolve(workingDir, outputCsv),
    };
  } catch (error) {
    const workingDir = options.cwd || process.cwd();
    const outputCsv = options.outputCsv || 'submit_errors.csv';
    return {
      success: false,
      totalFiles: 0,
      errors: 1,
      processed: 0,
      skipped: 0,
      errorCsvPath: path.resolve(workingDir, outputCsv),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// Hash function wrapper
export async function hash(options: HashOptions): Promise<HashResult> {
  try {
    const workingDir = options.cwd || process.cwd();
    const outputZip = options.outputZip || 'hashed-data.zip';
    const outputCsv = options.outputCsv || 'hash-results.csv';
    const hashOptions: HashCommandOptions = {
      input: options.input,
      outputZip,
      outputCsv,
      maxConcurrentTasks: options.maxConcurrentTasks,
      propertyCid: options.propertyCid,
      silent: true, // Enable silent mode for library usage
      cwd: options.cwd,
    };

    await handleHash(hashOptions);

    return {
      success: true,
      outputZipPath: path.resolve(workingDir, outputZip),
      outputCsvPath: path.resolve(workingDir, outputCsv),
      totalFiles: 0, // This would need to be returned from handleHash
      processed: 0,
      errors: 0,
    };
  } catch (error) {
    const workingDir = options.cwd || process.cwd();
    const outputZip = options.outputZip || 'hashed-data.zip';
    const outputCsv = options.outputCsv || 'hash-results.csv';
    return {
      success: false,
      outputZipPath: path.resolve(workingDir, outputZip),
      outputCsvPath: path.resolve(workingDir, outputCsv),
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
    const workingDir = options.cwd || process.cwd();
    const outputCsv = options.outputCsv || 'upload-results.csv';
    const uploadOptions: UploadCommandOptions = {
      input: options.input,
      pinataJwt: options.pinataJwt,
      outputCsv,
      silent: true, // Enable silent mode for library usage
      cwd: options.cwd,
    };

    await handleUpload(uploadOptions);

    return {
      success: true,
      uploadedDirectories: [], // This would need to be returned from handleUpload
      outputCsvPath: path.resolve(workingDir, outputCsv),
    };
  } catch (error) {
    const workingDir = options.cwd || process.cwd();
    const outputCsv = options.outputCsv || 'upload-results.csv';
    return {
      success: false,
      uploadedDirectories: [],
      outputCsvPath: path.resolve(workingDir, outputCsv),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// Submit-to-Contract function wrapper
export async function submitToContract(
  options: SubmitToContractOptions
): Promise<SubmitToContractResult> {
  try {
    const workingDir = options.cwd || process.cwd();
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
      cwd: options.cwd,
    };

    await handleSubmitToContract(submitOptions);

    return {
      success: true,
      totalRecords: 0, // This would need to be returned from handleSubmitToContract
      eligibleItems: 0,
      skippedItems: 0,
      submittedTransactions: 0,
      totalItemsSubmitted: 0,
      transactionIdsCsvPath: submitOptions.transactionIdsCsv
        ? path.resolve(workingDir, submitOptions.transactionIdsCsv)
        : undefined,
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
