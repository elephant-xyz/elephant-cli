import { Command } from 'commander';
import { promises as fsPromises, writeFileSync } from 'fs';
import path from 'path';
import chalk from 'chalk';
import { Semaphore } from 'async-mutex';
import { execSync } from 'child_process';
import * as os from 'os';
import { DEFAULT_IPFS_GATEWAY } from '../config/constants.js';
import { createSubmitConfig } from '../config/submit.config.js';
import { logger } from '../utils/logger.js';
import { FileScannerService } from '../services/file-scanner.service.js';
import { SchemaCacheService } from '../services/schema-cache.service.js';
import { JsonValidatorService } from '../services/json-validator.service.js';
import { JsonCanonicalizerService } from '../services/json-canonicalizer.service.cjs';
import { IPLDCanonicalizerService } from '../services/ipld-canonicalizer.service.js';
import { CidCalculatorService } from '../services/cid-calculator.service.js';
import { PinataService } from '../services/pinata.service.js';
import { CsvReporterService } from '../services/csv-reporter.service.js';
import { SimpleProgress } from '../utils/simple-progress.js';
import { ProcessedFile, FileEntry } from '../types/submit.types.js';
import { IPFSService } from '../services/ipfs.service.js';
import { IPLDConverterService } from '../services/ipld-converter.service.js';

