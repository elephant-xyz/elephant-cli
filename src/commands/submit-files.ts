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
import { JsonCanonicalizerService } from '../services/json-canonicalizer.service.js';
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
    .option(
      '-j, --pinata-jwt <jwt>',
      'Pinata JWT for IPFS uploads. (Or set PINATA_JWT env var)'
    )
    .option(
      '-k, --private-key <key>',
      'Private key for the submitting wallet. (Or set ELEPHANT_PRIVATE_KEY env var)'
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
  
  // Derive wallet address from private key to check assignments
  const wallet = new Wallet(options.privateKey);
  const userAddress = wallet.address;
  logger.technical(`User wallet address: ${userAddress}`);
  
  const assignmentCheckerService =
    serviceOverrides.assignmentCheckerService ??
    new AssignmentCheckerService(options.rpcUrl, options.contractAddress);

  await csvReporterService.initialize();
  logger.technical(`Error reports will be saved to: ${config.errorCsvPath}`);
  logger.technical(
    `Warning reports will be saved to: ${config.warningCsvPath}`
  );

  const progressTracker: ProgressTracker =
    serviceOverrides.progressTracker ||
    new ProgressTracker(
      0,
      config.progressUpdateInterval,
      config.enableProgressBar
    );

  try {
    // --- Phase 1: Discovery (Task 12.2) ---
    console.log(chalk.bold('📁 Phase 1: Discovery'));
    logger.progress('Scanning files and validating directory structure...');
    progressTracker.start();
    progressTracker.setPhase(ProcessingPhase.SCANNING);

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
    console.log(chalk.green('✅ Directory structure valid'));

    const totalFiles = await fileScannerService.countTotalFiles(
      options.inputDir
    );
    console.log(
      chalk.blue(
        `   Found ${totalFiles} file${totalFiles === 1 ? '' : 's'} to process`
      )
    );
    progressTracker.reset(totalFiles); // Reset with actual total
    progressTracker.start(); // Restart with correct total
    progressTracker.setPhase(ProcessingPhase.SCANNING, 100); // Scanning complete

    if (totalFiles === 0) {
      console.log(chalk.yellow('⚠️  No files found to process'));
      progressTracker.setPhase(ProcessingPhase.COMPLETED);
      progressTracker.stop();
      await csvReporterService.finalize();
      return;
    }

    // --- Phase 1.5: Assignment Check ---
    console.log();
    console.log(chalk.bold('🔗 Phase 1.5: Assignment Check'));
    logger.progress('Fetching assigned CIDs for your address...');
    
    let assignedCids: Set<string>;
    try {
      assignedCids = await assignmentCheckerService.fetchAssignedCids(userAddress);
      const assignedCount = assignedCids.size;
      console.log(chalk.green(`✅ Found ${assignedCount} assigned CID${assignedCount === 1 ? '' : 's'} for your address`));
      
      if (assignedCount === 0) {
        console.log(chalk.yellow('⚠️  No CIDs assigned to your address. All files will be skipped.'));
      }
    } catch (error) {
      console.log(chalk.yellow('⚠️  Could not fetch assignments - proceeding without assignment filtering'));
      logger.warn(`Assignment check failed: ${error instanceof Error ? error.message : String(error)}`);
      assignedCids = new Set(); // Empty set means no filtering
    }

    const allFilesToProcess: ProcessedFile[] = [];
    const filesForUpload: ProcessedFile[] = [];
    const dataItemsForTransaction: DataItem[] = [];

    // --- Phase 2: Validation (Task 12.3) ---
    console.log();
    console.log(chalk.bold('🔍 Phase 2: Validation'));
    logger.progress('Validating JSON files against schemas...');
    progressTracker.setPhase(ProcessingPhase.VALIDATION);
    let validatedFileCount = 0;

    for await (const fileBatch of fileScannerService.scanDirectory(
      options.inputDir,
      config.fileScanBatchSize
    )) {
      for (const fileEntry of fileBatch) {
        progressTracker.updateQueues(
          totalFiles - validatedFileCount, // Approx validation queue
          0, // No upload queue with semaphore
          0 // Transaction queue not yet active
        );
        
        // Check if this file's dataGroupCid is assigned to the user
        if (assignedCids.size > 0 && !assignedCids.has(fileEntry.dataGroupCid)) {
          const warningMsg = `File skipped - dataGroupCid ${fileEntry.dataGroupCid} is not assigned to your address`;
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
          validatedFileCount++;
          progressTracker.incrementProcessed();
          progressTracker.setPhase(
            ProcessingPhase.VALIDATION,
            (validatedFileCount / totalFiles) * 100
          );
          continue; // Skip this file
        }
        
        try {
          const fileContentStr = readFileSync(fileEntry.filePath, 'utf-8');
          const jsonData = JSON.parse(fileContentStr);

          const schemaCid = fileEntry.dataGroupCid;
          if (!schemaCid || typeof schemaCid !== 'string') {
            throw new Error(`Schema CID not found or invalid`);
          }

          const schema = await schemaCacheService.getSchema(schemaCid);
          if (!schema) {
            throw new Error(
              `Could not load schema ${schemaCid} for ${fileEntry.filePath}`
            );
          }

          const validationResult = await jsonValidatorService.validate(
            jsonData,
            schema as JSONSchema
          );

          if (!validationResult.valid) {
            const errorMsg = `Validation failed, ${jsonValidatorService.getErrorMessage(validationResult.errors || [])}`;
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
          const errorMsg =
            error instanceof Error ? error.message : String(error);
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
    const validFiles = progressTracker.getMetrics().validFiles;
    const invalidFiles = progressTracker.getMetrics().invalidFiles;
    console.log(
      chalk.green(
        `✅ Validation complete: ${validFiles} valid, ${invalidFiles} invalid`
      )
    );

    // --- Phase 3: Processing (Task 12.4) ---
    console.log();
    console.log(chalk.bold('⚙️ Phase 3: Processing'));
    logger.progress(
      'Canonicalizing, calculating CIDs, checking chain state...'
    );
    progressTracker.setPhase(ProcessingPhase.PROCESSING);
    let processedFileCount = 0;

    for (const processedEntry of allFilesToProcess) {
      if (!processedEntry.validationPassed) continue; // Skip files that failed validation

      progressTracker.updateQueues(
        0, // Validation queue done
        0, // No upload queue with semaphore
        0 // Transaction queue not yet active
      );

      try {
        const fileContentStr = readFileSync(processedEntry.filePath, 'utf-8');
        const jsonData = JSON.parse(fileContentStr);

        const canonicalJson =
          await jsonCanonicalizerService.canonicalize(jsonData);
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
    console.log(
      chalk.green(
        `✅ Processing complete: ${filesForUpload.length} file${filesForUpload.length === 1 ? '' : 's'} ready for upload`
      )
    );

    // --- Phase 4: Upload (Task 12.5) ---
    console.log();
    console.log(chalk.bold('☁️ Phase 4: Upload'));
    progressTracker.setPhase(ProcessingPhase.UPLOADING);

    if (!options.dryRun) {
      if (filesForUpload.length > 0) {
        logger.progress(
          `Uploading ${filesForUpload.length} file${filesForUpload.length === 1 ? '' : 's'} to IPFS...`
        );
        const uploadResults = await pinataService.uploadBatch(filesForUpload);

        // Process results directly since uploadBatch now returns all results
        uploadResults.forEach((uploadResult) => {
          if (uploadResult.success && uploadResult.cid) {
            // Successfully uploaded
            progressTracker.incrementUploaded();
            dataItemsForTransaction.push({
              propertyCid: uploadResult.propertyCid,
              dataGroupCID: uploadResult.dataGroupCid,
              dataCID: uploadResult.cid,
            });
          } else {
            // Upload failed
            const originalFile = filesForUpload.find(
              (f) =>
                f.propertyCid === uploadResult.propertyCid &&
                f.dataGroupCid === uploadResult.dataGroupCid
            );
            const fileName =
              originalFile?.filePath?.split('/').pop() || 'unknown file';
            console.log(chalk.red(`❌ Upload failed: ${fileName}`));
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
          }
        });

        progressTracker.setPhase(ProcessingPhase.UPLOADING, 100);
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
