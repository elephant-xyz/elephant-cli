import { Command } from 'commander';
import { promises as fsPromises } from 'fs';
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
import { CsvReporterService } from '../services/csv-reporter.service.js';
import { SimpleProgress } from '../utils/simple-progress.js';
import { FileEntry } from '../types/submit.types.js';
import { IPFSService } from '../services/ipfs.service.js';
import { SEED_DATAGROUP_SCHEMA_CID } from '../config/constants.js';

function validateDataGroupSchema(schema: any): {
  valid: boolean;
  error?: string;
} {
  if (!schema || typeof schema !== 'object') {
    return {
      valid: false,
      error: 'Schema must be a valid JSON object',
    };
  }

  if (schema.type !== 'object') {
    return {
      valid: false,
      error: 'Data group schema must describe an object (type: "object")',
    };
  }

  if (!schema.properties || typeof schema.properties !== 'object') {
    return {
      valid: false,
      error: 'Data group schema must have a "properties" object',
    };
  }

  const properties = schema.properties;

  if (!properties.label) {
    return {
      valid: false,
      error: 'Data group schema must have a "label" property',
    };
  }

  if (!properties.relationships) {
    return {
      valid: false,
      error: 'Data group schema must have a "relationships" property',
    };
  }

  if (Object.keys(properties).length !== 2) {
    return {
      valid: false,
      error:
        'Data group schema must have exactly 2 properties: "label" and "relationships"',
    };
  }

  return { valid: true };
}

export interface ValidateCommandOptions {
  inputDir: string;
  outputCsv?: string;
  maxConcurrentTasks?: number;
}

export function registerValidateCommand(program: Command) {
  program
    .command('validate <inputDir>')
    .description('Validate files against schemas without uploading to IPFS')
    .option(
      '-o, --output-csv <path>',
      'Output CSV file path for validation errors',
      'submit_errors.csv'
    )
    .option(
      '--max-concurrent-tasks <number>',
      "Target maximum concurrent validation tasks. If not provided, an OS-dependent limit (Unix: based on 'ulimit -n', Windows: CPU-based heuristic) is used, with a fallback of 10.",
      undefined
    )
    .action(async (inputDir, options) => {
      options.maxConcurrentTasks =
        parseInt(options.maxConcurrentTasks, 10) || undefined;

      const commandOptions: ValidateCommandOptions = {
        ...options,
        inputDir: path.resolve(inputDir),
      };

      await handleValidate(commandOptions);
    });
}

export interface ValidateServiceOverrides {
  fileScannerService?: FileScannerService;
  ipfsServiceForSchemas?: IPFSService;
  schemaCacheService?: SchemaCacheService;
  jsonValidatorService?: JsonValidatorService;
  csvReporterService?: CsvReporterService;
  progressTracker?: SimpleProgress;
}