export interface ValidateAndUploadCommandOptions {
  pinataJwt: string;
  inputDir: string;
  outputCsv: string;
  maxConcurrentUploads?: number;
  dryRun: boolean;
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
      '-o, --output-csv <path>',
      'Output CSV file path',
      'upload-results.csv'
    )
    .option(
      '--max-concurrent-uploads <number>',
      "Target maximum concurrent local file processing tasks. If not provided, an OS-dependent limit (Unix: based on 'ulimit -n', Windows: CPU-based heuristic) is used, with a fallback of 10. User-specified values may also be capped by these OS-dependent limits. Actual IPFS uploads are managed by Pinata service limits.",
      undefined
    )
    .option('--dry-run', 'Perform validation without uploading to IPFS.', false)
    .action(async (inputDir, options) => {
      options.pinataJwt = options.pinataJwt || process.env.PINATA_JWT;

      if (!options.pinataJwt && !options.dryRun) {
        logger.error(
          'Error: Pinata JWT is required for uploads. Provide via --pinata-jwt or PINATA_JWT env var.'
        );
        process.exit(1);
      }

      options.maxConcurrentUploads =
        parseInt(options.maxConcurrentUploads, 10) || undefined;

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
  jsonCanonicalizerService?:
    | JsonCanonicalizerService
    | IPLDCanonicalizerService;
  cidCalculatorService?: CidCalculatorService;
  pinataService?: PinataService;
  csvReporterService?: CsvReporterService;
  progressTracker?: SimpleProgress;
  ipldConverterService?: IPLDConverterService;
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

  const FALLBACK_LOCAL_CONCURRENCY = 10;
  const WINDOWS_DEFAULT_CONCURRENCY_FACTOR = 4;
  let effectiveConcurrency: number;
  let concurrencyLogReason = '';
  const userSpecifiedConcurrency = options.maxConcurrentUploads;

  let calculatedOsCap: number | undefined = undefined;

  if (process.platform !== 'win32') {
    try {
      const ulimitOutput = execSync('ulimit -n', {
        encoding: 'utf8',
        stdio: 'pipe',
      }).trim();
      const osMaxFiles = parseInt(ulimitOutput, 10);
      if (!isNaN(osMaxFiles) && osMaxFiles > 0) {
        calculatedOsCap = Math.max(1, Math.floor(osMaxFiles * 0.75));
        logger.info(
          `Unix-like system detected. System maximum open files (ulimit -n): ${osMaxFiles}. Calculated concurrency cap (0.75 * OS limit): ${calculatedOsCap}.`
        );
      } else {
        logger.warn(
          `Unix-like system detected, but could not determine a valid OS open file limit from 'ulimit -n' output: "${ulimitOutput}". OS-based capping will not be applied.`
        );
      }
    } catch (error) {
      logger.warn(
        `Unix-like system detected, but failed to check OS open file limit via 'ulimit -n'. OS-based capping will not be applied. Error: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  } else {
    logger.info(
      "Windows system detected. 'ulimit -n' based concurrency capping is not applicable."
    );
    if (userSpecifiedConcurrency === undefined) {
      const numCpus = os.cpus().length;
      calculatedOsCap = Math.max(
        1,
        numCpus * WINDOWS_DEFAULT_CONCURRENCY_FACTOR
      );
      logger.info(
        `Using CPU count (${numCpus}) * ${WINDOWS_DEFAULT_CONCURRENCY_FACTOR} as a heuristic for concurrency cap on Windows: ${calculatedOsCap}. This will be used if no user value is provided.`
      );
    }
  }

  if (userSpecifiedConcurrency !== undefined) {
    concurrencyLogReason = `User specified: ${userSpecifiedConcurrency}.`;
    if (calculatedOsCap !== undefined) {
      if (userSpecifiedConcurrency > calculatedOsCap) {
        effectiveConcurrency = calculatedOsCap;
        concurrencyLogReason += ` Capped by OS/heuristic limit to ${effectiveConcurrency}.`;
      } else {
        effectiveConcurrency = userSpecifiedConcurrency;
        concurrencyLogReason += ` Within OS/heuristic limit of ${calculatedOsCap}.`;
      }
    } else {
      effectiveConcurrency = userSpecifiedConcurrency;
      concurrencyLogReason += ` OS/heuristic limit not determined or applicable, using user value.`;
    }
  } else {
    // User did not specify concurrency
    if (calculatedOsCap !== undefined) {
      effectiveConcurrency = calculatedOsCap;
      concurrencyLogReason = `Derived from OS/heuristic limit (${effectiveConcurrency}), as no user value was provided.`;
    } else {
      effectiveConcurrency = FALLBACK_LOCAL_CONCURRENCY;
      concurrencyLogReason = `Using fallback value (${effectiveConcurrency}), as no user value was provided and OS/heuristic limit could not be determined.`;
    }
  }

  if (
    effectiveConcurrency === undefined ||
    effectiveConcurrency === null ||
    effectiveConcurrency <= 0
  ) {
    logger.error(
      `Error: Effective concurrency is invalid (${effectiveConcurrency}). This should not happen. Defaulting to ${FALLBACK_LOCAL_CONCURRENCY}.`
    );
    effectiveConcurrency = FALLBACK_LOCAL_CONCURRENCY;
    concurrencyLogReason += ` Corrected to fallback due to invalid calculation.`;
  }

  logger.technical(
    `Effective max concurrent local processing tasks: ${effectiveConcurrency}. Reason: ${concurrencyLogReason}`
  );

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

  // Keep a reference to csvReporterService to use in the final catch block
  let csvReporterServiceInstance: CsvReporterService | undefined =
    serviceOverrides.csvReporterService;

  const fileScannerService =
    serviceOverrides.fileScannerService ?? new FileScannerService();
  const ipfsServiceForSchemas =
    serviceOverrides.ipfsServiceForSchemas ??
    new IPFSService(DEFAULT_IPFS_GATEWAY);
  const schemaCacheService =
    serviceOverrides.schemaCacheService ??
    new SchemaCacheService(ipfsServiceForSchemas, config.schemaCacheSize);
  const jsonValidatorService =
    serviceOverrides.jsonValidatorService ??
    new JsonValidatorService(ipfsServiceForSchemas, options.inputDir);
  const jsonCanonicalizerService =
    serviceOverrides.jsonCanonicalizerService ?? new IPLDCanonicalizerService();
  const cidCalculatorService =
    serviceOverrides.cidCalculatorService ?? new CidCalculatorService();

  // csvReporterService is initialized later, inside the main try block
  // const csvReporterService =
  //   serviceOverrides.csvReporterService ??
  //   new CsvReporterService(config.errorCsvPath, config.warningCsvPath);

  const pinataService =
    serviceOverrides.pinataService ??
    new PinataService(options.pinataJwt, undefined, 18);

  const ipldConverterService =
    serviceOverrides.ipldConverterService ??
    new IPLDConverterService(
      options.inputDir,
      pinataService,
      cidCalculatorService
    );

  let progressTracker: SimpleProgress | undefined =
    serviceOverrides.progressTracker;
  const uploadRecords: UploadRecord[] = [];

  try {
    // Initialize csvReporterServiceInstance if not overridden
    if (!csvReporterServiceInstance) {
      csvReporterServiceInstance = new CsvReporterService(
        config.errorCsvPath,
        config.warningCsvPath
      );
    }
    // Assign to the const that the rest of the try block uses
    const csvReporterService = csvReporterServiceInstance;

    await csvReporterService.initialize();
    logger.technical(`Error reports will be saved to: ${config.errorCsvPath}`);
    logger.technical(
      `Warning reports will be saved to: ${config.warningCsvPath}`
    );

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
      if (csvReporterServiceInstance) {
        await csvReporterServiceInstance.finalize();
      }
      return;
    }

    if (!progressTracker) {
      // Initialize with 0 total, phase name will be set right after.
      // The first main phase with a specific count will be 'Processing Files'.
      progressTracker = new SimpleProgress(0, 'Initializing');
    }

    // progressTracker.setPhase('Initializing'); // Set in constructor
    progressTracker.start();

    // Phase 1: Pre-fetching Schemas (1 step for the main progress bar)
    progressTracker.setPhase('Pre-fetching Schemas', 1); // Treat as a single step for overall progress
    logger.info('Discovering all unique schema CIDs...');
    try {
      const allDataGroupCids = await fileScannerService.getAllDataGroupCids(
        options.inputDir
      );
      const uniqueSchemaCidsArray = Array.from(allDataGroupCids);
      logger.info(
        `Found ${uniqueSchemaCidsArray.length} unique schema CIDs to pre-fetch.`
      );

      if (uniqueSchemaCidsArray.length > 0) {
        const schemaProgress = new SimpleProgress(
          uniqueSchemaCidsArray.length,
          'Fetching Schemas'
        );
        schemaProgress.start();
        let prefetchedCount = 0;
        let failedCount = 0;

        // Consider potential for overwhelming IPFS gateway if many unique schemas.

        // Let's do them sequentially to avoid overwhelming the gateway and for clearer logging here.
        for (const schemaCid of uniqueSchemaCidsArray) {
          let fetchSuccess = false;
          try {
            await schemaCacheService.getSchema(schemaCid);
            prefetchedCount++;
            fetchSuccess = true;
          } catch (error) {
            logger.warn(
              `Error pre-fetching schema ${schemaCid}: ${error instanceof Error ? error.message : String(error)}. It will be attempted again during file processing.`
            );
            failedCount++;
          }
          schemaProgress.increment(fetchSuccess ? 'processed' : 'errors');
        }
        schemaProgress.stop();
        logger.info(
          `Schema pre-fetching complete: ${prefetchedCount} successful, ${failedCount} failed/not found.`
        );
      }
    } catch (error) {
      logger.error(
        `Failed to discover or pre-fetch schemas: ${error instanceof Error ? error.message : String(error)}`
      );
      // Decide if this is a fatal error. For now, log and continue, as individual file processing will still attempt schema loading.
    }

    // Phase 2: Processing Files (totalFiles steps)
    progressTracker.setPhase('Processing Files', totalFiles);
    const localProcessingSemaphore = new Semaphore(effectiveConcurrency);

    const servicesForProcessing = {
      // Renamed to avoid conflict with outer scope services
      schemaCacheService,
      jsonValidatorService,
      jsonCanonicalizerService,
      cidCalculatorService,
      csvReporterService, // This is the initialized one from the try block
      progressTracker, // This is the initialized one
      pinataService,
      ipldConverterService,
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
              servicesForProcessing, // Use renamed services object
              options,
              uploadRecords
            )
          )
        );
      }
    }

    await Promise.all(allOperationPromises);

    if (progressTracker) {
      progressTracker.stop();
    }

    try {
      await csvReporterService.finalize();
    } catch (finalizeError) {
      const errMsg =
        finalizeError instanceof Error
          ? finalizeError.message
          : String(finalizeError);
      // Use console.error directly here as logger might be part of an issue
      console.error(
        chalk.red(`Error during csvReporterService.finalize(): ${errMsg}`)
      );
      throw new Error(`CSV Finalization failed: ${errMsg}`); // Re-throw to be caught by main handler
    }

    const finalMetrics = progressTracker
      ? progressTracker.getMetrics()
      : {
          startTime: Date.now(),
          errors: 0,
          processed: 0,
          skipped: 0,
          total: totalFiles,
        };

    console.log(chalk.green('\n✅ Validation and upload process finished\n'));
    console.log(chalk.bold('📊 Final Report:'));
    console.log(
      `  Total files scanned:    ${finalMetrics.total || totalFiles}`
    ); // Use total from metrics or scanned
    console.log(`  Files skipped: ${finalMetrics.skipped || 0}`);
    console.log(`  Processing/upload errors: ${finalMetrics.errors || 0}`);

    if (!options.dryRun) {
      console.log(
        `  Successfully processed (validated & uploaded):  ${finalMetrics.processed || 0}`
      );
    } else {
      console.log(
        `  [DRY RUN] Files processed (validated): ${finalMetrics.processed || 0}`
      );
    }

    const totalHandled =
      (finalMetrics.skipped || 0) +
      (finalMetrics.errors || 0) +
      (finalMetrics.processed || 0);

    console.log(`  Total files handled:    ${totalHandled}`);

    const elapsed = Date.now() - finalMetrics.startTime;
    const seconds = Math.floor(elapsed / 1000);
    console.log(`  Duration:               ${seconds}s`);
    console.log(`\n  Error report:   ${config.errorCsvPath}`);
    console.log(`  Warning report: ${config.warningCsvPath}`);
    console.log(`  Upload results: ${options.outputCsv}`);

    try {
      const csvHeader =
        'propertyCid,dataGroupCid,dataCid,filePath,uploadedAt\n';
      const csvContent = uploadRecords
        .map(
          (record) =>
            `${record.propertyCid},${record.dataGroupCid},${record.dataCid},"${record.filePath}",${record.uploadedAt}`
        )
        .join('\n');

      writeFileSync(options.outputCsv, csvHeader + csvContent);
      logger.success(`Upload results saved to: ${options.outputCsv}`);
    } catch (writeCsvError) {
      const errMsg =
        writeCsvError instanceof Error
          ? writeCsvError.message
          : String(writeCsvError);
      console.error(
        chalk.red(
          `Error writing main CSV output to ${options.outputCsv}: ${errMsg}`
        )
      );
      throw new Error(`Main CSV output failed: ${errMsg}`); // Re-throw
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(
      // Use console.error directly for critical path
      chalk.red(`CRITICAL_ERROR_VALIDATE_AND_UPLOAD: ${errorMessage}`)
    );
    if (error instanceof Error && error.stack) {
      console.error(chalk.grey(error.stack));
    }

    if (progressTracker) {
      progressTracker.stop();
    }

    if (csvReporterServiceInstance) {
      try {
        await csvReporterServiceInstance.finalize();
        console.error(
          chalk.yellow(
            'CSV error/warning reports finalized during error handling.'
          )
        );
      } catch (finalizeErrorInCatch) {
        const finalErrMsg =
          finalizeErrorInCatch instanceof Error
            ? finalizeErrorInCatch.message
            : String(finalizeErrorInCatch);
        console.error(
          chalk.magenta(
            `Failed to finalize CSV reports during error handling: ${finalErrMsg}`
          )
        );
      }
    } else {
      console.error(
        chalk.magenta(
          'CSVReporterService instance was not available in error handler for finalization.'
        )
      );
    }
    process.exit(1);
  }
}

async function processFileAndGetUploadPromise(
  fileEntry: FileEntry,
  services: {
    schemaCacheService: SchemaCacheService;
    jsonValidatorService: JsonValidatorService;
    jsonCanonicalizerService:
      | JsonCanonicalizerService
      | IPLDCanonicalizerService;
    cidCalculatorService: CidCalculatorService;
    csvReporterService: CsvReporterService;
    progressTracker: SimpleProgress;
    pinataService: PinataService;
    ipldConverterService: IPLDConverterService;
  },
  options: ValidateAndUploadCommandOptions,
  uploadRecords: UploadRecord[]
): Promise<void> {
  let jsonData;
  try {
    const fileContentStr = await fsPromises.readFile(
      fileEntry.filePath,
      'utf-8'
    );
    jsonData = JSON.parse(fileContentStr);
  } catch (readOrParseError) {
    const errorMsg =
      readOrParseError instanceof Error
        ? readOrParseError.message
        : String(readOrParseError);
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
      schema,
      fileEntry.filePath
    );

    if (!validationResult.valid) {
      const errorDetails = services.jsonValidatorService.getErrorMessage(
        validationResult.errors || []
      );
      let additionalInfo = '';

      // Check if the error is related to string vs file path mismatch
      if (
        errorDetails.includes('must be string') &&
        JSON.stringify(jsonData).includes('./')
      ) {
        additionalInfo =
          ' The schema expects CID string values, but your data contains file paths like "./file.json". These need to be converted to IPFS CIDs first.';
      }

      const error = `Validation failed against schema ${schemaCid}: ${errorDetails}.${additionalInfo}`;
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

    // Check if data contains file path links and convert them to IPLD format
    let dataToUpload = jsonData;
    if (services.ipldConverterService.hasIPLDLinks(jsonData)) {
      logger.debug(
        `Converting file path links to IPLD format for ${fileEntry.filePath}`
      );
      try {
        const conversionResult =
          await services.ipldConverterService.convertToIPLD(
            jsonData,
            fileEntry.filePath
          );
        dataToUpload = conversionResult.convertedData;

        if (conversionResult.hasLinks) {
          logger.debug(
            `Converted ${conversionResult.linkedCIDs.length} file paths to IPFS CIDs`
          );
        }
      } catch (conversionError) {
        const errorMsg =
          conversionError instanceof Error
            ? conversionError.message
            : String(conversionError);
        logger.error(
          `Failed to convert IPLD links for ${fileEntry.filePath}: ${errorMsg}`
        );
        await services.csvReporterService.logError({
          propertyCid: fileEntry.propertyCid,
          dataGroupCid: fileEntry.dataGroupCid,
          filePath: fileEntry.filePath,
          error: `IPLD conversion error: ${errorMsg}`,
          timestamp: new Date().toISOString(),
        });
        services.progressTracker.increment('errors');
        return;
      }
    }

    const canonicalJson =
      services.jsonCanonicalizerService.canonicalize(dataToUpload);

    // Use appropriate CID format based on content
    const calculatedCid =
      await services.cidCalculatorService.calculateCidAutoFormat(dataToUpload);

    const processedFile: ProcessedFile = {
      propertyCid: fileEntry.propertyCid,
      dataGroupCid: fileEntry.dataGroupCid,
      filePath: fileEntry.filePath,
      canonicalJson,
      calculatedCid,
      validationPassed: true,
    };

    if (options.dryRun) {
      logger.info(
        `[DRY RUN] Would upload ${processedFile.filePath} (Calculated CID: ${processedFile.calculatedCid})`
      );
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
      return services.pinataService
        .uploadBatch([processedFile])
        .then((uploadResults) => {
          if (
            uploadResults &&
            uploadResults[0] &&
            uploadResults[0].success &&
            uploadResults[0].cid
          ) {
            const ipfsCid = uploadResults[0].cid;
            uploadRecords.push({
              propertyCid: processedFile.propertyCid,
              dataGroupCid: processedFile.dataGroupCid,
              dataCid: ipfsCid,
              filePath: processedFile.filePath,
              uploadedAt: new Date().toISOString(),
            });
            services.progressTracker.increment('processed');
            logger.debug(
              `Successfully uploaded ${processedFile.filePath} to IPFS. CID: ${ipfsCid}`
            );
          } else {
            const errorDetail =
              uploadResults && uploadResults[0]
                ? uploadResults[0].error
                : 'Unknown upload error';
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
        .catch((uploadError) => {
          const errorMsg =
            uploadError instanceof Error
              ? uploadError.message
              : String(uploadError);
          logger.error(
            `Upload exception for ${processedFile.filePath}: ${errorMsg}`
          );
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
    const errorMsg =
      processingError instanceof Error
        ? processingError.message
        : String(processingError);
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
