import { Command } from 'commander';
import { promises as fsPromises } from 'fs';
import path from 'path';
import chalk from 'chalk';
import { Semaphore } from 'async-mutex';
import { DEFAULT_IPFS_GATEWAY } from '../config/constants.js';
import { createSubmitConfig } from '../config/submit.config.js';
import { logger } from '../utils/logger.js';
import { SchemaCacheService } from '../services/schema-cache.service.js';
import { JsonValidatorService } from '../services/json-validator.service.js';
import { CsvReporterService } from '../services/csv-reporter.service.js';
import { SimpleProgress } from '../utils/simple-progress.js';
import { FileEntry } from '../types/submit.types.js';
import { IPFSService } from '../services/ipfs.service.js';
import { SEED_DATAGROUP_SCHEMA_CID } from '../config/constants.js';
import {
  processSinglePropertyInput,
  validateDataGroupSchema,
} from '../utils/single-property-processor.js';
import { calculateEffectiveConcurrency } from '../utils/concurrency-calculator.js';
import { scanSinglePropertyDirectoryV2 } from '../utils/single-property-file-scanner-v2.js';
import { SchemaManifestService } from '../services/schema-manifest.service.js';

export interface ValidateCommandOptions {
  input: string;
  outputCsv?: string;
  maxConcurrentTasks?: number;
}

export function registerValidateCommand(program: Command) {
  program
    .command('validate <input>')
    .description(
      'Validate single property data from a ZIP file against schemas without uploading to IPFS.'
    )
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
    .action(async (input, options) => {
      options.maxConcurrentTasks =
        parseInt(options.maxConcurrentTasks, 10) || undefined;

      const commandOptions: ValidateCommandOptions = {
        ...options,
        input: path.resolve(input),
      };

      await handleValidate(commandOptions);
    });
}

export interface ValidateServiceOverrides {
  ipfsServiceForSchemas?: IPFSService;
  schemaCacheService?: SchemaCacheService;
  jsonValidatorService?: JsonValidatorService;
  csvReporterService?: CsvReporterService;
  progressTracker?: SimpleProgress;
  schemaManifestService?: SchemaManifestService;
}

export async function handleValidate(
  options: ValidateCommandOptions,
  serviceOverrides: ValidateServiceOverrides = {}
) {
  console.log(
    chalk.bold.blue('🐘 Elephant Network CLI - Validate (Single Property)')
  );
  console.log();

  // Process single property ZIP input
  let processedInput;
  try {
    processedInput = await processSinglePropertyInput({
      inputPath: options.input,
      requireZip: true,
    });
  } catch (error) {
    logger.error(
      `Failed to process input: ${error instanceof Error ? error.message : String(error)}`
    );
    process.exit(1);
  }

  const { actualInputDir, cleanup } = processedInput;

  logger.technical(`Processing single property data from: ${actualInputDir}`);
  logger.technical(`Output CSV: ${options.outputCsv || 'submit_errors.csv'}`);
  logger.info('Note: Processing single property data only');

  // Calculate effective concurrency
  const { effectiveConcurrency } = calculateEffectiveConcurrency({
    userSpecified: options.maxConcurrentTasks,
    fallback: 10,
    windowsFactor: 4,
  });

  const config = createSubmitConfig({
    errorCsvPath: options.outputCsv || 'submit_errors.csv',
  });

  // Keep a reference to csvReporterService to use in the final catch block
  let csvReporterServiceInstance: CsvReporterService | undefined =
    serviceOverrides.csvReporterService;

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
      actualInputDir,
      schemaCacheService
    );
  const schemaManifestService =
    serviceOverrides.schemaManifestService ?? new SchemaManifestService();

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

    logger.info('Validating single property directory structure...');
    // For single property, we validate that the directory contains JSON files,
    // not that it contains property subdirectories
    const dirStats = await fsPromises.stat(actualInputDir);
    if (!dirStats.isDirectory()) {
      console.log(chalk.red('❌ Extracted path is not a directory'));
      await csvReporterService.finalize();
      await cleanup();
      process.exit(1);
    }

    const entries = await fsPromises.readdir(actualInputDir, {
      withFileTypes: true,
    });
    const jsonFiles = entries.filter(
      (entry) => entry.isFile() && entry.name.endsWith('.json')
    );

    if (jsonFiles.length === 0) {
      logger.warn('No JSON files found in the property directory');
      await csvReporterService.finalize();
      await cleanup();
      return;
    }

    logger.success(
      `Found ${jsonFiles.length} JSON files in property directory`
    );

    // Scan the single property directory using the new approach
    const propertyDirName = path.basename(actualInputDir);
    const scanResult = await scanSinglePropertyDirectoryV2(
      actualInputDir,
      propertyDirName,
      schemaManifestService
    );
    const { allFiles, validFilesCount, descriptiveFilesCount, schemaCids } =
      scanResult;

    logger.info('Counting files to validate...');
    const totalFiles = validFilesCount;
    logger.info(
      `Found ${totalFiles} file${totalFiles === 1 ? '' : 's'} to validate (${descriptiveFilesCount} descriptive-named files will be validated via IPLD references)`
    );

    if (totalFiles === 0) {
      logger.warn('No files found to validate');
      if (csvReporterServiceInstance) {
        await csvReporterServiceInstance.finalize();
      }
      await cleanup();
      return;
    }

    if (!progressTracker) {
      progressTracker = new SimpleProgress(0, 'Initializing');
    }

    progressTracker.start();

    // Phase 1: Pre-fetching Schemas (skip for descriptive file names)
    progressTracker.setPhase('Pre-fetching Schemas', 1);
    logger.info('Discovering all unique schema CIDs...');
    try {
      // Use the schema CIDs discovered during file scanning
      const uniqueSchemaCidsArray = Array.from(schemaCids);

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

    // The allFiles array is already populated from scanSinglePropertyDirectory

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

    // Clean up temporary directory if it was created
    await cleanup();
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

    // Clean up temporary directory if it was created
    await cleanup();

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