export async function handleValidate(
  options: ValidateCommandOptions,
  serviceOverrides: ValidateServiceOverrides = {}
) {
  console.log(chalk.bold.blue('🐘 Elephant Network CLI - Validate'));
  console.log();

  logger.technical(`Input directory: ${options.inputDir}`);
  logger.technical(`Output CSV: ${options.outputCsv || 'submit_errors.csv'}`);

  const FALLBACK_LOCAL_CONCURRENCY = 10;
  const WINDOWS_DEFAULT_CONCURRENCY_FACTOR = 4;
  let effectiveConcurrency: number;
  let concurrencyLogReason = '';
  const userSpecifiedConcurrency = options.maxConcurrentTasks;

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
    `Effective max concurrent validation tasks: ${effectiveConcurrency}. Reason: ${concurrencyLogReason}`
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
    errorCsvPath: options.outputCsv || 'submit_errors.csv',
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
    new JsonValidatorService(
      ipfsServiceForSchemas,
      options.inputDir,
      schemaCacheService
    );

  let progressTracker: SimpleProgress | undefined =
    serviceOverrides.progressTracker;

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
    logger.technical(
      `Validation errors will be saved to: ${config.errorCsvPath}`
    );

    logger.info('Validating directory structure...');
    const initialValidation = await fileScannerService.validateStructure(
      options.inputDir
    );
    if (!initialValidation.isValid) {
      console.log(chalk.red('❌ Directory structure is invalid:'));
      console.log(`Errors found: ${initialValidation.errors}`);
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
      `Found ${totalFiles} file${totalFiles === 1 ? '' : 's'} to validate`
    );

    if (totalFiles === 0) {
      logger.warn('No files found to validate');
      if (csvReporterServiceInstance) {
        await csvReporterServiceInstance.finalize();
      }
      return;
    }

    if (!progressTracker) {
      progressTracker = new SimpleProgress(0, 'Initializing');
    }

    progressTracker.start();

    // Phase 1: Pre-fetching Schemas
    progressTracker.setPhase('Pre-fetching Schemas', 1);
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

        for (const schemaCid of uniqueSchemaCidsArray) {
          let fetchSuccess = false;
          try {
            await schemaCacheService.getSchema(schemaCid);
            prefetchedCount++;
            fetchSuccess = true;
          } catch (error) {
            logger.warn(
              `Error pre-fetching schema ${schemaCid}: ${error instanceof Error ? error.message : String(error)}. It will be attempted again during file validation.`
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
    }

    // Collect all files first to handle seed files in two phases
    const allFiles: FileEntry[] = [];
    for await (const fileBatch of fileScannerService.scanDirectory(
      options.inputDir,
      config.fileScanBatchSize
    )) {
      allFiles.push(...fileBatch);
    }

    // Phase 2: Validating Files
    progressTracker.setPhase('Validating Files', allFiles.length);
    const localProcessingSemaphore = new Semaphore(effectiveConcurrency);

    const servicesForValidation = {
      schemaCacheService,
      jsonValidatorService,
      csvReporterService,
      progressTracker,
    };

    // Set to track directories with failed seed validation
    const failedSeedDirectories = new Set<string>();

    // Phase 1: Validate all seed files first
    const seedFiles = allFiles.filter(
      (file) => file.dataGroupCid === SEED_DATAGROUP_SCHEMA_CID
    );

    if (seedFiles.length > 0) {
      logger.info(`Validating ${seedFiles.length} seed files first...`);

      const seedPromises: Promise<void>[] = [];
      for (const seedFile of seedFiles) {
        seedPromises.push(
          localProcessingSemaphore.runExclusive(async () => {
            await validateSeedFile(
              seedFile,
              servicesForValidation,
              failedSeedDirectories
            );
          })
        );
      }

      await Promise.all(seedPromises);
      logger.info(`Completed validating ${seedFiles.length} seed files`);
    }

    // Phase 2: Validate all non-seed files, skipping those in failed seed directories
    const nonSeedFiles = allFiles.filter(
      (file) => file.dataGroupCid !== SEED_DATAGROUP_SCHEMA_CID
    );

    // Filter out files from directories with failed seed validation
    const filesToValidate = nonSeedFiles.filter((file) => {
      if (file.propertyCid.startsWith('SEED_PENDING:')) {
        const dirPath = path.dirname(file.filePath);
        if (failedSeedDirectories.has(dirPath)) {
          logger.warn(
            `Skipping file ${file.filePath} because seed validation failed for directory ${dirPath}`
          );
          progressTracker?.increment('skipped');
          return false;
        }
      }
      return true;
    });

    if (filesToValidate.length > 0) {
      logger.info(`Validating ${filesToValidate.length} non-seed files...`);

      const allValidationPromises: Promise<void>[] = [];
      for (const fileEntry of filesToValidate) {
        allValidationPromises.push(
          localProcessingSemaphore.runExclusive(async () =>
            validateFile(fileEntry, servicesForValidation)
          )
        );
      }

      await Promise.all(allValidationPromises);
    }

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
      console.error(
        chalk.red(`Error during csvReporterService.finalize(): ${errMsg}`)
      );
      throw new Error(`CSV Finalization failed: ${errMsg}`);
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

    console.log(chalk.green('\n✅ Validation process finished\n'));
    console.log(chalk.bold('📊 Validation Report:'));
    console.log(
      `  Total files scanned:    ${finalMetrics.total || totalFiles}`
    );
    console.log(`  Files skipped:          ${finalMetrics.skipped || 0}`);
    console.log(`  Validation errors:      ${finalMetrics.errors || 0}`);
    console.log(`  Successfully validated: ${finalMetrics.processed || 0}`);

    const totalHandled =
      (finalMetrics.skipped || 0) +
      (finalMetrics.errors || 0) +
      (finalMetrics.processed || 0);

    console.log(`  Total files handled:    ${totalHandled}`);

    const elapsed = Date.now() - finalMetrics.startTime;
    const seconds = Math.floor(elapsed / 1000);
    console.log(`  Duration:               ${seconds}s`);

    if (csvReporterService.getErrorCount() > 0) {
      console.log(
        chalk.yellow(
          `\n⚠️  Validation errors found. Check ${config.errorCsvPath} for details.`
        )
      );
    } else {
      console.log(chalk.green('\n✅ All files passed validation!'));
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(chalk.red(`CRITICAL_ERROR_VALIDATE: ${errorMessage}`));
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
          chalk.yellow('CSV error reports finalized during error handling.')
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

async function validateSeedFile(
  fileEntry: FileEntry,
  services: {
    schemaCacheService: SchemaCacheService;
    jsonValidatorService: JsonValidatorService;
    csvReporterService: CsvReporterService;
    progressTracker: SimpleProgress;
  },
  failedSeedDirectories: Set<string>
): Promise<void> {
  const dirPath = path.dirname(fileEntry.filePath);
  const errorsCountBefore = services.progressTracker.getMetrics().errors;

  try {
    await validateFile(fileEntry, services);

    // Check if validation was successful
    const errorsCountAfter = services.progressTracker.getMetrics().errors;
    const newErrorsOccurred = errorsCountAfter > errorsCountBefore;

    if (newErrorsOccurred) {
      // Validation failed
      failedSeedDirectories.add(dirPath);
      logger.error(
        `Seed validation failed for ${fileEntry.filePath}. All other files in directory ${dirPath} will be skipped.`
      );
    }
  } catch (error) {
    // Mark this directory as having a failed seed
    failedSeedDirectories.add(dirPath);
    logger.error(
      `Seed validation failed for ${fileEntry.filePath}: ${error instanceof Error ? error.message : String(error)}. All other files in directory ${dirPath} will be skipped.`
    );
    throw error; // Re-throw to maintain error reporting
  }
}

async function validateFile(
  fileEntry: FileEntry,
  services: {
    schemaCacheService: SchemaCacheService;
    jsonValidatorService: JsonValidatorService;
    csvReporterService: CsvReporterService;
    progressTracker: SimpleProgress;
  }
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
      errorPath: 'root',
      errorMessage: `File read/parse error: ${errorMsg}`,
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
        errorPath: 'root',
        errorMessage: error,
        timestamp: new Date().toISOString(),
      });
      services.progressTracker.increment('errors');
      return;
    }

    // Validate that the schema is a valid data group schema
    const schemaValidation = validateDataGroupSchema(schema);
    if (!schemaValidation.valid) {
      const error = `Schema CID ${schemaCid} is not a valid data group schema. Data group schemas must describe an object with exactly two properties: "label" and "relationships". For valid data group schemas, please visit https://lexicon.elephant.xyz`;

      await services.csvReporterService.logError({
        propertyCid: fileEntry.propertyCid,
        dataGroupCid: fileEntry.dataGroupCid,
        filePath: fileEntry.filePath,
        errorPath: 'root',
        errorMessage: error,
        timestamp: new Date().toISOString(),
      });
      services.progressTracker.increment('errors');
      return;
    }

    // Validate the data
    const validationResult = await services.jsonValidatorService.validate(
      jsonData,
      schema,
      fileEntry.filePath,
      false // allow resolution of file references
    );

    if (!validationResult.valid) {
      const errorMessages: Array<{ path: string; message: string }> =
        services.jsonValidatorService.getErrorMessages(
          validationResult.errors || []
        );

      for (const errorInfo of errorMessages) {
        await services.csvReporterService.logError({
          propertyCid: fileEntry.propertyCid,
          dataGroupCid: fileEntry.dataGroupCid,
          filePath: fileEntry.filePath,
          errorPath: errorInfo.path,
          errorMessage: errorInfo.message,
          timestamp: new Date().toISOString(),
        });
      }
      services.progressTracker.increment('errors');
      return;
    }

    // Validation passed
    services.progressTracker.increment('processed');
    logger.debug(`Successfully validated ${fileEntry.filePath}`);
  } catch (processingError) {
    const errorMsg =
      processingError instanceof Error
        ? processingError.message
        : String(processingError);
    await services.csvReporterService.logError({
      propertyCid: fileEntry.propertyCid,
      dataGroupCid: fileEntry.dataGroupCid,
      filePath: fileEntry.filePath,
      errorPath: 'root',
      errorMessage: `Processing error: ${errorMsg}`,
      timestamp: new Date().toISOString(),
    });
    services.progressTracker.increment('errors');
  }
}
