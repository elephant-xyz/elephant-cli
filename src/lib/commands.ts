import path from 'path';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
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
import {
  NEREntityExtractorService,
  type EntityResult,
} from '../services/ner-entity-extractor.service.js';
import { EntityComparisonService } from '../services/entity-comparison.service.js';
import { TransformDataAggregatorService } from '../services/transform-data-aggregator.service.js';
import { cleanHtml } from './common.js';
import { extractZipToTemp } from '../utils/zip.js';
import {
  parseStaticPartsCsv,
  removeStaticParts,
} from '../utils/static-parts-filter.js';
import type { ExtractedEntities } from '../services/ner-entity-extractor.service.js';
import type { ComparisonResult } from '../services/entity-comparison.service.js';
import * as htmlSourceExtractor from '../utils/html-source-extractor.js';
import * as jsonSourceExtractor from '../utils/json-source-extractor.js';
import { mapEntitiesToSources } from '../services/entity-source-mapper.service.js';
import type { TextWithSource } from '../utils/html-source-extractor.js';

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

// Mirror-validate function interface
export interface MirrorValidateOptions {
  prepareZip: string;
  transformZip: string;
  staticParts?: string;
  cwd?: string;
}

export interface EntityWithoutPosition {
  value: string;
  confidence: number;
}

export interface EntitiesWithoutPositions {
  QUANTITY: EntityWithoutPosition[];
  DATE: EntityWithoutPosition[];
  ORGANIZATION: EntityWithoutPosition[];
  LOCATION: EntityWithoutPosition[];
}

export interface MirrorValidateResult {
  success: boolean;
  rawEntities: EntitiesWithoutPositions;
  transformedEntities: EntitiesWithoutPositions;
  comparison: ComparisonResult;
  globalCompleteness: number;
  globalCosineSimilarity: number;
  error?: string;
}

function addSourcesToUnmatched(
  comparison: ComparisonResult,
  rawData: { formattedText: string; sourceMap: TextWithSource[] },
  rawEntities: ExtractedEntities
): ComparisonResult {
  const categories = ['QUANTITY', 'DATE', 'ORGANIZATION', 'LOCATION'] as const;

  for (const category of categories) {
    const categoryComparison = comparison[category];
    const categoryEntities = rawEntities[category];

    if (
      Array.isArray(categoryComparison.unmatchedFromA) &&
      categoryComparison.unmatchedFromA.length > 0
    ) {
      const unmatchedWithSources = categoryComparison.unmatchedFromA.map(
        (value) => {
          const valueStr = typeof value === 'string' ? value : value.value;
          const entity = categoryEntities.find((e) => e.value === valueStr);

          if (!entity) {
            return { value: valueStr, source: 'unknown' };
          }

          const entityWithSource = mapEntitiesToSources(
            [entity],
            rawData.sourceMap,
            rawData.formattedText
          )[0];

          return entityWithSource || { value: valueStr, source: 'unknown' };
        }
      );

      categoryComparison.unmatchedFromA = unmatchedWithSources;
    }
  }

  return comparison;
}

async function extractSourceData(
  prepareDir: string,
  staticSelectors: string[] = []
): Promise<{ formattedText: string; sourceMap: TextWithSource[] }> {
  const files = await fs.readdir(prepareDir, { withFileTypes: true });
  const fileNames = files.filter((f) => f.isFile()).map((f) => f.name);

  const htmlFile =
    fileNames.find((f) => /\.html?$/i.test(f)) ||
    fileNames.find(
      (f) =>
        /\.json$/i.test(f) &&
        f !== 'address.json' &&
        f !== 'parcel.json' &&
        f !== 'unnormalized_address.json' &&
        f !== 'property_seed.json'
    );

  if (!htmlFile) {
    throw new Error('No source HTML or JSON file found in prepare output');
  }

  const filePath = path.join(prepareDir, htmlFile);
  const rawContent = await fs.readFile(filePath, 'utf-8');

  if (/\.html?$/i.test(htmlFile)) {
    let cleaned = await cleanHtml(rawContent);

    if (staticSelectors.length > 0) {
      cleaned = removeStaticParts(cleaned, staticSelectors);
    }

    return htmlSourceExtractor.extractTextWithSources(cleaned);
  }

  try {
    const json = JSON.parse(rawContent);
    return jsonSourceExtractor.extractTextWithSources(json);
  } catch {
    const text = rawContent
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return {
      formattedText: text,
      sourceMap: [{ text, source: 'unknown', lineIndex: 0 }],
    };
  }
}

