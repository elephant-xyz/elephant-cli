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
import { ZipExtractorService } from '../services/zip-extractor.service.js';
import { determineEffectiveConcurrency } from '../utils/concurrency.js';
import { SchemaPrefetcherService } from '../services/schema-prefetcher.service.js';
import { validateFileEntry } from '../services/file-processing.service.js';

export interface ValidateCommandOptions {
  inputDir: string;
  outputCsv?: string;
  maxConcurrentTasks?: number;
}

export function registerValidateCommand(program: Command) {
  program
    .command('validate <input>')
    .description(
      'Validate files against schemas without uploading to IPFS. Input can be a directory or ZIP file.'
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
        inputDir: path.resolve(input),
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

  // Initialize services
  const zipExtractor = new ZipExtractorService();
  let actualInputDir = options.inputDir;
  let tempDir: string | null = null;

  try {
    // Check if input is a ZIP file
    const isZip = await zipExtractor.isZipFile(options.inputDir);
    if (isZip) {
      logger.info(`Detected ZIP file: ${options.inputDir}`);
      actualInputDir = await zipExtractor.extractZip(options.inputDir);
      tempDir = zipExtractor.getTempRootDir(actualInputDir);
      logger.info(`Extracted to: ${actualInputDir}`);
    }
  } catch (error) {
    logger.error(
      `Failed to process input: ${error instanceof Error ? error.message : String(error)}`
    );
    process.exit(1);
  }

  logger.technical(`Input directory: ${actualInputDir}`);
  logger.technical(`Output CSV: ${options.outputCsv || 'submit_errors.csv'}`);

  const { value: effectiveConcurrency, reason: concurrencyLogReason } =
    determineEffectiveConcurrency(options.maxConcurrentTasks);
  logger.technical(
    `Effective max concurrent validation tasks: ${effectiveConcurrency}. Reason: ${concurrencyLogReason}`
  );

  try {
    const stats = await fsPromises.stat(actualInputDir);
    if (!stats.isDirectory()) {
      logger.error(`Input path ${actualInputDir} is not a directory.`);
      if (tempDir) await zipExtractor.cleanup(tempDir);
      process.exit(1);
    }
  } catch (error) {
    logger.error(
      `Error accessing input directory ${actualInputDir}: ${error instanceof Error ? error.message : String(error)}`
    );
    if (tempDir) await zipExtractor.cleanup(tempDir);
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
      actualInputDir,
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
    const initialValidation =
      await fileScannerService.validateStructure(actualInputDir);
    if (!initialValidation.isValid) {
      console.log(chalk.red('❌ Directory structure is invalid:'));
      console.log(`Errors found: ${initialValidation.errors}`);
      initialValidation.errors.forEach((err) =>
        console.log(chalk.red(`   • ${err}`))
      );
      await csvReporterService.finalize();
      if (tempDir) await zipExtractor.cleanup(tempDir);
      process.exit(1);
    }
    logger.success('Directory structure valid');

    logger.info('Scanning to count total files...');
    const totalFiles = await fileScannerService.countTotalFiles(actualInputDir);
    logger.info(
      `Found ${totalFiles} file${totalFiles === 1 ? '' : 's'} to validate`
    );

    if (totalFiles === 0) {
      logger.warn('No files found to validate');
      if (csvReporterServiceInstance) {
        await csvReporterServiceInstance.finalize();
      }
      if (tempDir) await zipExtractor.cleanup(tempDir);
      return;
    }

    if (!progressTracker) {
      progressTracker = new SimpleProgress(0, 'Initializing');
    }

    progressTracker.start();

    // Phase 1: Pre-fetching Schemas
    progressTracker.setPhase('Pre-fetching Schemas', 1);
    const prefetcher = new SchemaPrefetcherService();
    try {
      await prefetcher.prefetch(
        actualInputDir,
        fileScannerService,
        schemaCacheService,
        progressTracker
      );
    } catch (error) {
      logger.error(
        `Failed to discover or pre-fetch schemas: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    // Collect all files first to handle seed files in two phases
    const allFiles: FileEntry[] = [];
    for await (const fileBatch of fileScannerService.scanDirectory(
      actualInputDir,
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
            const beforeErrors =
              servicesForValidation.progressTracker.getMetrics().errors;
            const result = await validateFileEntry(
              seedFile,
              servicesForValidation,
              true
            );
            const afterErrors =
              servicesForValidation.progressTracker.getMetrics().errors;
            const ok = result.ok && afterErrors === beforeErrors;
            if (!ok) {
              const dirPath = path.dirname(seedFile.filePath);
              failedSeedDirectories.add(dirPath);
              logger.error(
                `Seed validation failed for ${seedFile.filePath}. All other files in directory ${dirPath} will be skipped.`
              );
            }
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
            (async () => {
              const res = await validateFileEntry(
                fileEntry,
                servicesForValidation,
                true
              );
              if (res.ok) {
                servicesForValidation.progressTracker.increment('processed');
                logger.debug(`Successfully validated ${fileEntry.filePath}`);
              }
            })()
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
    if (tempDir) {
      await zipExtractor.cleanup(tempDir);
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

    // Clean up temporary directory if it was created
    if (tempDir) {
      await zipExtractor.cleanup(tempDir);
    }

    process.exit(1);
  }
}

// validateSeedFile and validateFile inlined into calls to validateFileEntry above
