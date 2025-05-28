import { Command } from 'commander';
import { promises as fsPromises, readFileSync } from 'fs';
import path from 'path';
import {
  DEFAULT_RPC_URL,
  DEFAULT_CONTRACT_ADDRESS,
  DEFAULT_IPFS_GATEWAY,
  SUBMIT_CONTRACT_ABI_FRAGMENTS,
} from '../config/constants';
import {
  createSubmitConfig,
  SubmitConfig,
} from '../config/submit.config';
import { logger } from '../utils/logger';
import { FileScannerService } from '../services/file-scanner.service';
import {
  SchemaCacheService,
  JSONSchema,
} from '../services/schema-cache.service';
import { JsonValidatorService } from '../services/json-validator.service';
import { JsonCanonicalizerService } from '../services/json-canonicalizer.service';
import { CidCalculatorService } from '../services/cid-calculator.service';
import { ChainStateService } from '../services/chain-state.service';
import { PinataService } from '../services/pinata.service';
import { TransactionBatcherService } from '../services/transaction-batcher.service';
import { CsvReporterService } from '../services/csv-reporter.service';
import { ProgressTracker, ProcessingPhase } from '../utils/progress-tracker';
import { ProcessedFile } from '../types/submit.types';
import { DataItem } from '../types/contract.types';
import { IPFSService } from '../services/ipfs.service'; // For schema downloads

// Define command options interface
export interface SubmitFilesCommandOptions {
  rpcUrl: string;
  contractAddress: string; // This will be the submit-specific contract
  privateKey: string;
  pinataJwt: string;
  inputDir: string;
  maxConcurrentUploads?: number;
  transactionBatchSize?: number;
  // ... other config overrides
  dryRun: boolean;
  // TODO: Add checkpoint path option
}

