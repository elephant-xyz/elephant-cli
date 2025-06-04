import { Command } from 'commander';
import { promises as fsPromises, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import chalk from 'chalk';
import { Semaphore } from 'async-mutex';
import { Readable } from 'stream';
import { execSync } from 'child_process';
import {
  DEFAULT_RPC_URL,
  DEFAULT_CONTRACT_ADDRESS,
  DEFAULT_IPFS_GATEWAY,
} from '../config/constants.js';
import { createSubmitConfig } from '../config/submit.config.js';
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
import { CsvReporterService } from '../services/csv-reporter.service.js';
import { SimpleProgress } from '../utils/simple-progress.js';
import { ProcessedFile, FileEntry } from '../types/submit.types.js';
import { DataItem } from '../types/contract.types.js';
import { IPFSService } from '../services/ipfs.service.js';
import { AssignmentCheckerService } from '../services/assignment-checker.service.js';
import { Wallet } from 'ethers';
import { DEFAULT_FROM_BLOCK } from '../utils/constants.js';

export interface ValidateAndUploadCommandOptions {
  rpcUrl: string;
  contractAddress: string;
  privateKey: string;
  pinataJwt: string;
  inputDir: string;
  outputCsv: string;
  maxConcurrentUploads?: number;
  fromBlock?: number;
  dryRun: boolean;
}

interface FileProcessingResult {
  status: 'success' | 'skipped' | 'error';
  file?: ProcessedFile;
  error?: string;
  reason?: string;
}

interface UploadRecord {
  propertyCid: string;
  dataGroupCid: string;
  dataCid: string;
  filePath: string;
  uploadedAt: string;
}

export function registerValidateAndUploadCommand(program: Command) {
  program
    .command('validate-and-upload <inputDir>')
    .description(
      'Validate files against schemas and upload to IPFS, generating a CSV report'
    )
    .option(
      '-j, --pinata-jwt <jwt>',
      'Pinata JWT for IPFS uploads. (Or set PINATA_JWT env var)'
    )
    .option(
      '-k, --private-key <key>',
      'Private key for checking assignments. (Or set ELEPHANT_PRIVATE_KEY env var)'
    )
    .option(
      '-o, --output-csv <path>',
      'Output CSV file path',
      'upload-results.csv'
    )
    .option(
      '--from-block <number>',
      'Starting block number for assignment check',
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
      'Target maximum concurrent local file processing tasks (default: 50). This may be automatically capped at 75% of the OS maximum open files limit if detectable (e.g., via ulimit -n). Actual IPFS uploads are managed by Pinata service limits.',
      undefined
    )
    .option(
      '--dry-run',
      'Perform validation without uploading to IPFS.',
      false
    )
    .action(async (inputDir, options) => {
      options.privateKey = options.privateKey || process.env.ELEPHANT_PRIVATE_KEY;
      options.pinataJwt = options.pinataJwt || process.env.PINATA_JWT;

      if (!options.privateKey) {
        logger.error(
          'Error: Private key is required. Provide via --private-key or ELEPHANT_PRIVATE_KEY env var.'
        );
        process.exit(1);
      }
      if (!options.pinataJwt && !options.dryRun) {
        logger.error(
          'Error: Pinata JWT is required for uploads. Provide via --pinata-jwt or PINATA_JWT env var.'
        );
        process.exit(1);
      }

      options.maxConcurrentUploads = parseInt(options.maxConcurrentUploads, 10) || undefined;
      options.fromBlock = parseInt(options.fromBlock, 10) || DEFAULT_FROM_BLOCK;

      const commandOptions: ValidateAndUploadCommandOptions = {
        ...options,
        inputDir: path.resolve(inputDir),
      };

      await handleValidateAndUpload(commandOptions);
    });
}

export interface ValidateAndUploadServiceOverrides {
  fileScannerService?: FileScannerService;
  ipfsServiceForSchemas?: IPFSService;
  schemaCacheService?: SchemaCacheService;
  jsonValidatorService?: JsonValidatorService;
  jsonCanonicalizerService?: JsonCanonicalizerService;
  cidCalculatorService?: CidCalculatorService;
  pinataService?: PinataService;
  csvReporterService?: CsvReporterService;
  progressTracker?: SimpleProgress;
  assignmentCheckerService?: AssignmentCheckerService;
}

export async function handleValidateAndUpload(
  options: ValidateAndUploadCommandOptions,
  serviceOverrides: ValidateAndUploadServiceOverrides = {}
) {
  console.log(chalk.bold.blue('🐘 Elephant Network CLI - Validate and Upload'));
  console.log();

  if (options.dryRun) {
    logger.warn('DRY RUN MODE: No files will be uploaded');
  }

  logger.technical(`Input directory: ${options.inputDir}`);
  logger.technical(`Output CSV: ${options.outputCsv}`);
  logger.technical(`RPC URL: ${options.rpcUrl}`);
  logger.technical(`Contract: ${options.contractAddress}`);

  const FALLBACK_LOCAL_CONCURRENCY = 10; // Fallback if no other value is determined
  let effectiveConcurrency: number;
  let concurrencyLogReason = '';
  const userSpecifiedConcurrency = options.maxConcurrentUploads; // This is number | undefined

  let calculatedOsCap: number | undefined = undefined;
  try {
    const ulimitOutput = execSync('ulimit -n', { encoding: 'utf8', stdio: 'pipe' }).trim();
    const osMaxFiles = parseInt(ulimitOutput, 10);
    if (!isNaN(osMaxFiles) && osMaxFiles > 0) {
      calculatedOsCap = Math.max(1, Math.floor(osMaxFiles * 0.75));
      logger.info(`System maximum open files (ulimit -n): ${osMaxFiles}. Calculated concurrency cap (0.75 * OS limit): ${calculatedOsCap}.`);
    } else {
      logger.warn(`Could not determine a valid OS open file limit from 'ulimit -n' output: "${ulimitOutput}". OS-based capping will not be applied.`);
    }
  } catch (error) {
    logger.warn(`Failed to check OS open file limit (e.g., 'ulimit' command not available). OS-based capping will not be applied. Error: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (userSpecifiedConcurrency !== undefined) {
    concurrencyLogReason = `User specified: ${userSpecifiedConcurrency}.`;
    if (calculatedOsCap !== undefined) {
      if (userSpecifiedConcurrency > calculatedOsCap) {
        effectiveConcurrency = calculatedOsCap;
        concurrencyLogReason += ` Capped by OS limit to ${effectiveConcurrency}.`;
      } else {
        effectiveConcurrency = userSpecifiedConcurrency;
        concurrencyLogReason += ` Within OS limit of ${calculatedOsCap}.`;
      }
    } else {
      effectiveConcurrency = userSpecifiedConcurrency;
      concurrencyLogReason += ` OS limit not determined, using user value.`;
    }
  } else {
    // User did not specify concurrency
    if (calculatedOsCap !== undefined) {
      effectiveConcurrency = calculatedOsCap;
      concurrencyLogReason = `Derived from OS limit (${effectiveConcurrency}), as no user value was provided.`;
    } else {
      effectiveConcurrency = FALLBACK_LOCAL_CONCURRENCY;
      concurrencyLogReason = `Using fallback value (${effectiveConcurrency}), as no user value was provided and OS limit could not be determined.`;
    }
  }

  if (effectiveConcurrency === null) {
    logger.error('Error: Effective concurrency is null. This should not happen.');
    process.exit(1);
  }

  logger.technical(`Effective max concurrent local processing tasks: ${effectiveConcurrency}. Reason: ${concurrencyLogReason}`);

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

  const config = createSubmitConfig({
    maxConcurrentUploads: undefined,
  });

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
  const csvReporterService =
    serviceOverrides.csvReporterService ??
    new CsvReporterService(config.errorCsvPath, config.warningCsvPath);
  const pinataService =
    serviceOverrides.pinataService ??
    new PinataService(
      options.pinataJwt,
    );

  const wallet = new Wallet(options.privateKey);
  const userAddress = wallet.address;
  logger.technical(`User wallet address: ${userAddress}`);

  const assignmentCheckerService =
    serviceOverrides.assignmentCheckerService ??
    new AssignmentCheckerService(options.rpcUrl, options.contractAddress);

  let progressTracker: SimpleProgress | undefined;
  const uploadRecords: UploadRecord[] = [];

  try {
    await csvReporterService.initialize();
    logger.technical(`Error reports will be saved to: ${config.errorCsvPath}`);
    logger.technical(`Warning reports will be saved to: ${config.warningCsvPath}`);

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
    const totalFiles = await fileScannerService.countTotalFiles(options.inputDir);
    logger.info(`Found ${totalFiles} file${totalFiles === 1 ? '' : 's'} to process`);

    if (totalFiles === 0) {
      logger.warn('No files found to process');
      await csvReporterService.finalize();
      return;
    }

    progressTracker = serviceOverrides.progressTracker || new SimpleProgress(totalFiles);
    progressTracker.setPhase('Initializing');
    progressTracker.start();

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
          logger.warn('No CIDs assigned to your address; all files will be skipped.');
        }
      } catch (error) {
        logger.warn('Could not fetch assignments; proceeding without assignment filtering');
        logger.debug(
          `Assignment check failed: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    // Pre-fetch all unique schemas
    progressTracker.setPhase('Pre-fetching Schemas');
    logger.info('Discovering all unique schema CIDs...');
    try {
      const allDataGroupCids = await fileScannerService.getAllDataGroupCids(options.inputDir);
      const uniqueSchemaCidsArray = Array.from(allDataGroupCids);
      logger.info(`Found ${uniqueSchemaCidsArray.length} unique schema CIDs to pre-fetch.`);

      if (uniqueSchemaCidsArray.length > 0) {
        const schemaProgress = new SimpleProgress(uniqueSchemaCidsArray.length);
        schemaProgress.start();
        let prefetchedCount = 0;
        let failedCount = 0;

        // Consider potential for overwhelming IPFS gateway if many unique schemas.
        
        // Let's do them sequentially to avoid overwhelming the gateway and for clearer logging here.
        for (const schemaCid of uniqueSchemaCidsArray) {
          let fetchSuccess = false;
          try {
            const schema = await schemaCacheService.getSchema(schemaCid);
            if (schema) {
              logger.debug(`Successfully pre-fetched and cached schema ${schemaCid}`);
              prefetchedCount++;
              fetchSuccess = true;
            } else {
              logger.warn(`Could not pre-fetch schema ${schemaCid}. It will be attempted again during file processing.`);
              failedCount++;
            }
          } catch (error) {
            logger.warn(
              `Error pre-fetching schema ${schemaCid}: ${error instanceof Error ? error.message : String(error)}. It will be attempted again during file processing.`
            );
            failedCount++;
          }
          schemaProgress.increment(fetchSuccess ? 'processed' : 'errors'); 
        }
        schemaProgress.stop();
        logger.info(`Schema pre-fetching complete: ${prefetchedCount} successful, ${failedCount} failed/not found.`);
      }
    } catch (error) {
      logger.error(`Failed to discover or pre-fetch schemas: ${error instanceof Error ? error.message : String(error)}`);
      // Decide if this is a fatal error. For now, log and continue, as individual file processing will still attempt schema loading.
    }

    progressTracker.setPhase('Processing Files');
    const localProcessingSemaphore = new Semaphore(effectiveConcurrency);

    const services = {
      schemaCacheService,
      jsonValidatorService,
      jsonCanonicalizerService,
      cidCalculatorService,
      csvReporterService,
      progressTracker,
      pinataService,
    };

    const allOperationPromises: Promise<void>[] = [];

    for await (const fileBatch of fileScannerService.scanDirectory(
      options.inputDir,
      config.fileScanBatchSize
    )) {
      for (const fileEntry of fileBatch) {
        allOperationPromises.push(
          localProcessingSemaphore.runExclusive(async () =>
            processFileAndGetUploadPromise(
              fileEntry,
              services,
              userAddress,
              assignedCids,
              assignmentFilteringEnabled,
              options,
              uploadRecords
            )
          )
        );
      }
    }

    await Promise.all(allOperationPromises);

    progressTracker.stop();

    const summary = await csvReporterService.finalize();
    const finalMetrics = progressTracker.getMetrics();

    console.log(chalk.green('\n✅ Validation and upload process finished\n'));
    console.log(chalk.bold('📊 Final Report:'));
    console.log(`  Total files scanned:    ${totalFiles}`);
    console.log(`  Files skipped (assignment): ${finalMetrics.skipped || 0}`);
    console.log(`  Processing/upload errors: ${finalMetrics.errors || 0}`);
    
    if (!options.dryRun) {
      console.log(`  Successfully processed (validated & uploaded):  ${finalMetrics.processed || 0}`);
    } else {
      console.log(`  [DRY RUN] Files processed (validated): ${finalMetrics.processed || 0}`);
    }
    
    const totalHandled = (finalMetrics.skipped || 0) + 
                         (finalMetrics.errors || 0) + 
                         (finalMetrics.processed || 0);

    console.log(`  Total files handled:    ${totalHandled}`);

    const elapsed = Date.now() - finalMetrics.startTime;
    const seconds = Math.floor(elapsed / 1000);
    console.log(`  Duration:               ${seconds}s`);
    console.log(`\n  Error report:   ${config.errorCsvPath}`);
    console.log(`  Warning report: ${config.warningCsvPath}`);
    console.log(`  Upload results: ${options.outputCsv}`);

    if (uploadRecords.length > 0) {
      const csvHeader = 'propertyCid,dataGroupCid,dataCid,filePath,uploadedAt\n';
      const csvContent = uploadRecords
        .map(
          (record) =>
            `${record.propertyCid},${record.dataGroupCid},${record.dataCid},"${record.filePath}",${record.uploadedAt}`
        )
        .join('\n');
      
      writeFileSync(options.outputCsv, csvHeader + csvContent);
      logger.success(`Upload results saved to: ${options.outputCsv}`);
    }

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

async function processFileAndGetUploadPromise(
  fileEntry: FileEntry,
  services: {
    schemaCacheService: SchemaCacheService;
    jsonValidatorService: JsonValidatorService;
    jsonCanonicalizerService: JsonCanonicalizerService;
    cidCalculatorService: CidCalculatorService;
    csvReporterService: CsvReporterService;
    progressTracker: SimpleProgress;
    pinataService: PinataService;
  },
  userAddress: string,
  assignedCids: Set<string>,
  assignmentFilteringEnabled: boolean,
  options: ValidateAndUploadCommandOptions,
  uploadRecords: UploadRecord[]
): Promise<void> {
  if (assignmentFilteringEnabled && !assignedCids.has(fileEntry.propertyCid)) {
    const reason = `File skipped - propertyCid ${fileEntry.propertyCid} is not assigned to your address ${userAddress}`;
    await services.csvReporterService.logWarning({
      propertyCid: fileEntry.propertyCid,
      dataGroupCid: fileEntry.dataGroupCid,
      filePath: fileEntry.filePath,
      reason,
      timestamp: new Date().toISOString(),
    });
    services.progressTracker.increment('skipped');
    return;
  }

  let jsonData;
  try {
    const fileContentStr = await fsPromises.readFile(fileEntry.filePath, 'utf-8');
    jsonData = JSON.parse(fileContentStr);
  } catch (readOrParseError) {
    const errorMsg = readOrParseError instanceof Error ? readOrParseError.message : String(readOrParseError);
    await services.csvReporterService.logError({
      propertyCid: fileEntry.propertyCid,
      dataGroupCid: fileEntry.dataGroupCid,
      filePath: fileEntry.filePath,
      error: `File read/parse error: ${errorMsg}`,
      timestamp: new Date().toISOString(),
    });
    services.progressTracker.increment('errors');
    return;
  }

  try {
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
      return;
    }

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
      return;
    }

    const canonicalJson = services.jsonCanonicalizerService.canonicalize(jsonData);
    const calculatedCid = await services.cidCalculatorService.calculateCidV0(
      Buffer.from(canonicalJson, 'utf-8')
    );

    const processedFile: ProcessedFile = {
      propertyCid: fileEntry.propertyCid,
      dataGroupCid: fileEntry.dataGroupCid,
      filePath: fileEntry.filePath,
      canonicalJson,
      calculatedCid,
      validationPassed: true,
    };

    if (options.dryRun) {
      logger.info(`[DRY RUN] Would upload ${processedFile.filePath} (Calculated CID: ${processedFile.calculatedCid})`);
      uploadRecords.push({
        propertyCid: processedFile.propertyCid,
        dataGroupCid: processedFile.dataGroupCid,
        dataCid: processedFile.calculatedCid,
        filePath: processedFile.filePath,
        uploadedAt: new Date().toISOString(),
      });
      services.progressTracker.increment('processed');
      return Promise.resolve();
    } else {
      return services.pinataService.uploadBatch([processedFile])
        .then(uploadResults => {
          if (uploadResults && uploadResults[0] && uploadResults[0].success && uploadResults[0].cid) {
            const ipfsCid = uploadResults[0].cid;
            uploadRecords.push({
              propertyCid: processedFile.propertyCid,
              dataGroupCid: processedFile.dataGroupCid,
              dataCid: ipfsCid,
              filePath: processedFile.filePath,
              uploadedAt: new Date().toISOString(),
            });
            services.progressTracker.increment('processed');
            logger.debug(`Successfully uploaded ${processedFile.filePath} to IPFS. CID: ${ipfsCid}`);
          } else {
            const errorDetail = uploadResults && uploadResults[0] ? uploadResults[0].error : 'Unknown upload error';
            const errorMsg = `Upload failed for ${processedFile.filePath}: ${errorDetail}`;
            logger.error(errorMsg);
            services.csvReporterService.logError({
              propertyCid: processedFile.propertyCid,
              dataGroupCid: processedFile.dataGroupCid,
              filePath: processedFile.filePath,
              error: `Upload failed: ${errorDetail}`,
              timestamp: new Date().toISOString(),
            });
            services.progressTracker.increment('errors');
          }
        })
        .catch(uploadError => {
          const errorMsg = uploadError instanceof Error ? uploadError.message : String(uploadError);
          logger.error(`Upload exception for ${processedFile.filePath}: ${errorMsg}`);
          services.csvReporterService.logError({
            propertyCid: processedFile.propertyCid,
            dataGroupCid: processedFile.dataGroupCid,
            filePath: processedFile.filePath,
            error: `Upload exception: ${errorMsg}`,
            timestamp: new Date().toISOString(),
          });
          services.progressTracker.increment('errors');
        });
    }
  } catch (processingError) {
    const errorMsg = processingError instanceof Error ? processingError.message : String(processingError);
    await services.csvReporterService.logError({
      propertyCid: fileEntry.propertyCid,
      dataGroupCid: fileEntry.dataGroupCid,
      filePath: fileEntry.filePath,
      error: `Processing error: ${errorMsg}`,
      timestamp: new Date().toISOString(),
    });
    services.progressTracker.increment('errors');
  }
}