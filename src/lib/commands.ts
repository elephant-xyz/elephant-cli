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
import {
  handleGenerateTransform,
  type GenerateTransformCommandOptions,
} from '../commands/generate-transform/index.js';

// Generate-transform function interface
export type GenerateTransformOptions = Omit<
  GenerateTransformCommandOptions,
  'silent'
>;

export interface GenerateTransformResult {
  success: boolean;
  outputZipPath: string;
  error?: string;
}

// Transform function interface
export interface TransformOptions {
  outputZip?: string;
  scriptsZip?: string;
  inputZip: string;
  legacyMode?: boolean;
  cwd?: string;
  dataGroup?: string;
}

export interface TransformFailureDetail {
  message: string;
  stdout?: string;
  stderr?: string;
}

export interface TransformResult {
  success: boolean;
  outputPath: string;
  error?: string;
  scriptFailure?: TransformFailureDetail;
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
  cwd?: string;
}

export interface UploadResult {
  success: boolean;
  cid?: string;
  errorMessage?: string;
  errors?: {
    propertyDir: string;
    success: boolean;
    cid?: string;
    error?: string;
  }[];
}

// Submit-to-Contract function interface
export interface SubmitToContractOptions {
  csvFile: string;
  rpcUrl?: string;
  contractAddress?: string;
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
  keystoreJson?: string;
  keystorePassword?: string;
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
  const workingDir = options.cwd || process.cwd();
  const outputZip = options.outputZip || 'transformed-data.zip';
  const transformOptions: TransformCommandOptions = {
    outputZip,
    scriptsZip: options.scriptsZip,
    inputZip: options.inputZip,
    legacyMode: options.legacyMode || false,
    silent: true, // Enable silent mode for library usage
    cwd: options.cwd,
    dataGroup: options.dataGroup,
  };

  try {
    await handleTransform(transformOptions);

    return {
      success: true,
      outputPath: path.resolve(workingDir, outputZip),
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    const stderrMarker = '\n--- stderr (tail) ---\n';
    const stdoutMarker = '\n--- stdout (tail) ---\n';
    const split = (marker: string) =>
      msg.includes(marker) ? msg.split(marker) : undefined;
    const tail = (parts: string[] | undefined) =>
      parts?.[parts.length - 1]?.trim();
    const stderrTail = tail(split(stderrMarker));
    const stdoutTail = tail(split(stdoutMarker));
    const summary = msg.split('\n---')[0]?.trim() || msg;
    const failure =
      stderrTail || stdoutTail
        ? {
            message: summary,
            stdout: stdoutTail,
            stderr: stderrTail,
          }
        : undefined;

    return {
      success: false,
      outputPath: path.resolve(workingDir, outputZip),
      error: summary,
      scriptFailure: failure,
    };
  }
}

// Generate-transform function wrapper
export async function generateTransform(
  options: GenerateTransformOptions
): Promise<GenerateTransformResult> {
  const workingDir = options.cwd || process.cwd();
  const outputZip = options.outputZip || 'generated-scripts.zip';
  const handlerOptions: GenerateTransformCommandOptions = {
    ...options,
    outputZip,
    silent: true,
  };

  try {
    const outPath = await handleGenerateTransform(handlerOptions);
    const resolvedOutput = outPath || path.resolve(workingDir, outputZip);
    return {
      success: true,
      outputZipPath: resolvedOutput,
    };
  } catch (error) {
    return {
      success: false,
      outputZipPath: path.resolve(workingDir, outputZip),
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
    const uploadOptions: UploadCommandOptions = {
      input: options.input,
      pinataJwt: options.pinataJwt,
      silent: true, // Enable silent mode for library usage
      cwd: options.cwd,
    };

    return await handleUpload(uploadOptions);
  } catch (error) {
    return {
      success: false,
      errorMessage: error instanceof Error ? error.message : String(error),
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
        '0x525E59e4DE2B51f52B9e30745a513E407652AB7c',
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
      keystoreJsonPath: options.keystoreJson,
      keystorePassword: options.keystorePassword,
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
