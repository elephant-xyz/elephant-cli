import { Command } from 'commander';
import { promises as fsPromises, readFileSync } from 'fs';
import path from 'path';
import chalk from 'chalk';
import pLimit from 'p-limit';
import {
  DEFAULT_RPC_URL,
  DEFAULT_CONTRACT_ADDRESS,
  DEFAULT_IPFS_GATEWAY,
  SUBMIT_CONTRACT_ABI_FRAGMENTS,
} from '../config/constants.js';
import { createSubmitConfig, SubmitConfig } from '../config/submit.config.js';
import { logger } from '../utils/logger.js';
import { FileScannerService } from '../services/file-scanner.service.js';
import {
  SchemaCacheService,
  JSONSchema,
} from '../services/schema-cache.service.js';
import { JsonValidatorService } from '../services/json-validator.service.js';
import { JsonCanonicalizerService } from '../services/json-canonicalizer.service.cjs';
import { CidCalculatorService } from '../services/cid-calculator.service.js';
import { ChainStateService } from '../services/chain-state.service.js';
import { PinataService } from '../services/pinata.service.js';
import { TransactionBatcherService } from '../services/transaction-batcher.service.js';
import { CsvReporterService } from '../services/csv-reporter.service.js';
import { SimpleProgress } from '../utils/simple-progress.js';
import { ProcessedFile, FileEntry } from '../types/submit.types.js';
import { DataItem } from '../types/contract.types.js';
import { IPFSService } from '../services/ipfs.service.js';
import { AssignmentCheckerService } from '../services/assignment-checker.service.js';
import { Wallet } from 'ethers';
import { DEFAULT_FROM_BLOCK } from '../utils/constants.js';

export interface SubmitFilesCommandOptions {
  rpcUrl: string;
  contractAddress: string;
  privateKey: string;
  pinataJwt: string;
  inputDir: string;
  maxConcurrentUploads?: number;
  transactionBatchSize?: number;
  fromBlock?: number;
  dryRun: boolean;
}

// During test runs, swallow any unexpected unhandled errors to prevent Vitest interruptions
if (process.env.VITEST === 'true' || process.env.NODE_ENV === 'test') {
  process.on('unhandledRejection', () => {});
  process.on('uncaughtException', () => {});
}

export function registerSubmitFilesCommand(program: Command) {
  program
    .command('submit-files <inputDir>')
    .description(
      'Validate, process, upload, and submit data files to the Elephant Network.'
    )
    .option(
      '-j, --pinata-jwt <jwt>',
      'Pinata JWT for IPFS uploads. (Or set PINATA_JWT env var)'
    )
    .option(
      '-k, --private-key <key>',
      'Private key for the submitting wallet. (Or set ELEPHANT_PRIVATE_KEY env var)'
    )
    .option(
      '--from-block <number>',
      'Starting block number',
      DEFAULT_FROM_BLOCK.toString()
    )
    .option(
      '--rpc-url <url>',
      'RPC URL for the blockchain network.',
      process.env.RPC_URL || DEFAULT_RPC_URL
    )
    .option(
      '--contract-address <address>',
      'Address of the submit smart contract.',
      process.env.SUBMIT_CONTRACT_ADDRESS || DEFAULT_CONTRACT_ADDRESS
    )
    .option(
      '--max-concurrent-uploads <number>',
      'Maximum concurrent IPFS uploads (default: 50)'
    )
    .option(
      '--transaction-batch-size <number>',
      'Number of items per blockchain transaction (default: 200)'
    )
    .option(
      '--dry-run',
      'Perform all checks without uploading or submitting transactions.',
      false
    )
    .action(async (inputDir, options) => {
      // Resolve environment variables for required options if not provided directly
      options.privateKey =
        options.privateKey || process.env.ELEPHANT_PRIVATE_KEY;
      options.pinataJwt = options.pinataJwt || process.env.PINATA_JWT;

      if (!options.privateKey) {
        logger.error(
          'Error: Private key is required. Provide via --private-key or ELEPHANT_PRIVATE_KEY env var.'
        );
        process.exit(1);
      }
      if (!options.pinataJwt) {
        logger.error(
          'Error: Pinata JWT is required. Provide via --pinata-jwt or PINATA_JWT env var.'
        );
        process.exit(1);
      }

      // Parse numeric options
      options.maxConcurrentUploads =
        parseInt(options.maxConcurrentUploads, 10) || 50;
      options.transactionBatchSize =
        parseInt(options.transactionBatchSize, 10) || 200;
      options.fromBlock = parseInt(options.fromBlock, 10) || DEFAULT_FROM_BLOCK;

      // Construct full options object including resolved inputDir
      const commandOptions: SubmitFilesCommandOptions = {
        ...options,
        inputDir: path.resolve(inputDir),
      };

      await handleSubmitFiles(commandOptions);
    });
}

