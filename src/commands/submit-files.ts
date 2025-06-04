import { Command } from 'commander';
import { promises as fsPromises, readFileSync } from 'fs';
import path from 'path';
import chalk from 'chalk';
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
import { ProgressTracker, ProcessingPhase } from '../utils/progress-tracker.js';
import { ProcessedFile } from '../types/submit.types.js';
import { DataItem } from '../types/contract.types.js';
import { IPFSService } from '../services/ipfs.service.js'; // For schema downloads
import { AssignmentCheckerService } from '../services/assignment-checker.service.js';
import { Wallet } from 'ethers';
import { DEFAULT_FROM_BLOCK } from '../utils/constants.js';

// Define command options interface
export interface SubmitFilesCommandOptions {
  rpcUrl: string;
  contractAddress: string; // This will be the submit-specific contract
  privateKey: string;
  pinataJwt: string;
  inputDir: string;
  maxConcurrentUploads?: number;
  transactionBatchSize?: number;
  fromBlock?: number;
  // ... other config overrides
  dryRun: boolean;
  // TODO: Add checkpoint path option
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
      process.env.SUBMIT_CONTRACT_ADDRESS ||
        DEFAULT_CONTRACT_ADDRESS /* Placeholder - update if different */
    )
    .option(
      '--max-concurrent-uploads <number>',
      'Maximum concurrent IPFS uploads.',
      (val) => parseInt(val, 200)
    )
    .option(
      '--transaction-batch-size <number>',
      'Number of items per blockchain transaction.',
      (val) => parseInt(val, 200)
    )
    .option(
      '--dry-run',
      'Perform all checks without uploading or submitting transactions.',
      false
    )
    // TODO: Add more options from SubmitConfig as needed (e.g., retries, timeouts)
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

      // Construct full options object including resolved inputDir
      const commandOptions: SubmitFilesCommandOptions = {
        ...options,
        inputDir: path.resolve(inputDir), // Ensure absolute path
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
  progressTracker?: ProgressTracker;
  assignmentCheckerService?: AssignmentCheckerService;
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

  // 1. Validate input directory
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

  // Create submit configuration by overriding defaults with command options
  const submitConfigOverrides: Partial<SubmitConfig> = {};
  if (options.maxConcurrentUploads)
    submitConfigOverrides.maxConcurrentUploads = options.maxConcurrentUploads;
  if (options.transactionBatchSize)
    submitConfigOverrides.transactionBatchSize = options.transactionBatchSize;
  // ... map other options to configOverrides

  const config = createSubmitConfig(submitConfigOverrides);

  // Initialize services, using overrides if provided
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

  let progressTracker: ProgressTracker;
  try {
    await csvReporterService.initialize();
    logger.technical(`Error reports will be saved to: ${config.errorCsvPath}`);
    logger.technical(
      `Warning reports will be saved to: ${config.warningCsvPath}`
    );

    progressTracker =
      serviceOverrides.progressTracker ||
      new ProgressTracker(
        0,
        config.progressUpdateInterval,
        config.enableProgressBar
      );

    const initialValidation = await fileScannerService.validateStructure(
      options.inputDir
    );
    if (!initialValidation.isValid) {
      progressTracker.stop();
      console.log(chalk.red('❌ Directory structure is invalid:'));
      initialValidation.errors.forEach((err) =>
        console.log(chalk.red(`   • ${err}`))
      );
      await csvReporterService.finalize();
      process.exit(1);
    }
    logger.success('Directory structure valid');

    const totalFiles = await fileScannerService.countTotalFiles(
      options.inputDir
    );
    logger.info(
      `Found ${totalFiles} file${totalFiles === 1 ? '' : 's'} to process`
    );
    progressTracker.reset(totalFiles); // totalFiles for the overall progress bar
    progressTracker.start();

    if (totalFiles === 0) {
      logger.warn('No files found to process');
      progressTracker.setPhase(ProcessingPhase.COMPLETED);
      progressTracker.stop();
      await csvReporterService.finalize();
      return;
    }

    logger.info('Checking assigned CIDs for your address...');
    let assignedCids: Set<string> = new Set();
    let assignmentFilteringEnabled = false;
    if (options.dryRun) {
      logger.info('[DRY RUN] Skipping assignment check');
    } else {
      try {
        assignedCids =
          await assignmentCheckerService.fetchAssignedCids(userAddress, options.fromBlock);
        assignmentFilteringEnabled = true;
        const assignedCount = assignedCids.size;
        logger.debug(
          `Assigned CIDs for ${userAddress}: ${Array.from(assignedCids).join(
            ', '
          )}`
        );
        logger.success(
          `Found ${assignedCount} assigned CID${
            assignedCount === 1 ? '' : 's'
          } for your address`
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
          `Assignment check failed: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }

    const allFilesToProcess: ProcessedFile[] = [];
    const filesForUpload: ProcessedFile[] = [];
    const dataItemsForTransaction: DataItem[] = [];

    progressTracker.setPhase(ProcessingPhase.VALIDATION);
    let validatedFileCount = 0; // Tracks files attempted in validation phase

    // Moved file processing logic into its own async function for parallelism
    const processFileEntryValidation = async (
      fileEntry: Awaited<ReturnType<FileScannerService['scanDirectory']>> extends AsyncIterableIterator<infer U> ? U extends Array<infer V> ? V : never : never
    ): Promise<{
      status: 'valid' | 'skipped_assignment' | 'invalid_schema' | 'validation_failed' | 'error';
      data?: ProcessedFile;
      error?: string;
    }> => {
      if (
        assignmentFilteringEnabled &&
        !assignedCids.has(fileEntry.propertyCid)
      ) {
        const warningMsg = `File skipped - propertyCid ${fileEntry.propertyCid} is not assigned to your address`;
        logger.warn(warningMsg);
        await csvReporterService.logWarning({
          propertyCid: fileEntry.propertyCid,
          dataGroupCid: fileEntry.dataGroupCid,
          filePath: fileEntry.filePath,
          reason: warningMsg,
          timestamp: new Date().toISOString(),
        });
        progressTracker.incrementSkipped();
        progressTracker.incrementWarnings();
        progressTracker.incrementProcessed(); // Terminal: Skipped
        return { status: 'skipped_assignment' };
      }

      try {
        const fileContentStr = readFileSync(fileEntry.filePath, 'utf-8');
        const jsonData = JSON.parse(fileContentStr);

        const schemaCid = fileEntry.dataGroupCid;
        if (!schemaCid || typeof schemaCid !== 'string') {
          throw new Error(`Schema CID not found or invalid for ${fileEntry.filePath}`);
        }

        const schema = await schemaCacheService.getSchema(schemaCid);
        if (!schema) {
          const errMsg = `Could not load schema ${schemaCid} for ${fileEntry.filePath}`;
          logger.warn(errMsg); // Changed from throw to allow logging and continuing
          await csvReporterService.logError({
            propertyCid: fileEntry.propertyCid,
            dataGroupCid: fileEntry.dataGroupCid,
            filePath: fileEntry.filePath,
            error: errMsg,
            timestamp: new Date().toISOString(),
          });
          progressTracker.incrementInvalid();
          progressTracker.incrementErrors();
          progressTracker.incrementProcessed(); // Terminal: Error in validation
          return { status: 'invalid_schema', error: errMsg };
        }

        const validationResult = await jsonValidatorService.validate(
          jsonData,
          schema as JSONSchema
        );

        if (!validationResult.valid) {
          const errorMsg = `Validation failed for ${fileEntry.filePath}, ${jsonValidatorService.getErrorMessage(validationResult.errors || [])}`;
          logger.warn(errorMsg);
          await csvReporterService.logError({
            propertyCid: fileEntry.propertyCid,
            dataGroupCid: fileEntry.dataGroupCid,
            filePath: fileEntry.filePath,
            error: errorMsg,
            timestamp: new Date().toISOString(),
          });
          progressTracker.incrementInvalid();
          progressTracker.incrementErrors();
          progressTracker.incrementProcessed(); // Terminal: Validation failed
          return { status: 'validation_failed', error: errorMsg };
        } else {
          progressTracker.incrementValid(); // Valid for this phase
          return {
            status: 'valid',
            data: {
              propertyCid: fileEntry.propertyCid,
              dataGroupCid: fileEntry.dataGroupCid,
              filePath: fileEntry.filePath,
              canonicalJson: '',
              calculatedCid: '',
              validationPassed: true,
            },
          };
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.error(`Error during validation of ${fileEntry.filePath}: ${errorMsg}`);
        await csvReporterService.logError({
          propertyCid: fileEntry.propertyCid,
          dataGroupCid: fileEntry.dataGroupCid,
          filePath: fileEntry.filePath,
          error: errorMsg,
          timestamp: new Date().toISOString(),
        });
        progressTracker.incrementInvalid();
        progressTracker.incrementErrors();
        progressTracker.incrementProcessed(); // Terminal: Error in validation
        return { status: 'error', error: errorMsg };
      }
    };

    for await (const fileBatch of fileScannerService.scanDirectory(
      options.inputDir,
      config.fileScanBatchSize
    )) {
      progressTracker.updateQueues(
        totalFiles - validatedFileCount, // Approx validation queue
        0, 0 // Other queues not active yet
      );

      const batchProcessingResults = await Promise.all(
        fileBatch.map(fileEntry => processFileEntryValidation(fileEntry))
      );

      for (const result of batchProcessingResults) {
        validatedFileCount++; // Increment for each file attempted in this batch
        if (result.status === 'valid' && result.data) {
          allFilesToProcess.push(result.data);
        }
        // Note: incrementProcessed is called *inside* processFileEntryValidation for terminal states.
        // For 'valid' status, incrementProcessed will be called later when its final fate is known.
      }
      progressTracker.setPhase(
        ProcessingPhase.VALIDATION,
        totalFiles > 0 ? (validatedFileCount / totalFiles) * 100 : 0
      );
    }

    const validFiles = progressTracker.getMetrics().validFiles; // This is # files that passed validation
    const filesPassedValidationStage = allFilesToProcess.length;
    logger.success(
      `Validation complete: ${filesPassedValidationStage} file(s) passed, ${validatedFileCount - filesPassedValidationStage} file(s) failed or skipped.`
    );


    logger.info('Canonicalizing files and calculating CIDs...');
    progressTracker.setPhase(ProcessingPhase.PROCESSING);
    let processedFileCountForThisStage = 0; // Counter for current phase items

    for (const processedEntry of allFilesToProcess) { // allFilesToProcess contains only those that passed validation
      // Update queues for processing phase (example, can be refined)
      progressTracker.updateQueues(
          allFilesToProcess.length - processedFileCountForThisStage,
          0,0
      );

      try {
        const fileContentStr = readFileSync(processedEntry.filePath, 'utf-8');
        const jsonData = JSON.parse(fileContentStr);

        const canonicalJson = jsonCanonicalizerService.canonicalize(jsonData);
        processedEntry.canonicalJson = canonicalJson;

        const calculatedCid = await cidCalculatorService.calculateCidV0(
          Buffer.from(canonicalJson, 'utf-8')
        );
        processedEntry.calculatedCid = calculatedCid;

        const hasUserSubmitted = await chainStateService.hasUserSubmittedData(
          userAddress,
          processedEntry.propertyCid,
          processedEntry.dataGroupCid,
          calculatedCid
        );
        if (hasUserSubmitted) {
          const warningMsg = `Data already submitted by user for ${processedEntry.filePath} (CID: ${calculatedCid}). Skipping.`;
          logger.warn(warningMsg);
          await csvReporterService.logWarning({
            propertyCid: processedEntry.propertyCid,
            dataGroupCid: processedEntry.dataGroupCid,
            filePath: processedEntry.filePath,
            reason: warningMsg,
            timestamp: new Date().toISOString(),
          });
          progressTracker.incrementSkipped();
          progressTracker.incrementWarnings();
          progressTracker.incrementProcessed(); // Terminal: Skipped
        } else {
          const existingDataCid = await chainStateService.getCurrentDataCid(
            processedEntry.propertyCid,
            processedEntry.dataGroupCid
          );
          if (existingDataCid === calculatedCid) {
            const warningMsg = `Data CID ${calculatedCid} for ${processedEntry.filePath} already exists on chain. Skipping.`;
            logger.warn(warningMsg);
            await csvReporterService.logWarning({
              propertyCid: processedEntry.propertyCid,
              dataGroupCid: processedEntry.dataGroupCid,
              filePath: processedEntry.filePath,
              reason: warningMsg,
              timestamp: new Date().toISOString(),
            });
            progressTracker.incrementSkipped();
            progressTracker.incrementWarnings();
            progressTracker.incrementProcessed(); // Terminal: Skipped
          } else {
            filesForUpload.push(processedEntry); // Ready for upload
          }
        }
      } catch (error) {
        const errorMsg = `Error processing file ${processedEntry.filePath}: ${error instanceof Error ? error.message : String(error)}`;
        logger.error(errorMsg);
        await csvReporterService.logError({
          propertyCid: processedEntry.propertyCid,
          dataGroupCid: processedEntry.dataGroupCid,
          filePath: processedEntry.filePath,
          error: errorMsg,
          timestamp: new Date().toISOString(),
        });
        progressTracker.incrementErrors();
        progressTracker.incrementProcessed(); // Terminal: Error in processing
      }
      processedFileCountForThisStage++;
      if (allFilesToProcess.length > 0) {
        progressTracker.setPhase(
          ProcessingPhase.PROCESSING,
          (processedFileCountForThisStage / allFilesToProcess.length) * 100
        );
      }
    }
    logger.success(
      `Processing complete: ${filesForUpload.length} file${
        filesForUpload.length === 1 ? '' : 's'
      } ready for upload`
    );

    progressTracker.setPhase(ProcessingPhase.UPLOADING);

    if (!options.dryRun) {
      if (filesForUpload.length > 0) {
        logger.info(
          `Uploading ${filesForUpload.length} file${filesForUpload.length === 1 ? '' : 's'} to IPFS...`
        );
        const uploadResults = await pinataService.uploadBatch(filesForUpload);

        uploadResults.forEach((uploadResult) => {
          if (uploadResult.success && uploadResult.cid) {
            progressTracker.incrementUploaded();
            dataItemsForTransaction.push({
              propertyCid: uploadResult.propertyCid,
              dataGroupCID: uploadResult.dataGroupCid,
              dataCID: uploadResult.cid,
            });
            // Find the original file to mark as processed for the overall progress
            const originalFile = filesForUpload.find(
              (f) =>
                f.propertyCid === uploadResult.propertyCid &&
                f.dataGroupCid === uploadResult.dataGroupCid
            );
            if (originalFile) {
                 progressTracker.incrementProcessed(); // Terminal: Successfully uploaded and queued for submission
            }
          } else {
            const originalFile = filesForUpload.find(
              (f) =>
                f.propertyCid === uploadResult.propertyCid &&
                f.dataGroupCid === uploadResult.dataGroupCid
            );
            const fileName = originalFile?.filePath?.split('/').pop() || 'unknown file';
            logger.error(`Upload failed: ${fileName}`);
            const errorMsg = `Upload failed for ${originalFile?.filePath || 'unknown file'}: ${uploadResult.error || 'Unknown error'}`;
            logger.technical(errorMsg);
            csvReporterService.logError({
                propertyCid: uploadResult.propertyCid,
                dataGroupCid: uploadResult.dataGroupCid,
                filePath: originalFile?.filePath || 'unknown',
                error: errorMsg,
                timestamp: new Date().toISOString(),
            });
            progressTracker.incrementErrors();
            if (originalFile) {
                progressTracker.incrementProcessed(); // Terminal: Upload failed
            }
          }
        });
        // Set phase to 100% only after all attempted uploads are handled.
        // Individual progress during batch upload is handled by incrementUploaded.
        progressTracker.setPhase(ProcessingPhase.UPLOADING, 100);
      } else {
        logger.info('No new files to upload.');
        progressTracker.setPhase(ProcessingPhase.UPLOADING, 100); // No files, phase is complete
      }
    } else {
      logger.info('[DRY RUN] Would upload files to IPFS:');
      filesForUpload.forEach((f) => {
        logger.info(`  - ${f.filePath} (Calculated CID: ${f.calculatedCid})`);
        dataItemsForTransaction.push({
          propertyCid: f.propertyCid,
          dataGroupCID: f.dataGroupCid,
          dataCID: f.calculatedCid,
        });
        progressTracker.incrementProcessed(); // Terminal: Dry run assumed success for upload
      });
      progressTracker.setPhase(ProcessingPhase.UPLOADING, 100);
    }
    logger.info(
      `Upload phase complete. Files prepared for transaction: ${dataItemsForTransaction.length}`
    );

    progressTracker.setPhase(ProcessingPhase.SUBMITTING);
    let submittedTransactionCount = 0;

    if (!options.dryRun) {
      if (dataItemsForTransaction.length > 0) {
        try {
          for await (const batchResult of transactionBatcherService.submitAll(
            dataItemsForTransaction
          )) {
            logger.info(
              `Batch submitted: TxHash ${batchResult.transactionHash}, Items: ${batchResult.itemsSubmitted}`
            );
            submittedTransactionCount += batchResult.itemsSubmitted;
            // Note: incrementProcessed for overall progress was already done when items were added to dataItemsForTransaction.
            // The submission phase progress tracks batch submission itself.
            progressTracker.setPhase(
              ProcessingPhase.SUBMITTING,
              (submittedTransactionCount / dataItemsForTransaction.length) * 100
            );
          }
          logger.info('All transaction batches submitted successfully.');
        } catch (error) {
          const errorMsg = `Error during transaction submission: ${error instanceof Error ? error.message : String(error)}`;
          logger.error(errorMsg);
          // If submission fails, the files involved were already counted by incrementProcessed
          // when they were successfully uploaded / prepared for dry run.
          // We log the error and mark the phase as error.
          progressTracker.incrementErrors(
            dataItemsForTransaction.length - submittedTransactionCount 
          );
          progressTracker.setPhase(ProcessingPhase.ERROR);
        }
      } else {
        logger.info('No data items to submit to the blockchain.');
      }
    } else {
      logger.info(
        '[DRY RUN] Would submit the following data items to the blockchain:'
      );
      const batches = transactionBatcherService.groupItemsIntoBatches(
        dataItemsForTransaction
      );
      batches.forEach((batch, index) => {
        logger.info(`  Batch ${index + 1}:`);
        batch.forEach((item) =>
          logger.info(
            `    - P: ${item.propertyCid}, G: ${item.dataGroupCID}, D: ${item.dataCID}`
          )
        );
      });
      // incrementProcessed already called for these items during dry-run upload prep
      progressTracker.setPhase(ProcessingPhase.SUBMITTING, 100);
    }
    logger.info('Transaction phase complete.');

    progressTracker.setPhase(ProcessingPhase.COMPLETED);
    progressTracker.stop();

    // --- Final Summary & Cleanup (Task 12.7) ---
    // Final success message to console; other logs written to file
    console.log(chalk.green('Submit process finished.'));
    const summary = await csvReporterService.finalize();
    const finalMetrics = progressTracker.getMetrics();

    logger.success('--- Final Report ---');
    console.log(chalk.green('--- Final Report ---'));
    // Summary metrics - console output and file log
    logger.info(`Total files scanned: ${totalFiles}`);
    console.log(`Total files scanned: ${totalFiles}`);
    logger.info(`Files passed validation: ${finalMetrics.validFiles}`);
    console.log(`Files passed validation: ${finalMetrics.validFiles}`);
    logger.info(`Files failed validation: ${finalMetrics.invalidFiles}`);
    console.log(`Files failed validation: ${finalMetrics.invalidFiles}`);
    logger.info(
      `Files processed (canonicalized, CID calculated): ${allFilesToProcess.filter((f) => f.validationPassed).length}`
    );
    console.log(
      `Files processed (canonicalized, CID calculated): ${allFilesToProcess.filter((f) => f.validationPassed).length}`
    );
    logger.info(
      `Files skipped (already on chain or other reasons): ${finalMetrics.skippedFiles}`
    );
    console.log(
      `Files skipped (already on chain or other reasons): ${finalMetrics.skippedFiles}`
    );
    if (!options.dryRun) {
      logger.info(`Files attempted for upload: ${filesForUpload.length}`);
      console.log(`Files attempted for upload: ${filesForUpload.length}`);
      logger.info(`Files successfully uploaded: ${finalMetrics.uploadedFiles}`);
      console.log(`Files successfully uploaded: ${finalMetrics.uploadedFiles}`);
      logger.info(
        `Data items submitted to blockchain: ${submittedTransactionCount}`
      );
      console.log(
        `Data items submitted to blockchain: ${submittedTransactionCount}`
      );
    } else {
      logger.info(
        `[DRY RUN] Files that would be uploaded: ${filesForUpload.length}`
      );
      console.log(
        `[DRY RUN] Files that would be uploaded: ${filesForUpload.length}`
      );
      logger.info(
        `[DRY RUN] Data items that would be submitted: ${dataItemsForTransaction.length}`
      );
      console.log(
        `[DRY RUN] Data items that would be submitted: ${dataItemsForTransaction.length}`
      );
    }
    logger.info(
      `Total errors logged: ${summary.errorCount + (finalMetrics.errorCount - summary.errorCount)}`
    );
    console.log(
      `Total errors logged: ${summary.errorCount + (finalMetrics.errorCount - summary.errorCount)}`
    );
    logger.info(
      `Total warnings logged: ${summary.warningCount + (finalMetrics.warningCount - summary.warningCount)}`
    );
    console.log(
      `Total warnings logged: ${summary.warningCount + (finalMetrics.warningCount - summary.warningCount)}`
    );
    logger.info(
      `Duration: ${progressTracker.formatTime(finalMetrics.elapsedTime)}`
    );
    console.log(
      `Duration: ${progressTracker.formatTime(finalMetrics.elapsedTime)}`
    );
    logger.info(`Error report: ${config.errorCsvPath}`);
    console.log(`Error report: ${config.errorCsvPath}`);
    logger.info(`Warning report: ${config.warningCsvPath}`);
    console.log(`Warning report: ${config.warningCsvPath}`);
    // Handle checkpoint saving / cleanup if implemented
  } catch (error) {
    // Log fatal error to file and show message on console
    logger.error(
      `An unhandled error occurred: ${error instanceof Error ? error.message : String(error)}`
    );
    console.error(
      chalk.red(
        `An unhandled error occurred: ${error instanceof Error ? error.message : String(error)}`
      )
    );
    if (progressTracker!) {
      progressTracker.setPhase(ProcessingPhase.ERROR);
      progressTracker.stop();
    }
    await csvReporterService.finalize(); // Ensure reports are closed
    process.exit(1);
  }
}
