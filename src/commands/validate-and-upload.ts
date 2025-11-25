import { Command } from 'commander';
import { promises as fsPromises, writeFileSync, existsSync } from 'fs';
import path from 'path';
import chalk from 'chalk';
import { Semaphore } from 'async-mutex';
import { execSync } from 'child_process';
import * as os from 'os';
import { generateHTMLFiles } from '../utils/fact-sheet.js';
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
import { IPLDConverterService } from '../services/ipld-converter.service.js';
import { SEED_DATAGROUP_SCHEMA_CID } from '../config/constants.js';

interface HTMLUploadResult {
  propertyCid: string;
  htmlCid: string;
  htmlLink: string;
}

async function scanAndUploadHTMLFiles(
  htmlDir: string,
  pinataService: PinataService | undefined,
  progressTracker: SimpleProgress,
  dryRun: boolean,
  maxConcurrentUploads: number = 5 // Default to 5 concurrent uploads
): Promise<Map<string, HTMLUploadResult>> {
  const htmlUploadMap = new Map<string, HTMLUploadResult>();
  const uploadSemaphore = new Semaphore(maxConcurrentUploads);

  try {
    // Get all directories in the HTML output directory
    const entries = await fsPromises.readdir(htmlDir, { withFileTypes: true });
    const directories = entries.filter((entry) => entry.isDirectory());

    logger.info(
      `Found ${directories.length} property directories with HTML files`
    );

    // Process directories with controlled concurrency
    const uploadPromises = directories.map((dir) =>
      uploadSemaphore.runExclusive(async () => {
        const dirName = dir.name;
        const dirPath = path.join(htmlDir, dirName);

        try {
          // Check if directory has any files
          const dirContents = await fsPromises.readdir(dirPath);
          if (dirContents.length === 0) {
            logger.warn(`Directory ${dirName} is empty`);
            progressTracker.increment('errors');
            return null;
          }

          // Check if index.html exists
          const indexPath = path.join(dirPath, 'index.html');
          if (!existsSync(indexPath)) {
            logger.warn(`No index.html found in directory ${dirName}`);
            progressTracker.increment('errors');
            return null;
          }

          if (dryRun) {
            // In dry-run mode, simulate uploads
            const calculatedCid = `bafybeig${dirName.toLowerCase().substring(0, 20).padEnd(20, '0')}htmldryrun`;
            const htmlLink = `http://dweb.link/ipfs/${calculatedCid}`;

            logger.info(
              `[DRY RUN] Would upload HTML directory for property ${dirName}`
            );

            const result: HTMLUploadResult = {
              propertyCid: dirName,
              htmlCid: calculatedCid,
              htmlLink,
            };

            progressTracker.increment('processed');
            return { dirName, result };
          } else {
            if (!pinataService) {
              throw new Error('Pinata service not available for HTML upload');
            }

            // Upload the entire directory
            logger.debug(`Uploading HTML directory for property ${dirName}`);

            const metadata = {
              name: `${dirName}-html`,
              keyvalues: {
                propertyCid: dirName,
                dataGroupCid: 'html-fact-sheet',
                type: 'property-fact-sheet',
              },
            };

            const uploadResult = await pinataService.uploadDirectory(
              dirPath,
              metadata
            );

            if (uploadResult.success && uploadResult.cid) {
              // For directory uploads, the link points to the directory root
              // The gateway will automatically serve index.html
              const htmlLink = `http://dweb.link/ipfs/${uploadResult.cid}`;

              const result: HTMLUploadResult = {
                propertyCid: dirName,
                htmlCid: uploadResult.cid,
                htmlLink,
              };

              logger.debug(
                `Uploaded HTML directory for ${dirName}: ${uploadResult.cid}`
              );
              progressTracker.increment('processed');
              return { dirName, result };
            } else {
              logger.error(
                `Failed to upload HTML directory for ${dirName}: ${uploadResult.error}`
              );
              progressTracker.increment('errors');
              return null;
            }
          }
        } catch (error) {
          const errorMsg =
            error instanceof Error ? error.message : String(error);
          logger.error(
            `Error processing HTML directory ${dirName}: ${errorMsg}`
          );
          progressTracker.increment('errors');
          return null;
        }
      })
    );

    // Wait for all uploads to complete
    const results = await Promise.all(uploadPromises);

    // Populate the map with successful results
    results.forEach((result) => {
      if (result && result.dirName && result.result) {
        htmlUploadMap.set(result.dirName, result.result);
      }
    });

    return htmlUploadMap;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error(`Error scanning HTML directory: ${errorMsg}`);
    return htmlUploadMap;
  }
}

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