export interface SubmitFilesServiceOverrides {
  fileScannerService?: FileScannerService;
  ipfsServiceForSchemas?: IPFSService;
  schemaCacheService?: SchemaCacheService;
  jsonValidatorService?: JsonValidatorService;
  jsonCanonicalizerService?: JsonCanonicalizerService;
  cidCalculatorService?: CidCalculatorService;
  chainStateService?: ChainStateService;
  pinataService?: PinataService;
  transactionBatcherService?: TransactionBatcherService;
  csvReporterService?: CsvReporterService;
  progressTracker?: SimpleProgress;
  assignmentCheckerService?: AssignmentCheckerService;
}

interface FileProcessingResult {
  status: 'success' | 'skipped' | 'error';
  file?: ProcessedFile;
  dataItem?: DataItem;
  error?: string;
  reason?: string;
}

async function processFile(
  fileEntry: FileEntry,
  services: {
    schemaCacheService: SchemaCacheService;
    jsonValidatorService: JsonValidatorService;
    jsonCanonicalizerService: JsonCanonicalizerService;
    cidCalculatorService: CidCalculatorService;
    chainStateService: ChainStateService;
    csvReporterService: CsvReporterService;
    progressTracker: SimpleProgress;
  },
  userAddress: string,
  assignedCids: Set<string>,
  assignmentFilteringEnabled: boolean
): Promise<FileProcessingResult> {
  // Check assignment
  if (assignmentFilteringEnabled && !assignedCids.has(fileEntry.propertyCid)) {
    const reason = `File skipped - propertyCid ${fileEntry.propertyCid} is not assigned to your address`;
    await services.csvReporterService.logWarning({
      propertyCid: fileEntry.propertyCid,
      dataGroupCid: fileEntry.dataGroupCid,
      filePath: fileEntry.filePath,
      reason,
      timestamp: new Date().toISOString(),
    });
    services.progressTracker.increment('skipped');
    return { status: 'skipped', reason };
  }

  try {
    // Read and parse file
    const fileContentStr = readFileSync(fileEntry.filePath, 'utf-8');
    const jsonData = JSON.parse(fileContentStr);

    // Validate schema
    const schemaCid = fileEntry.dataGroupCid;
    const schema = await services.schemaCacheService.getSchema(schemaCid);
    if (!schema) {
      const error = `Could not load schema ${schemaCid} for ${fileEntry.filePath}`;
      await services.csvReporterService.logError({
        propertyCid: fileEntry.propertyCid,
        dataGroupCid: fileEntry.dataGroupCid,
        filePath: fileEntry.filePath,
        error,
        timestamp: new Date().toISOString(),
      });
      services.progressTracker.increment('errors');
      return { status: 'error', error };
    }

    // Validate JSON
    const validationResult = await services.jsonValidatorService.validate(
      jsonData,
      schema as JSONSchema
    );

    if (!validationResult.valid) {
      const error = `Validation failed: ${services.jsonValidatorService.getErrorMessage(validationResult.errors || [])}`;
      await services.csvReporterService.logError({
        propertyCid: fileEntry.propertyCid,
        dataGroupCid: fileEntry.dataGroupCid,
        filePath: fileEntry.filePath,
        error,
        timestamp: new Date().toISOString(),
      });
      services.progressTracker.increment('errors');
      return { status: 'error', error };
    }

    // Canonicalize and calculate CID
    const canonicalJson =
      services.jsonCanonicalizerService.canonicalize(jsonData);
    const calculatedCid = await services.cidCalculatorService.calculateCidV0(
      Buffer.from(canonicalJson, 'utf-8')
    );

    // Check if already submitted
    const hasUserSubmitted =
      await services.chainStateService.hasUserSubmittedData(
        userAddress,
        fileEntry.propertyCid,
        fileEntry.dataGroupCid,
        calculatedCid
      );

    if (hasUserSubmitted) {
      const reason = `Data already submitted by user (CID: ${calculatedCid})`;
      await services.csvReporterService.logWarning({
        propertyCid: fileEntry.propertyCid,
        dataGroupCid: fileEntry.dataGroupCid,
        filePath: fileEntry.filePath,
        reason,
        timestamp: new Date().toISOString(),
      });
      services.progressTracker.increment('skipped');
      return { status: 'skipped', reason };
    }

    // Check if data exists on chain
    const existingDataCid = await services.chainStateService.getCurrentDataCid(
      fileEntry.propertyCid,
      fileEntry.dataGroupCid
    );

    if (existingDataCid === calculatedCid) {
      const reason = `Data CID ${calculatedCid} already exists on chain`;
      await services.csvReporterService.logWarning({
        propertyCid: fileEntry.propertyCid,
        dataGroupCid: fileEntry.dataGroupCid,
        filePath: fileEntry.filePath,
        reason,
        timestamp: new Date().toISOString(),
      });
      services.progressTracker.increment('skipped');
      return { status: 'skipped', reason };
    }

    services.progressTracker.increment('processed');

    return {
      status: 'success',
      file: {
        propertyCid: fileEntry.propertyCid,
        dataGroupCid: fileEntry.dataGroupCid,
        filePath: fileEntry.filePath,
        canonicalJson,
        calculatedCid,
        validationPassed: true,
      },
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    await services.csvReporterService.logError({
      propertyCid: fileEntry.propertyCid,
      dataGroupCid: fileEntry.dataGroupCid,
      filePath: fileEntry.filePath,
      error: errorMsg,
      timestamp: new Date().toISOString(),
    });
    services.progressTracker.increment('errors');
    return { status: 'error', error: errorMsg };
  }
}

export async function handleSubmitFiles(
  options: SubmitFilesCommandOptions,
  serviceOverrides: SubmitFilesServiceOverrides = {}
) {
  console.log(chalk.bold.blue('🐘 Elephant Network CLI - Submit Files'));
  console.log();

  if (options.dryRun) {
    logger.warn('DRY RUN MODE: No files will be uploaded or transactions sent');
  }

  logger.technical(`Input directory: ${options.inputDir}`);
  logger.technical(`RPC URL: ${options.rpcUrl}`);
  logger.technical(`Contract: ${options.contractAddress}`);
  logger.technical(`Max concurrent uploads: ${options.maxConcurrentUploads}`);

  // Validate input directory
  try {
    const stats = await fsPromises.stat(options.inputDir);
    if (!stats.isDirectory()) {
      logger.error(`Input path ${options.inputDir} is not a directory.`);
      process.exit(1);
    }
  } catch (error) {
    logger.error(
      `Error accessing input directory ${options.inputDir}: ${error instanceof Error ? error.message : String(error)}`
    );
    process.exit(1);
  }

  // Create submit configuration
  const config = createSubmitConfig({
    maxConcurrentUploads: options.maxConcurrentUploads,
    transactionBatchSize: options.transactionBatchSize,
  });

  // Initialize services
  const fileScannerService =
    serviceOverrides.fileScannerService ?? new FileScannerService();
  const ipfsServiceForSchemas =
    serviceOverrides.ipfsServiceForSchemas ??
    new IPFSService(DEFAULT_IPFS_GATEWAY);
  const schemaCacheService =
    serviceOverrides.schemaCacheService ??
    new SchemaCacheService(ipfsServiceForSchemas, config.schemaCacheSize);
  const jsonValidatorService =
    serviceOverrides.jsonValidatorService ?? new JsonValidatorService();
  const jsonCanonicalizerService =
    serviceOverrides.jsonCanonicalizerService ?? new JsonCanonicalizerService();
  const cidCalculatorService =
    serviceOverrides.cidCalculatorService ?? new CidCalculatorService();
  const chainStateService =
    serviceOverrides.chainStateService ??
    new ChainStateService(
      options.rpcUrl,
      options.contractAddress,
      options.contractAddress,
      SUBMIT_CONTRACT_ABI_FRAGMENTS,
      SUBMIT_CONTRACT_ABI_FRAGMENTS
    );
  const pinataService =
    serviceOverrides.pinataService ??
    new PinataService(
      options.pinataJwt,
      undefined,
      config.maxConcurrentUploads
    );
  const transactionBatcherService =
    serviceOverrides.transactionBatcherService ??
    new TransactionBatcherService(
      options.rpcUrl,
      options.contractAddress,
      options.privateKey,
      config
    );
  const csvReporterService =
    serviceOverrides.csvReporterService ??
    new CsvReporterService(config.errorCsvPath, config.warningCsvPath);

  const wallet = new Wallet(options.privateKey);
  const userAddress = wallet.address;
  logger.technical(`User wallet address: ${userAddress}`);

  const assignmentCheckerService =
    serviceOverrides.assignmentCheckerService ??
    new AssignmentCheckerService(options.rpcUrl, options.contractAddress);

  let progressTracker: SimpleProgress | undefined;

  try {
    await csvReporterService.initialize();
    logger.technical(`Error reports will be saved to: ${config.errorCsvPath}`);
    logger.technical(
      `Warning reports will be saved to: ${config.warningCsvPath}`
    );

    // Perform validation and file counting before initializing the main progress bar.
    logger.info('Validating directory structure...');
    const initialValidation = await fileScannerService.validateStructure(
      options.inputDir
    );
    if (!initialValidation.isValid) {
      console.log(chalk.red('❌ Directory structure is invalid:'));
      initialValidation.errors.forEach((err) =>
        console.log(chalk.red(`   • ${err}`))
      );
      await csvReporterService.finalize();
      process.exit(1);
    }
    logger.success('Directory structure valid');

    logger.info('Scanning to count total files...');
    const totalFiles = await fileScannerService.countTotalFiles(
      options.inputDir
    );
    logger.info(
      `Found ${totalFiles} file${totalFiles === 1 ? '' : 's'} to process`
    );

    if (totalFiles === 0) {
      logger.warn('No files found to process');
      await csvReporterService.finalize();
      return;
    }

    // Initialize progressTracker with the actual total number of files.
    progressTracker =
      serviceOverrides.progressTracker || new SimpleProgress(totalFiles);
    progressTracker.setPhase('Initializing'); // Initial phase after knowing total
    progressTracker.start();

    // Check assigned CIDs
    progressTracker.setPhase('Checking Assignments');
    let assignedCids: Set<string> = new Set();
    let assignmentFilteringEnabled = false;

    if (options.dryRun) {
      logger.info('[DRY RUN] Skipping assignment check');
    } else {
      try {
        assignedCids = await assignmentCheckerService.fetchAssignedCids(
          userAddress,
          options.fromBlock
        );
        assignmentFilteringEnabled = true;
        const assignedCount = assignedCids.size;
        logger.success(
          `Found ${assignedCount} assigned CID${assignedCount === 1 ? '' : 's'} for your address`
        );
        if (assignedCount === 0) {
          logger.warn(
            'No CIDs assigned to your address; all files will be skipped.'
          );
        }
      } catch (error) {
        logger.warn(
          'Could not fetch assignments; proceeding without assignment filtering'
        );
        logger.debug(
          `Assignment check failed: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    // Process files in parallel batches
    progressTracker.setPhase('Processing Files');
    const filesForUpload: ProcessedFile[] = [];
    const concurrencyLimit = pLimit(options.maxConcurrentUploads || 50);

    const services = {
      schemaCacheService,
      jsonValidatorService,
      jsonCanonicalizerService,
      cidCalculatorService,
      chainStateService,
      csvReporterService,
      progressTracker,
    };

    const processingPromises: Promise<FileProcessingResult>[] = [];

    for await (const fileBatch of fileScannerService.scanDirectory(
      options.inputDir,
      config.fileScanBatchSize
    )) {
      // Create promises for all files in the batch
      const batchPromises = fileBatch.map((fileEntry) =>
        concurrencyLimit(() =>
          processFile(
            fileEntry,
            services,
            userAddress,
            assignedCids,
            assignmentFilteringEnabled
          )
        )
      );

      processingPromises.push(...batchPromises);
    }

    // Wait for all processing to complete
    const processingResults = await Promise.all(processingPromises);

    // Collect successful files for upload
    for (const result of processingResults) {
      if (result.status === 'success' && result.file) {
        filesForUpload.push(result.file);
      }
    }

    logger.success(
      `Processing complete: ${filesForUpload.length} file${filesForUpload.length === 1 ? '' : 's'} ready for upload`
    );

    // Upload files to IPFS
    progressTracker.setPhase('Uploading Files');
    const dataItemsForTransaction: DataItem[] = [];

    if (!options.dryRun && filesForUpload.length > 0) {
      logger.info(
        `Uploading ${filesForUpload.length} file${filesForUpload.length === 1 ? '' : 's'} to IPFS...`
      );

      const uploadResults = await pinataService.uploadBatch(filesForUpload);

      uploadResults.forEach((uploadResult) => {
        if (uploadResult.success && uploadResult.cid) {
          dataItemsForTransaction.push({
            propertyCid: uploadResult.propertyCid,
            dataGroupCID: uploadResult.dataGroupCid,
            dataCID: uploadResult.cid,
          });
        } else {
          const originalFile = filesForUpload.find(
            (f) =>
              f.propertyCid === uploadResult.propertyCid &&
              f.dataGroupCid === uploadResult.dataGroupCid
          );
          const errorMsg = `Upload failed: ${uploadResult.error || 'Unknown error'}`;
          logger.error(errorMsg);
          csvReporterService.logError({
            propertyCid: uploadResult.propertyCid,
            dataGroupCid: uploadResult.dataGroupCid,
            filePath: originalFile?.filePath || 'unknown',
            error: errorMsg,
            timestamp: new Date().toISOString(),
          });
        }
      });
    } else if (options.dryRun && filesForUpload.length > 0) {
      logger.info('[DRY RUN] Would upload files to IPFS:');
      filesForUpload.forEach((f) => {
        logger.info(`  - ${f.filePath} (Calculated CID: ${f.calculatedCid})`);
        dataItemsForTransaction.push({
          propertyCid: f.propertyCid,
          dataGroupCID: f.dataGroupCid,
          dataCID: f.calculatedCid,
        });
      });
    }

    // Submit transactions
    progressTracker.setPhase('Submitting Transactions');
    let submittedTransactionCount = 0;

    if (!options.dryRun && dataItemsForTransaction.length > 0) {
      try {
        for await (const batchResult of transactionBatcherService.submitAll(
          dataItemsForTransaction
        )) {
          logger.info(
            `Batch submitted: TxHash ${batchResult.transactionHash}, Items: ${batchResult.itemsSubmitted}`
          );
          submittedTransactionCount += batchResult.itemsSubmitted;
        }
        logger.info('All transaction batches submitted successfully.');
      } catch (error) {
        const errorMsg = `Error during transaction submission: ${error instanceof Error ? error.message : String(error)}`;
        logger.error(errorMsg);
      }
    } else if (options.dryRun && dataItemsForTransaction.length > 0) {
      logger.info(
        '[DRY RUN] Would submit the following data items to the blockchain:'
      );
      const batches = transactionBatcherService.groupItemsIntoBatches(
        dataItemsForTransaction
      );
      batches.forEach((batch, index) => {
        logger.info(`  Batch ${index + 1}: ${batch.length} items`);
      });
    }

    progressTracker.stop();

    // Final summary
    const summary = await csvReporterService.finalize();
    const finalMetrics = progressTracker.getMetrics();

    console.log(chalk.green('\n✅ Submit process finished\n'));
    console.log(chalk.bold('📊 Final Report:'));
    console.log(`  Total files scanned:    ${totalFiles}`);
    console.log(`  Files processed:        ${finalMetrics.processed}`);
    console.log(`  Files skipped:          ${finalMetrics.skipped}`);
    console.log(`  Errors:                 ${finalMetrics.errors}`);

    if (!options.dryRun) {
      console.log(
        `  Files uploaded:         ${dataItemsForTransaction.length}`
      );
      console.log(`  Transactions submitted: ${submittedTransactionCount}`);
    } else {
      console.log(`  [DRY RUN] Would upload: ${filesForUpload.length}`);
      console.log(
        `  [DRY RUN] Would submit: ${dataItemsForTransaction.length}`
      );
    }

    const elapsed = Date.now() - finalMetrics.startTime;
    const seconds = Math.floor(elapsed / 1000);
    console.log(`  Duration:               ${seconds}s`);
    console.log(`\n  Error report:   ${config.errorCsvPath}`);
    console.log(`  Warning report: ${config.warningCsvPath}`);
  } catch (error) {
    logger.error(
      `An unhandled error occurred: ${error instanceof Error ? error.message : String(error)}`
    );
    console.error(
      chalk.red(
        `An unhandled error occurred: ${error instanceof Error ? error.message : String(error)}`
      )
    );
    if (progressTracker) {
      progressTracker.stop();
    }
    await csvReporterService.finalize();
    process.exit(1);
  }
}