// Mirror-validate function wrapper
export async function mirrorValidate(
  options: MirrorValidateOptions
): Promise<MirrorValidateResult> {
  let prepareTempDir: string | null = null;
  let transformTempDir: string | null = null;

  try {
    // Parse static parts CSV if provided
    let staticSelectors: string[] = [];
    if (options.staticParts) {
      staticSelectors = await parseStaticPartsCsv(options.staticParts);
    }

    // Extract prepare output
    const prepareTempRoot = await fs.mkdtemp(
      path.join(tmpdir(), 'elephant-validate-prepare-')
    );
    prepareTempDir = prepareTempRoot;
    await extractZipToTemp(options.prepareZip, prepareTempRoot);

    // Extract transform output
    const transformTempRoot = await fs.mkdtemp(
      path.join(tmpdir(), 'elephant-validate-transform-')
    );
    transformTempDir = transformTempRoot;
    await extractZipToTemp(options.transformZip, transformTempRoot);

    const transformDataDir = path.join(transformTempRoot, 'data');
    const transformDataDirExists = await fs
      .stat(transformDataDir)
      .then((s) => s.isDirectory())
      .catch(() => false);

    const transformDir = transformDataDirExists
      ? transformDataDir
      : transformTempRoot;

    // Extract entities from raw data with source mapping
    const rawData = await extractSourceData(prepareTempRoot, staticSelectors);

    const extractor = new NEREntityExtractorService();
    await extractor.initialize();

    const rawEntities = await extractor.extractEntities(rawData.formattedText);

    // Extract entities from transformed data
    const aggregator = new TransformDataAggregatorService();
    const aggregatedData =
      await aggregator.aggregateTransformOutput(transformDir);
    const transformedText =
      aggregator.convertAggregatedDataToText(aggregatedData);

    const transformedEntities =
      await extractor.extractEntities(transformedText);

    // Compare entities
    const comparisonService = new EntityComparisonService();
    let comparison = comparisonService.compareEntities(
      rawEntities,
      transformedEntities
    );

    // Add source information to unmatched entities
    comparison = addSourcesToUnmatched(comparison, rawData, rawEntities);

    // Strip start/end fields from entities
    const stripPositions = (entities: EntityResult[]) =>
      entities.map(({ value, confidence }) => ({ value, confidence }));

    return {
      success: true,
      rawEntities: {
        QUANTITY: stripPositions(rawEntities.QUANTITY),
        DATE: stripPositions(rawEntities.DATE),
        ORGANIZATION: stripPositions(rawEntities.ORGANIZATION),
        LOCATION: stripPositions(rawEntities.LOCATION),
      },
      transformedEntities: {
        QUANTITY: stripPositions(transformedEntities.QUANTITY),
        DATE: stripPositions(transformedEntities.DATE),
        ORGANIZATION: stripPositions(transformedEntities.ORGANIZATION),
        LOCATION: stripPositions(transformedEntities.LOCATION),
      },
      comparison,
      globalCompleteness: comparison.globalCompleteness,
      globalCosineSimilarity: comparison.globalCosineSimilarity,
    };
  } catch (error) {
    return {
      success: false,
      rawEntities: { QUANTITY: [], DATE: [], ORGANIZATION: [], LOCATION: [] },
      transformedEntities: {
        QUANTITY: [],
        DATE: [],
        ORGANIZATION: [],
        LOCATION: [],
      },
      comparison: {
        QUANTITY: {
          cosineSimilarity: 0,
          coverage: 0,
          unmatchedFromA: [],
          statsA: { count: 0, avgConfidence: 0 },
          statsB: { count: 0, avgConfidence: 0 },
        },
        DATE: {
          cosineSimilarity: 0,
          coverage: 0,
          unmatchedFromA: [],
          statsA: { count: 0, avgConfidence: 0 },
          statsB: { count: 0, avgConfidence: 0 },
        },
        ORGANIZATION: {
          cosineSimilarity: 0,
          coverage: 0,
          unmatchedFromA: [],
          statsA: { count: 0, avgConfidence: 0 },
          statsB: { count: 0, avgConfidence: 0 },
        },
        LOCATION: {
          cosineSimilarity: 0,
          coverage: 0,
          unmatchedFromA: [],
          statsA: { count: 0, avgConfidence: 0 },
          statsB: { count: 0, avgConfidence: 0 },
        },
        globalCompleteness: 0,
        globalCosineSimilarity: 0,
      },
      globalCompleteness: 0,
      globalCosineSimilarity: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    if (prepareTempDir) {
      await fs
        .rm(prepareTempDir, { recursive: true, force: true })
        .catch(() => {});
    }
    if (transformTempDir) {
      await fs
        .rm(transformTempDir, { recursive: true, force: true })
        .catch(() => {});
    }
  }
}