export interface ValidateAndUploadCommandOptions {
  pinataJwt?: string;
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
  htmlLink?: string;
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
        console.error(
          chalk.red(
            'Error: Pinata JWT is required for uploads. Provide via --pinata-jwt option or PINATA_JWT environment variable, or use --dry-run to validate without uploading.'
          )
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
  const schemaCacheService =
    serviceOverrides.schemaCacheService ?? new SchemaCacheService();
  const jsonValidatorService =
    serviceOverrides.jsonValidatorService ??
    new JsonValidatorService(options.inputDir, schemaCacheService);
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
    (options.dryRun
      ? undefined
      : new PinataService(options.pinataJwt!, undefined, 10)); // Reduced from 18 to prevent bursts

  const ipldConverterService =
    serviceOverrides.ipldConverterService ??
    new IPLDConverterService(
      options.inputDir,
      pinataService,
      cidCalculatorService,
      jsonCanonicalizerService
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
            await schemaCacheService.get(schemaCid);
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

    // Collect all files first to handle seed files in two phases
    const allFiles: FileEntry[] = [];
    for await (const fileBatch of fileScannerService.scanDirectory(
      options.inputDir,
      config.fileScanBatchSize
    )) {
      allFiles.push(...fileBatch);
    }

    // Phase 2: Processing Files (totalFiles steps)
    progressTracker.setPhase('Processing Files', allFiles.length);
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

    // Map to store seed CIDs for directories
    const seedCidMap = new Map<string, string>(); // directory path -> uploaded seed CID

    // Set to track directories with failed seed validation
    const failedSeedDirectories = new Set<string>(); // directory paths with failed seeds

    // Phase 1: Process all seed files first
    const seedFiles = allFiles.filter(
      (file) => file.dataGroupCid === SEED_DATAGROUP_SCHEMA_CID
    );

    if (seedFiles.length > 0) {
      logger.info(`Processing ${seedFiles.length} seed files first...`);

      const seedPromises: Promise<void>[] = [];
      for (const seedFile of seedFiles) {
        seedPromises.push(
          localProcessingSemaphore.runExclusive(async () => {
            await processSeedFile(
              seedFile,
              servicesForProcessing,
              options,
              uploadRecords,
              seedCidMap,
              failedSeedDirectories
            );
          })
        );
      }

      await Promise.all(seedPromises);
      logger.info(`Completed processing ${seedFiles.length} seed files`);
    }

    // Phase 2: Process all non-seed files with updated propertyCids
    const nonSeedFiles = allFiles.filter(
      (file) => file.dataGroupCid !== SEED_DATAGROUP_SCHEMA_CID
    );

    // Update propertyCids for files in seed datagroup directories, but skip directories with failed seeds
    const updatedFiles = nonSeedFiles
      .filter((file) => {
        // Skip files from directories with failed seed validation
        if (file.propertyCid.startsWith('SEED_PENDING:')) {
          const dirPath = path.dirname(file.filePath);
          if (failedSeedDirectories.has(dirPath)) {
            logger.warn(
              `Skipping file ${file.filePath} because seed validation failed for directory ${dirPath}`
            );
            return false;
          }
        }
        return true;
      })
      .map((file) => {
        if (file.propertyCid.startsWith('SEED_PENDING:')) {
          const dirName = file.propertyCid.replace('SEED_PENDING:', '');
          const dirPath = path.dirname(file.filePath);
          const seedCid = seedCidMap.get(dirPath);
          if (seedCid) {
            return { ...file, propertyCid: seedCid };
          }
          // If no seed CID found, keep the directory name
          return { ...file, propertyCid: dirName };
        }
        return file;
      });

    if (updatedFiles.length > 0) {
      logger.info(`Processing ${updatedFiles.length} non-seed files...`);

      const allOperationPromises: Promise<void>[] = [];
      for (const fileEntry of updatedFiles) {
        allOperationPromises.push(
          localProcessingSemaphore.runExclusive(async () =>
            processFileAndGetUploadPromise(
              fileEntry,
              servicesForProcessing,
              options,
              uploadRecords
            )
          )
        );
      }

      await Promise.all(allOperationPromises);
    }

    // Phase 3: Generate and upload HTML files
    let htmlUploadMap: Map<string, HTMLUploadResult> = new Map();

    if (uploadRecords.length > 0) {
      try {
        // Install or update fact-sheet tool (skip in dry-run mode)
        if (!options.dryRun) {
          progressTracker.setPhase('Installing/Updating Fact Sheet Tool', 1);

          progressTracker.increment('processed');
        }

        // Generate HTML files
        progressTracker.setPhase('Generating HTML Files', 1);
        const htmlOutputDir = path.join(
          path.dirname(options.inputDir),
          'htmls'
        );
        await generateHTMLFiles(options.inputDir, htmlOutputDir);
        progressTracker.increment('processed');

        // Upload HTML files
        const htmlDirs = await fsPromises.readdir(htmlOutputDir, {
          withFileTypes: true,
        });
        const htmlDirCount = htmlDirs.filter((d) => d.isDirectory()).length;

        if (htmlDirCount > 0) {
          progressTracker.setPhase('Uploading HTML Files', htmlDirCount);
          htmlUploadMap = await scanAndUploadHTMLFiles(
            htmlOutputDir,
            pinataService,
            progressTracker,
            options.dryRun,
            effectiveConcurrency // Use the same concurrency limit as file processing
          );
        }

        // Update upload records with HTML links
        // Create a map of directory paths to property CIDs for matching
        const dirToPropertyMap = new Map<string, string>();
        for (const record of uploadRecords) {
          const dirName = path.basename(path.dirname(record.filePath));
          dirToPropertyMap.set(dirName, record.propertyCid);
        }

        // Match HTML results to upload records
        for (const record of uploadRecords) {
          // Try to find HTML result by property CID first
          let htmlResult = htmlUploadMap.get(record.propertyCid);

          // If not found, try to find by directory name
          if (!htmlResult) {
            const dirName = path.basename(path.dirname(record.filePath));
            htmlResult = htmlUploadMap.get(dirName);
          }

          if (htmlResult) {
            record.htmlLink = htmlResult.htmlLink;
          }
        }

        // Clean up HTML directory after upload
        if (!options.dryRun && existsSync(htmlOutputDir)) {
          try {
            await fsPromises.rm(htmlOutputDir, {
              recursive: true,
              force: true,
            });
            logger.debug('Cleaned up temporary HTML directory');
          } catch (cleanupError) {
            logger.warn(
              `Failed to clean up HTML directory: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`
            );
          }
        }
      } catch (htmlError) {
        const errorMsg =
          htmlError instanceof Error ? htmlError.message : String(htmlError);
        const errorStack =
          htmlError instanceof Error && htmlError.stack
            ? htmlError.stack
            : 'No stack trace available';
        logger.error(`HTML generation/upload failed: ${errorMsg}`);
        logger.debug(`HTML generation error details: ${errorStack}`);
        logger.warn(
          'Continuing with the process despite HTML generation failure'
        );
        // Continue with the process even if HTML generation fails
      }
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
        'propertyCid,dataGroupCid,dataCid,filePath,uploadedAt,htmlLink\n';
      const csvContent = uploadRecords
        .map(
          (record) =>
            `${record.propertyCid},${record.dataGroupCid},${record.dataCid},"${record.filePath}",${record.uploadedAt},${record.htmlLink || ''}`
        )
        .join('\n');

      writeFileSync(options.outputCsv, csvHeader + csvContent);
      logger.success(`Upload results saved to: ${options.outputCsv}`);

      // Display first 5 unique HTML links (based on the link itself, not property CID)
      const uniqueHtmlLinks = new Map<
        string,
        { propertyCid: string; dirName: string }
      >();
      for (const record of uploadRecords) {
        if (record.htmlLink && !uniqueHtmlLinks.has(record.htmlLink)) {
          const dirName = path.basename(path.dirname(record.filePath));
          uniqueHtmlLinks.set(record.htmlLink, {
            propertyCid: record.propertyCid,
            dirName: dirName,
          });
        }
      }

      if (uniqueHtmlLinks.size > 0) {
        console.log(chalk.bold('\n🌐 Property Fact Sheet Links:'));
        console.log(
          chalk.gray(
            '  (Note: It may take a few minutes for pages to propagate through IPFS gateways)\n'
          )
        );

        const linksArray = Array.from(uniqueHtmlLinks.entries());
        const displayCount = Math.min(5, linksArray.length);

        for (let i = 0; i < displayCount; i++) {
          const [htmlLink, info] = linksArray[i];
          // Display directory name and property CID on one line and full URL on the next
          console.log(`  ${i + 1}. Directory: ${info.dirName}`);
          console.log(`     ${chalk.cyan(htmlLink)}\n`);
        }

        if (linksArray.length > 5) {
          console.log(
            chalk.yellow(`  ... and ${linksArray.length - 5} more fact sheets.`)
          );
        }

        console.log(
          chalk.bold(
            `\n📄 All HTML links have been saved to: ${chalk.green(options.outputCsv)}`
          )
        );
        console.log(
          chalk.gray(
            '  Please check this file for the complete list of property fact sheet URLs.'
          )
        );
      }
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

async function processSeedFile(
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
    pinataService: PinataService | undefined;
    ipldConverterService: IPLDConverterService;
  },
  options: ValidateAndUploadCommandOptions,
  uploadRecords: UploadRecord[],
  seedCidMap: Map<string, string>,
  failedSeedDirectories: Set<string>
): Promise<void> {
  const dirPath = path.dirname(fileEntry.filePath);
  const uploadRecordsCountBefore = uploadRecords.length;
  const errorsCountBefore = services.progressTracker.getMetrics().errors;

  try {
    // Process the seed file exactly like a normal file
    await processFileAndGetUploadPromise(
      fileEntry,
      services,
      options,
      uploadRecords
    );

    // Check if processing was successful by checking if:
    // 1. A new record was added (successful validation and upload/dry-run), OR
    // 2. No new errors were recorded (indicating successful processing)
    const latestRecord = uploadRecords[uploadRecords.length - 1];
    const recordAdded =
      uploadRecords.length > uploadRecordsCountBefore &&
      latestRecord &&
      latestRecord.filePath === fileEntry.filePath;

    const errorsCountAfter = services.progressTracker.getMetrics().errors;
    const newErrorsOccurred = errorsCountAfter > errorsCountBefore;

    if (recordAdded) {
      // Successful upload/dry-run
      seedCidMap.set(dirPath, latestRecord.dataCid);
      logger.debug(
        `Stored seed CID ${latestRecord.dataCid} for directory ${dirPath}`
      );
    } else if (newErrorsOccurred) {
      // Validation or processing failed
      failedSeedDirectories.add(dirPath);
      logger.error(
        `Seed validation/upload failed for ${fileEntry.filePath}. All other files in directory ${dirPath} will be skipped.`
      );
    } else {
      // No record added and no errors - this shouldn't happen, but treat as failure
      failedSeedDirectories.add(dirPath);
      logger.error(
        `Seed processing completed without success or error for ${fileEntry.filePath}. All other files in directory ${dirPath} will be skipped.`
      );
    }
  } catch (error) {
    // Mark this directory as having a failed seed
    failedSeedDirectories.add(dirPath);
    logger.error(
      `Seed processing failed for ${fileEntry.filePath}: ${error instanceof Error ? error.message : String(error)}. All other files in directory ${dirPath} will be skipped.`
    );
    throw error; // Re-throw to maintain error reporting
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
    pinataService: PinataService | undefined;
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
      errorPath: 'root',
      errorMessage: `File read/parse error: ${errorMsg}`,
      currentValue: '',
      timestamp: new Date().toISOString(),
    });
    services.progressTracker.increment('errors');
    return;
  }

  try {
    const schemaCid = fileEntry.dataGroupCid;
    const schema = await services.schemaCacheService.get(schemaCid);
    if (!schema) {
      const error = `Could not load schema ${schemaCid} for ${fileEntry.filePath}`;
      await services.csvReporterService.logError({
        propertyCid: fileEntry.propertyCid,
        dataGroupCid: fileEntry.dataGroupCid,
        filePath: fileEntry.filePath,
        errorPath: 'root',
        errorMessage: error,
        currentValue: '',
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
        currentValue: '',
        timestamp: new Date().toISOString(),
      });
      services.progressTracker.increment('errors');
      return;
    }

    // Check if data has IPLD links that need conversion
    let dataToUpload = jsonData;

    // Validate the data (potentially after IPLD conversion)
    const validationResult = await services.jsonValidatorService.validate(
      dataToUpload,
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
          currentValue: '',
          timestamp: new Date().toISOString(),
        });
      }
      services.progressTracker.increment('errors');
      return;
    }

    if (
      services.ipldConverterService &&
      services.ipldConverterService.hasIPLDLinks(jsonData, schema)
    ) {
      logger.debug(
        `Data has IPLD links, running IPLD converter for ${fileEntry.filePath}`
      );

      try {
        // Run IPLD converter to process file references and ipfs_url fields
        const conversionResult =
          await services.ipldConverterService.convertToIPLD(
            jsonData,
            fileEntry.filePath,
            schema
          );
        dataToUpload = conversionResult.convertedData;

        if (conversionResult.hasLinks) {
          logger.debug(
            `Converted ${conversionResult.linkedCIDs.length} links to IPFS CIDs`
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
        // Continue with original data
      }
    }

    const canonicalJson =
      services.jsonCanonicalizerService.canonicalize(dataToUpload);

    // Calculate CID from the canonical JSON string directly
    const calculatedCid =
      await services.cidCalculatorService.calculateCidFromCanonicalJson(
        canonicalJson
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
      logger.info(
        `[DRY RUN] Would upload ${processedFile.filePath} (Calculated CID: ${processedFile.calculatedCid})`
      );

      // For seed files, the propertyCid should be the same as dataCid
      const isSeedFile = fileEntry.dataGroupCid === SEED_DATAGROUP_SCHEMA_CID;
      const finalPropertyCid = isSeedFile
        ? processedFile.calculatedCid
        : processedFile.propertyCid;

      uploadRecords.push({
        propertyCid: finalPropertyCid,
        dataGroupCid: processedFile.dataGroupCid,
        dataCid: processedFile.calculatedCid,
        filePath: processedFile.filePath,
        uploadedAt: new Date().toISOString(),
      });
      services.progressTracker.increment('processed');
      return Promise.resolve();
    } else {
      if (!services.pinataService) {
        throw new Error('Pinata service not available for upload');
      }
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

            // For seed files, the propertyCid should be the same as dataCid
            const isSeedFile =
              fileEntry.dataGroupCid === SEED_DATAGROUP_SCHEMA_CID;
            const finalPropertyCid = isSeedFile
              ? ipfsCid
              : processedFile.propertyCid;

            uploadRecords.push({
              propertyCid: finalPropertyCid,
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
              errorPath: 'root',
              errorMessage: `Upload failed: ${errorDetail}`,
              currentValue: '',
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
            errorPath: 'root',
            errorMessage: `Upload exception: ${errorMsg}`,
            currentValue: '',
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
      errorPath: 'root',
      errorMessage: `Processing error: ${errorMsg}`,
      currentValue: '',
      timestamp: new Date().toISOString(),
    });
    services.progressTracker.increment('errors');
  }
}