export function registerSubmitFilesCommand(program: Command) {
  program
    .command('submit-files <inputDir>')
    .description(
      'Validate, process, upload, and submit data files to the Elephant Network.'
    )
    .requiredOption(
      '-k, --private-key <key>',
      'Private key for the submitting wallet. (Or set ELEPHANT_PRIVATE_KEY env var)'
    )
    .requiredOption(
      '-j, --pinata-jwt <jwt>',
      'Pinata JWT for IPFS uploads. (Or set PINATA_JWT env var)'
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
      (val) => parseInt(val, 10)
    )
    .option(
      '--transaction-batch-size <number>',
      'Number of items per blockchain transaction.',
      (val) => parseInt(val, 10)
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
}

export async function handleSubmitFiles(
  options: SubmitFilesCommandOptions,
  serviceOverrides: SubmitFilesServiceOverrides = {}
) {
  logger.info('Starting submit-files process...');
  logger.info(`Input directory: ${options.inputDir}`);
  logger.info(`RPC URL: ${options.rpcUrl}`);
  logger.info(`Submit Contract Address: ${options.contractAddress}`);
  if (options.dryRun) {
    logger.warn(
      'DRY RUN active: No files will be uploaded, no transactions will be sent.'
    );
  }

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
  // Note: ChainStateService needs the main contract ABI, not just submit ABI.
  // Assuming ELEPHANT_CONTRACT_ABI is the correct one for general interactions if needed,
  // or pass SUBMIT_CONTRACT_ABI_FRAGMENTS if it's only for submit contract.
  // For now, using SUBMIT_CONTRACT_ABI_FRAGMENTS for both as ChainStateService primarily uses submitContract.
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

  await csvReporterService.initialize();
  logger.info(`Error reports will be saved to: ${config.errorCsvPath}`);
  logger.info(`Warning reports will be saved to: ${config.warningCsvPath}`);

  let progressTracker: ProgressTracker =
    serviceOverrides.progressTracker ?? undefined;

  try {
    // --- Phase 1: Discovery (Task 12.2) ---
    logger.info('Phase 1: Discovery - Scanning files...');
    if (!progressTracker) {
      progressTracker = new ProgressTracker(
        0,
        config.progressUpdateInterval,
        config.enableProgressBar
      ); // Initialize with 0, update later
    }
    progressTracker.start();
    progressTracker.setPhase(ProcessingPhase.SCANNING);

    const initialValidation = await fileScannerService.validateStructure(
      options.inputDir
    );
    if (!initialValidation.isValid) {
      logger.error('Input directory structure is invalid. Errors:');
      initialValidation.errors.forEach((err) => logger.error(`- ${err}`));
      await csvReporterService.finalize();
      progressTracker.stop();
      process.exit(1);
    }
    logger.info('Directory structure validation passed.');

    const totalFiles = await fileScannerService.countTotalFiles(
      options.inputDir
    );
    logger.info(`Found ${totalFiles} potential files to process.`);
    progressTracker.reset(totalFiles); // Reset with actual total
    progressTracker.start(); // Restart with correct total
    progressTracker.setPhase(ProcessingPhase.SCANNING, 100); // Scanning complete

    if (totalFiles === 0) {
      logger.info('No files found to process. Exiting.');
      progressTracker.setPhase(ProcessingPhase.COMPLETED);
      progressTracker.stop();
      await csvReporterService.finalize();
      return;
    }

    const allFilesToProcess: ProcessedFile[] = [];
    const filesForUpload: ProcessedFile[] = [];
    const dataItemsForTransaction: DataItem[] = [];

    // --- Phase 2: Validation (Task 12.3) ---
    logger.info(
      'Phase 2: Validation - Validating JSON files against schemas...'
    );
    progressTracker.setPhase(ProcessingPhase.VALIDATION);
    let validatedFileCount = 0;

    for await (const fileBatch of fileScannerService.scanDirectory(
      options.inputDir,
      config.fileScanBatchSize
    )) {
      for (const fileEntry of fileBatch) {
        progressTracker.updateQueues(
          totalFiles - validatedFileCount, // Approx validation queue
          pinataService.getQueueStats().pending,
          0 // Transaction queue not yet active
        );
        try {
          const fileContentStr = readFileSync(fileEntry.filePath, 'utf-8');
          const jsonData = JSON.parse(fileContentStr);

          // Determine schema URL/CID - this is a placeholder logic
          // In a real scenario, this might come from the file itself, a config, or naming convention
          const schemaCid = jsonData.schema || jsonData.$schema; // Example: file contains its schema CID
          if (!schemaCid || typeof schemaCid !== 'string') {
            throw new Error(
              `Schema CID not found or invalid in ${fileEntry.filePath}`
            );
          }

          const schema = await schemaCacheService.getSchema(schemaCid);
          if (!schema) {
            throw new Error(
              `Could not load schema ${schemaCid} for ${fileEntry.filePath}`
            );
          }

          const validationResult = jsonValidatorService.validate(
            jsonData,
            schema as JSONSchema
          ); // Cast schema

          if (!validationResult.valid) {
            const errorMsg = `Validation failed for ${fileEntry.filePath}: ${jsonValidatorService.getErrorMessage(validationResult.errors || [])}`;
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
          } else {
            // Store for next phase
            allFilesToProcess.push({
              propertyCid: fileEntry.propertyCid,
              dataGroupCid: fileEntry.dataGroupCid,
              filePath: fileEntry.filePath,
              canonicalJson: '', // Will be filled in processing phase
              calculatedCid: '', // Will be filled in processing phase
              validationPassed: true,
            });
            progressTracker.incrementValid();
          }
        } catch (error) {
          const errorMsg = `Error validating file ${fileEntry.filePath}: ${error instanceof Error ? error.message : String(error)}`;
          logger.error(errorMsg);
          await csvReporterService.logError({
            propertyCid: fileEntry.propertyCid,
            dataGroupCid: fileEntry.dataGroupCid,
            filePath: fileEntry.filePath,
            error: errorMsg,
            timestamp: new Date().toISOString(),
          });
          progressTracker.incrementInvalid();
          progressTracker.incrementErrors();
        }
        validatedFileCount++;
        progressTracker.incrementProcessed();
        progressTracker.setPhase(
          ProcessingPhase.VALIDATION,
          (validatedFileCount / totalFiles) * 100
        );
      }
    }
    logger.info(
      `Validation complete. Valid files: ${progressTracker.getMetrics().validFiles}, Invalid files: ${progressTracker.getMetrics().invalidFiles}`
    );

    // --- Phase 3: Processing (Task 12.4) ---
    logger.info(
      'Phase 3: Processing - Canonicalizing, calculating CIDs, checking chain state...'
    );
    progressTracker.setPhase(ProcessingPhase.PROCESSING);
    let processedFileCount = 0;

    for (const processedEntry of allFilesToProcess) {
      if (!processedEntry.validationPassed) continue; // Skip files that failed validation

      progressTracker.updateQueues(
        0, // Validation queue done
        pinataService.getQueueStats().pending,
        0 // Transaction queue not yet active
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

        // Check chain state
        const existingDataCid = await chainStateService.getCurrentDataCid(
          processedEntry.propertyCid,
          processedEntry.dataGroupCid
        );
        if (existingDataCid === calculatedCid) {
          const warningMsg = `Data CID ${calculatedCid} for ${processedEntry.filePath} already exists on chain. Skipping upload and submission.`;
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
          // Do not add to filesForUpload or dataItemsForTransaction
        } else {
          // Check if this user has already submitted this exact data CID (though for a different property/group or if existingDataCid was different)
          // This check might be more complex depending on exact requirements (e.g. if user can submit same data to different groups)
          // For now, we assume if existingDataCid is different or null, it's a new submission for this property/group.
          filesForUpload.push(processedEntry); // Add to upload list
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
      }
      processedFileCount++;
      // Note: progressTracker.incrementProcessed() was already called during validation.
      // Here we are updating the phase progress based on the subset of valid files being processed.
      if (allFilesToProcess.filter((f) => f.validationPassed).length > 0) {
        progressTracker.setPhase(
          ProcessingPhase.PROCESSING,
          (processedFileCount /
            allFilesToProcess.filter((f) => f.validationPassed).length) *
            100
        );
      }
    }
    logger.info(
      `Processing complete. Files ready for upload: ${filesForUpload.length}`
    );

    // --- Phase 4: Upload (Task 12.5) ---
    logger.info('Phase 4: Upload - Uploading files to IPFS...');
    progressTracker.setPhase(ProcessingPhase.UPLOADING);

    if (!options.dryRun) {
      if (filesForUpload.length > 0) {
        const uploadResults = await pinataService.uploadBatch(filesForUpload);
        pinataService.uploadQueue.on('task_completed', (result) => {
          progressTracker.incrementUploaded();
          progressTracker.setPhase(
            ProcessingPhase.UPLOADING,
            (progressTracker.getMetrics().uploadedFiles /
              filesForUpload.length) *
              100
          );
          // Find the original ProcessedFile to get its propertyCid and dataGroupCid
          const originalFile = filesForUpload.find(
            (f) =>
              f.calculatedCid === (result.task as ProcessedFile).calculatedCid
          ); // Assuming task is ProcessedFile
          if (originalFile && result.result?.success && result.result.cid) {
            dataItemsForTransaction.push({
              propertyCid: originalFile.propertyCid,
              dataGroupCID: originalFile.dataGroupCid,
              dataCID: result.result.cid, // Use the CID from Pinata
            });
          }
        });
        pinataService.uploadQueue.on('task_failed', (result) => {
          const originalFile = result.task as ProcessedFile;
          const errorMsg = `Upload failed for ${originalFile.filePath}: ${result.error?.message}`;
          logger.error(errorMsg);
          csvReporterService.logError({
            propertyCid: originalFile.propertyCid,
            dataGroupCid: originalFile.dataGroupCid,
            filePath: originalFile.filePath,
            error: errorMsg,
            timestamp: new Date().toISOString(),
          });
          progressTracker.incrementErrors();
        });

        await pinataService.drainQueue(); // Wait for all uploads to complete or fail

        // Process results after drain
        uploadResults.forEach((uploadResult) => {
          if (!uploadResult.success) {
            // Errors are logged by the queue event handler, but we can log a summary here if needed
            logger.warn(
              `Failed to upload for property ${uploadResult.propertyCid}, group ${uploadResult.dataGroupCid}. See error log.`
            );
          }
        });
      } else {
        logger.info('No new files to upload.');
      }
    } else {
      logger.info('[DRY RUN] Would upload files to IPFS:');
      filesForUpload.forEach((f) => {
        logger.info(`  - ${f.filePath} (Calculated CID: ${f.calculatedCid})`);
        // In a dry run, we assume upload would be successful and use calculatedCid for transaction list
        dataItemsForTransaction.push({
          propertyCid: f.propertyCid,
          dataGroupCID: f.dataGroupCid,
          dataCID: f.calculatedCid,
        });
      });
      progressTracker.setPhase(ProcessingPhase.UPLOADING, 100); // Mark as complete for dry run
    }
    logger.info(
      `Upload phase complete. Files prepared for transaction: ${dataItemsForTransaction.length}`
    );

    // --- Phase 5: Transaction (Task 12.6) ---
    logger.info('Phase 5: Transaction - Submitting data to blockchain...');
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
            progressTracker.setPhase(
              ProcessingPhase.SUBMITTING,
              (submittedTransactionCount / dataItemsForTransaction.length) * 100
            );
          }
          logger.info('All transaction batches submitted successfully.');
        } catch (error) {
          const errorMsg = `Error during transaction submission: ${error instanceof Error ? error.message : String(error)}`;
          logger.error(errorMsg);
          // Note: CsvReporterService doesn't have a generic error log, only file-specific.
          // This error is critical and affects multiple files.
          // Consider adding a general error log or handling it appropriately.
          progressTracker.incrementErrors(
            dataItemsForTransaction.length - submittedTransactionCount
          ); // Mark remaining as errors
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
      progressTracker.setPhase(ProcessingPhase.SUBMITTING, 100); // Mark as complete for dry run
    }
    logger.info('Transaction phase complete.');

    progressTracker.setPhase(ProcessingPhase.COMPLETED);
    progressTracker.stop();

    // --- Final Summary & Cleanup (Task 12.7) ---
    logger.info('Submit process finished.');
    const summary = await csvReporterService.finalize();
    const finalMetrics = progressTracker.getMetrics();

    logger.info('--- Final Report ---');
    logger.info(`Total files scanned: ${totalFiles}`);
    logger.info(`Files passed validation: ${finalMetrics.validFiles}`);
    logger.info(`Files failed validation: ${finalMetrics.invalidFiles}`);
    logger.info(
      `Files processed (canonicalized, CID calculated): ${allFilesToProcess.filter((f) => f.validationPassed).length}`
    );
    logger.info(
      `Files skipped (already on chain or other reasons): ${finalMetrics.skippedFiles}`
    );
    if (!options.dryRun) {
      logger.info(`Files attempted for upload: ${filesForUpload.length}`);
      logger.info(`Files successfully uploaded: ${finalMetrics.uploadedFiles}`);
      logger.info(
        `Data items submitted to blockchain: ${submittedTransactionCount}`
      );
    } else {
      logger.info(
        `[DRY RUN] Files that would be uploaded: ${filesForUpload.length}`
      );
      logger.info(
        `[DRY RUN] Data items that would be submitted: ${dataItemsForTransaction.length}`
      );
    }
    logger.info(
      `Total errors logged: ${summary.errorCount + (finalMetrics.errorCount - summary.errorCount)}`
    ); // Combine CSV and progress tracker errors
    logger.info(
      `Total warnings logged: ${summary.warningCount + (finalMetrics.warningCount - summary.warningCount)}`
    );
    logger.info(
      `Duration: ${progressTracker.formatTime(finalMetrics.elapsedTime)}`
    );
    logger.info(`Error report: ${config.errorCsvPath}`);
    logger.info(`Warning report: ${config.warningCsvPath}`);
    // Handle checkpoint saving / cleanup if implemented
  } catch (error) {
    logger.error(
      `An unhandled error occurred: ${error instanceof Error ? error.message : String(error)}`
    );
    if (progressTracker!) {
      progressTracker.setPhase(ProcessingPhase.ERROR);
      progressTracker.stop();
    }
    await csvReporterService.finalize(); // Ensure reports are closed
    process.exit(1);
  }
}
