import { Command } from 'commander';
import { promises as fsPromises } from 'fs';
import path from 'path';
import chalk from 'chalk';
import { Semaphore } from 'async-mutex';
import AdmZip from 'adm-zip';
import { CID } from 'multiformats/cid';
import { createSubmitConfig } from '../config/submit.config.js';
import { logger } from '../utils/logger.js';
import { SchemaCacheService } from '../services/schema-cache.service.js';
import { IPLDCanonicalizerService } from '../services/ipld-canonicalizer.service.js';
import { CidCalculatorService } from '../services/cid-calculator.service.js';
import { CsvReporterService } from '../services/csv-reporter.service.js';
import { SimpleProgress } from '../utils/simple-progress.js';
import { FileEntry } from '../types/submit.types.js';
import { IPLDConverterService } from '../services/ipld-converter.service.js';
import { SEED_DATAGROUP_SCHEMA_CID } from '../config/constants.js';
import { processSinglePropertyInput } from '../utils/single-property-processor.js';
import { calculateEffectiveConcurrency } from '../utils/concurrency-calculator.js';
import { scanSinglePropertyDirectoryV2 } from '../utils/single-property-file-scanner-v2.js';
import { SchemaManifestService } from '../services/schema-manifest.service.js';
import { isImageFile } from '../utils/file-type-helpers.js';
import { CarOutputService } from '../services/car-output.service.js';
import {
  bail,
  isBatchInput,
  runBatchInput,
  sharedServices,
} from '../utils/batch-input.js';

interface HashedFile {
  originalPath: string;
  propertyCid: string;
  dataGroupCid: string;
  calculatedCid: string;
  transformedData: any;
  canonicalJson: string;
}

export interface HashCommandOptions {
  input: string;
  outputZip: string;
  outputCsv: string;
  outputCar?: string;
  maxConcurrentTasks?: number;
  propertyCid?: string;
  silent?: boolean;
  cwd?: string;
}

export function registerHashCommand(program: Command) {
  program
    .command('hash <input>')
    .description(
      'Calculate CIDs for all files in a single property ZIP archive, replace links with CIDs, and output transformed data as ZIP with CSV report.'
    )
    .option(
      '-o, --output-zip <path>',
      'Output ZIP file path for transformed data',
      'hashed-data.zip'
    )
    .option(
      '-c, --output-csv <path>',
      'Output CSV file path for hash results',
      'hash-results.csv'
    )
    .option(
      '--output-car <path>',
      'Also write every hashed JSON block of the run into one CAR file rooted at a county index block'
    )
    .option(
      '--max-concurrent-tasks <number>',
      "Target maximum concurrent processing tasks. If not provided, an OS-dependent limit (Unix: based on 'ulimit -n', Windows: CPU-based heuristic) is used, with a fallback of 10.",
      undefined
    )
    .option(
      '--property-cid <cid>',
      'Property CID to use for output folder and CSV. If not provided, uses the Seed datagroup CID if present.'
    )
    .action(async (input, options) => {
      options.maxConcurrentTasks =
        parseInt(options.maxConcurrentTasks, 10) || undefined;

      const workingDir = options.cwd || process.cwd();
      const commandOptions: HashCommandOptions = {
        ...options,
        input: path.resolve(workingDir, input),
        outputZip: path.resolve(workingDir, options.outputZip),
        outputCsv: path.resolve(workingDir, options.outputCsv),
        outputCar: options.outputCar
          ? path.resolve(workingDir, options.outputCar)
          : undefined,
        cwd: workingDir,
      };

      await handleHash(commandOptions);
    });
}

export interface HashServiceOverrides {
  schemaCacheService?: SchemaCacheService;
  canonicalizerService?: IPLDCanonicalizerService;
  cidCalculatorService?: CidCalculatorService;
  csvReporterService?: CsvReporterService;
  progressTracker?: SimpleProgress;
  ipldConverterService?: IPLDConverterService;
  schemaManifestService?: SchemaManifestService;
}

/** Returns the CAR root (county index CID) when `outputCar` is set. */
export async function handleHash(
  options: HashCommandOptions,
  serviceOverrides: HashServiceOverrides = {}
): Promise<string | undefined> {
  const batch = await isBatchInput(options.input);
  if (batch) {
    const existing = await fsPromises.stat(options.outputZip).catch(() => null);
    if (existing?.isFile()) {
      bail(
        options,
        `Output ZIP path ${options.outputZip} is a file; with a directory input it must be a directory that receives one ZIP per property`
      );
    }
    await fsPromises.mkdir(options.outputZip, { recursive: true });
  }
  // The CAR is internal to this run: opened after the checks above, finalized
  // by `finish`, and removed by `abort` (or the exit hook) on any failure.
  const car = options.outputCar
    ? new CarOutputService(options.outputCar)
    : undefined;
  await car?.open();
  const finish = async () => {
    if (!car) {
      return;
    }
    const { blocks, root } = await car.close();
    if (!options.silent) {
      console.log(
        chalk.green(
          `CAR written: ${car.target} (${blocks} blocks, root ${root})`
        )
      );
    }
    return root;
  };
  const run = batch
    ? runBatchInput(
        options,
        (property, overrides) => hashProperty(property, overrides, car),
        sharedServices(serviceOverrides),
        (stem) => ({ outputZip: path.join(options.outputZip, `${stem}.zip`) }),
        finish
      )
    : hashProperty(options, serviceOverrides, car).then(finish);
  return run.catch(async (error: unknown) => {
    await car?.abort();
    throw error;
  });
}

async function hashProperty(
  options: HashCommandOptions,
  serviceOverrides: HashServiceOverrides,
  car?: CarOutputService
) {
  if (!options.silent) {
    console.log(
      chalk.bold.blue('🐘 Elephant Network CLI - Hash (Single Property)')
    );
    console.log();
  }

  // Process single property ZIP input
  let processedInput;
  try {
    processedInput = await processSinglePropertyInput({
      inputPath: options.input,
      requireZip: false,
    });
  } catch (error) {
    logger.error(
      `Failed to process input: ${error instanceof Error ? error.message : String(error)}`
    );
    if (options.silent) {
      throw error;
    } else {
      process.exit(1);
    }
  }

  const { actualInputDir, cleanup } = processedInput;

  logger.technical(`Processing single property data from: ${actualInputDir}`);
  logger.technical(`Output ZIP: ${options.outputZip}`);
  logger.technical(`Output CSV: ${options.outputCsv}`);
  logger.info('Note: Processing single property data only');

  // Calculate effective concurrency
  const { effectiveConcurrency } = calculateEffectiveConcurrency({
    userSpecified: options.maxConcurrentTasks,
    fallback: 10,
    windowsFactor: 4,
  });

  const config = createSubmitConfig(
    {
      maxConcurrentUploads: undefined,
    },
    options.cwd
  );

  // Keep a reference to csvReporterService to use in the final catch block
  let csvReporterServiceInstance: CsvReporterService | undefined =
    serviceOverrides.csvReporterService;

  const schemaCacheService =
    serviceOverrides.schemaCacheService ?? new SchemaCacheService();
  const canonicalizerService =
    serviceOverrides.canonicalizerService ?? new IPLDCanonicalizerService();
  const cidCalculatorService =
    serviceOverrides.cidCalculatorService ?? new CidCalculatorService();
  const schemaManifestService =
    serviceOverrides.schemaManifestService ?? new SchemaManifestService();

  // Create a mock IPLD converter that only calculates CIDs without uploading
  const ipldConverterService =
    serviceOverrides.ipldConverterService ??
    new IPLDConverterService(
      actualInputDir,
      undefined, // No Pinata service for uploads
      cidCalculatorService,
      canonicalizerService
    );

  let progressTracker: SimpleProgress | undefined =
    serviceOverrides.progressTracker;
  const hashedFiles: HashedFile[] = [];
  const cidToFileMap = new Map<string, HashedFile>(); // Map CID to file for link replacement

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

    logger.info('Validating single property directory structure...');
    // For single property, we validate that the directory contains JSON files,
    // not that it contains property subdirectories
    const dirStats = await fsPromises.stat(actualInputDir);
    if (!dirStats.isDirectory()) {
      if (!options.silent) {
        console.log(chalk.red('❌ Extracted path is not a directory'));
      }
      await csvReporterService.finalize();
      await cleanup();
      if (options.silent) {
        throw new Error('Extracted path is not a directory');
      } else {
        process.exit(1);
      }
    }

    const entries = await fsPromises.readdir(actualInputDir, {
      withFileTypes: true,
    });
    const allFiles = entries.filter((entry) => entry.isFile());
    const jsonFiles = allFiles.filter((file) => file.name.endsWith('.json'));
    const imageFiles = allFiles.filter((file) => isImageFile(file.name));

    if (jsonFiles.length === 0) {
      logger.warn('No JSON files found in the property directory');
      await csvReporterService.finalize();
      await cleanup();
      return;
    }

    logger.success(
      `Found ${jsonFiles.length} JSON files and ${imageFiles.length} image files in property directory`
    );

    // Scan the single property directory using the new approach
    const propertyDirName = path.basename(actualInputDir);
    const scanResult = await scanSinglePropertyDirectoryV2(
      actualInputDir,
      propertyDirName,
      schemaManifestService
    );
    const {
      allFiles: scannedJsonFiles,
      validFilesCount,
      descriptiveFilesCount,
      schemaCids,
    } = scanResult;

    logger.info('Scanning to count total files...');
    const totalFiles = validFilesCount;
    logger.info(
      `Found ${totalFiles} file${totalFiles === 1 ? '' : 's'} to process (${descriptiveFilesCount} descriptive-named files will be processed via IPLD references)`
    );

    if (totalFiles === 0) {
      logger.warn('No files found to process');
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

    // Phase 1: Pre-fetching Schemas
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
    }

    // Phase 2: Processing Files
    progressTracker.setPhase('Processing Files', scannedJsonFiles.length);
    const localProcessingSemaphore = new Semaphore(effectiveConcurrency);

    const servicesForProcessing = {
      schemaCacheService,
      canonicalizerService,
      cidCalculatorService,
      csvReporterService,
      progressTracker,
      ipldConverterService,
    };

    // Phase 1: Process ONLY the seed datagroup file first to get property CID
    // This is the file with label "Seed" and relationships, not other files in the directory
    const seedDatagroupFile = scannedJsonFiles.find(
      (file) =>
        file.dataGroupCid === SEED_DATAGROUP_SCHEMA_CID ||
        file.dataGroupCid ===
          schemaManifestService.getDataGroupCidByLabel('Seed')
    );

    let calculatedSeedCid: string | undefined;

    if (seedDatagroupFile) {
      logger.info(
        'Processing seed datagroup file to determine property CID...'
      );

      // First, calculate the raw seed CID without processing any links
      // This gives us a temporary property CID to use for media directory calculation
      const seedFileContent = await fsPromises.readFile(
        seedDatagroupFile.filePath,
        'utf-8'
      );
      const seedData = JSON.parse(seedFileContent);
      const seedCanonicalJson = canonicalizerService.canonicalize(seedData);
      calculatedSeedCid =
        await cidCalculatorService.calculateCidFromCanonicalJson(
          seedCanonicalJson
        );

      logger.info(
        `Initial seed datagroup CID calculated: ${calculatedSeedCid}`
      );
    }

    // Determine the final property CID based on the priority:
    // 1. User-provided property CID (via --property-cid option)
    // 2. Calculated Seed datagroup CID (if seed file exists)
    // 3. Error if neither is available
    let finalPropertyCid: string;

    if (options.propertyCid) {
      // Use the user-provided property CID
      finalPropertyCid = options.propertyCid;
      logger.info(`Using user-provided property CID: ${finalPropertyCid}`);
    } else if (calculatedSeedCid) {
      // Use the calculated seed CID
      finalPropertyCid = calculatedSeedCid;
      logger.info(
        `Using calculated Seed datagroup CID as property CID: ${finalPropertyCid}`
      );
    } else {
      // Neither provided nor seed found - error
      const errorMsg =
        'Property CID could not be determined. Please provide --property-cid option or ensure your data contains a Seed datagroup.';
      logger.error(errorMsg);
      await csvReporterService.finalize();
      await cleanup();
      throw new Error(errorMsg);
    }

    // Phase 2: Process ALL files including the seed datagroup WITH links

    // First, process the seed datagroup WITH its links converted
    if (seedDatagroupFile) {
      logger.info('Re-processing seed datagroup with IPLD links...');

      // Update the seed datagroup file entry with the correct property CID
      const updatedSeedFile = {
        ...seedDatagroupFile,
        propertyCid: finalPropertyCid,
      };

      await processFileForHashing(
        updatedSeedFile,
        servicesForProcessing,
        hashedFiles,
        cidToFileMap
      );

      // Verify the seed CID matches what we calculated
      const processedSeedFile = hashedFiles.find(
        (f) => f.originalPath === seedDatagroupFile.filePath
      );

      if (processedSeedFile) {
        // The seed CID should now match because it was processed with all links
        logger.info(
          `Seed datagroup final CID: ${processedSeedFile.calculatedCid}`
        );

        // Update the property CID to ensure consistency
        processedSeedFile.propertyCid = processedSeedFile.calculatedCid;

        // If this is different from our initial calculation, update the final property CID
        // only if user didn't provide one
        if (
          !options.propertyCid &&
          processedSeedFile.calculatedCid !== calculatedSeedCid
        ) {
          // The seed CID changed after processing links
          // This is expected when the seed has relationships that needed to be converted
          logger.info(
            `Property CID updated after processing links: ${processedSeedFile.calculatedCid}`
          );
          finalPropertyCid = processedSeedFile.calculatedCid;

          // Update all remaining files to use the new property CID
        }
      }
    }

    // Now process remaining files (excluding seed which was just processed)
    const remainingFiles = scannedJsonFiles.filter(
      (file) => file.filePath !== seedDatagroupFile?.filePath
    );

    // Update all files to use the final property CID
    const updatedFiles = remainingFiles.map((file) => ({
      ...file,
      propertyCid: finalPropertyCid,
    }));

    if (updatedFiles.length > 0) {
      logger.info(`Processing ${updatedFiles.length} remaining files...`);

      const allOperationPromises: Promise<void>[] = [];
      for (const fileEntry of updatedFiles) {
        allOperationPromises.push(
          localProcessingSemaphore.runExclusive(async () =>
            processFileForHashing(
              fileEntry,
              servicesForProcessing,
              hashedFiles,
              cidToFileMap
            )
          )
        );
      }

      await Promise.all(allOperationPromises);
    }

    // Phase 3: Generate CSV output and create output ZIP
    progressTracker.setPhase('Creating Output Files', 2);

    // Generate CSV with hash results
    logger.info('Generating CSV with hash results...');
    const csvData: string[] = [
      'propertyCid,dataGroupCid,dataCid,filePath,uploadedAt', // Headers compatible with submit-to-contract and upload
    ];

    // Process hashed files to generate CSV entries
    // We only include main datagroup files in CSV, not linked files
    for (const hashedFile of hashedFiles) {
      if (hashedFile.dataGroupCid) {
        // Only include files with dataGroupCid (main files, not linked)
        // Calculate the path relative to the extracted ZIP content root
        let relativePath: string;

        // Ensure both paths are absolute for proper comparison
        const absoluteInputDir = path.resolve(actualInputDir);
        const absoluteOriginalPath = path.resolve(hashedFile.originalPath);

        // Check if the file is actually within the extraction directory
        if (absoluteOriginalPath.startsWith(absoluteInputDir)) {
          // File is within the extraction directory, calculate relative path
          relativePath = path.relative(absoluteInputDir, absoluteOriginalPath);
        } else {
          // File is outside extraction directory (shouldn't happen)
          // Just use the filename
          logger.warn(
            `File ${hashedFile.originalPath} is outside extraction directory ${actualInputDir}`
          );
          relativePath = path.basename(hashedFile.originalPath);
        }

        // Normalize the path separators for consistency (use forward slashes)
        relativePath = relativePath.replace(/\\/g, '/');

        // uploadedAt is filled by upload
        csvData.push(
          `${hashedFile.propertyCid},${hashedFile.dataGroupCid},${hashedFile.calculatedCid},${relativePath},`
        );
      }
    }

    // Write CSV file
    await fsPromises.writeFile(options.outputCsv, csvData.join('\n'), 'utf-8');
    logger.success(`CSV results written to: ${options.outputCsv}`);
    progressTracker.increment('processed');

    // Create output ZIP with transformed data
    logger.info('Creating output ZIP with transformed data...');
    const zip = new AdmZip();

    // Use the finalPropertyCid that was determined earlier for the ZIP folder name
    const propertyFolderName = finalPropertyCid;

    if (!propertyFolderName) {
      const errorMsg =
        'Could not determine property CID for output folder. This should not happen for valid single property data.';
      logger.error(errorMsg);
      throw new Error(errorMsg);
    }

    // Add each hashed file to the ZIP
    // For single property: use property CID as the single folder name (no 'data' wrapper)
    for (const hashedFile of hashedFiles) {
      // Single folder structure: propertyCid/calculatedCid.json
      const zipPath = path.join(
        propertyFolderName,
        `${hashedFile.calculatedCid}.json`
      );

      // Add the canonical JSON to the ZIP
      zip.addFile(zipPath, Buffer.from(hashedFile.canonicalJson, 'utf-8'));
    }

    // The same bytes go into the CAR when --output-car is set, once per CID
    // within this property (cidToFileMap already keys every hashed file by CID).
    // Block order is property order (sorted names in batch mode) then CID
    // order, so the same input yields the same CAR bytes.
    // ponytail: json blocks only; add media blocks if a consumer needs them in the CAR
    for (const [cid, hashedFile] of [...cidToFileMap].sort(([a], [b]) =>
      a.localeCompare(b)
    )) {
      await car?.put(
        CID.parse(cid),
        Buffer.from(hashedFile.canonicalJson, 'utf-8')
      );
    }
    // One index entry per property: its data-group roots, the CSV rows above.
    await car?.property(
      CID.parse(propertyFolderName),
      Object.fromEntries(
        hashedFiles
          .filter((hashedFile) => hashedFile.dataGroupCid)
          .map((hashedFile) => [
            hashedFile.dataGroupCid,
            CID.parse(hashedFile.calculatedCid),
          ])
      )
    );

    // Add image files with their original names
    for (const imageFile of imageFiles) {
      zip.addLocalFile(
        path.join(actualInputDir, imageFile.name),
        propertyFolderName
      );
    }

    // Write the ZIP file
    zip.writeZip(options.outputZip);
    logger.success(`Output ZIP created: ${options.outputZip}`);
    progressTracker.increment('processed');

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

    if (!options.silent) {
      console.log(chalk.green('\n✅ Hash process finished\n'));
      console.log(chalk.bold('📊 Final Report:'));
      console.log(
        `  Total JSON files scanned:    ${finalMetrics.total || totalFiles}`
      );
      console.log(`  Files skipped: ${finalMetrics.skipped || 0}`);
      console.log(`  Processing errors: ${finalMetrics.errors || 0}`);
      console.log(`  Successfully processed:  ${finalMetrics.processed || 0}`);

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
      console.log(`  Output ZIP:     ${options.outputZip}`);
      console.log(`  Output CSV:     ${options.outputCsv}`);
    }

    // Clean up temporary directory if it was created
    await cleanup();
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(chalk.red(`CRITICAL_ERROR_HASH: ${errorMessage}`));
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
    }

    // Clean up temporary directory if it was created
    await cleanup();

    if (options.silent) {
      throw error;
    } else {
      process.exit(1);
    }
  }
}

async function processFileForHashing(
  fileEntry: FileEntry,
  services: {
    schemaCacheService: SchemaCacheService;
    canonicalizerService: IPLDCanonicalizerService;
    cidCalculatorService: CidCalculatorService;
    csvReporterService: CsvReporterService;
    progressTracker: SimpleProgress;
    ipldConverterService: IPLDConverterService;
  },
  hashedFiles: HashedFile[],
  cidToFileMap: Map<string, HashedFile>
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
    let schema = null;

    // Only try to load schema if we have a valid dataGroupCid
    if (schemaCid && schemaCid.trim() !== '') {
      schema = await services.schemaCacheService.get(schemaCid);
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
    } else {
      // No schema for files that are not data-group roots
      // We still need to process them for IPLD links
      logger.debug(
        `No dataGroupCid for ${fileEntry.filePath}, processing without schema validation`
      );
    }

    // Check if data has IPLD links that need conversion
    let dataToProcess = jsonData;

    // Determine the property CID early for seed files
    const isSeedFile = fileEntry.dataGroupCid === SEED_DATAGROUP_SCHEMA_CID;

    let linkedFilesFromConversion: Array<{
      path: string;
      cid: string;
      canonicalJson: string;
      processedData: any;
    }> = [];

    // After successful validation, process IPLD links to convert file paths to CIDs
    const hasLinks = services.ipldConverterService?.hasIPLDLinks(
      jsonData,
      schema
    );

    if (services.ipldConverterService && hasLinks) {
      logger.debug(
        `Data has IPLD links, converting file paths to CIDs for ${fileEntry.filePath}`
      );

      // Calculate CIDs for linked files without uploading. A link that cannot
      // be resolved fails this file; the caller records it in the errors CSV.
      const conversionResult = await convertToIPLDWithCIDCalculation(
        jsonData,
        fileEntry.filePath,
        schema,
        services,
        hashedFiles,
        cidToFileMap
      );
      dataToProcess = conversionResult.convertedData;
      linkedFilesFromConversion = conversionResult.linkedFiles;

      if (conversionResult.hasLinks) {
        logger.debug(
          `Converted ${conversionResult.linkedCIDs.length} file paths to CIDs`
        );
      }
    }

    // Calculate canonical JSON and CID for the final transformed data
    const finalCanonicalJson =
      services.canonicalizerService.canonicalize(dataToProcess);

    const calculatedCid =
      await services.cidCalculatorService.calculateCidFromCanonicalJson(
        finalCanonicalJson
      );

    // For seed files, the propertyCid should be the same as the calculated CID
    const finalPropertyCid = isSeedFile ? calculatedCid : fileEntry.propertyCid;

    // Now add all the linked files with the correct property CID
    for (const linkedFile of linkedFilesFromConversion) {
      const hashedFile: HashedFile = {
        originalPath: linkedFile.path,
        propertyCid: finalPropertyCid,
        dataGroupCid: '', // Linked files don't have a dataGroupCid
        calculatedCid: linkedFile.cid,
        transformedData: linkedFile.processedData,
        canonicalJson: linkedFile.canonicalJson,
      };
      hashedFiles.push(hashedFile);
      cidToFileMap.set(linkedFile.cid, hashedFile);
    }

    const hashedFile: HashedFile = {
      originalPath: fileEntry.filePath,
      propertyCid: finalPropertyCid,
      dataGroupCid: fileEntry.dataGroupCid,
      calculatedCid,
      transformedData: dataToProcess,
      canonicalJson: finalCanonicalJson,
    };

    hashedFiles.push(hashedFile);
    cidToFileMap.set(calculatedCid, hashedFile);

    logger.info(`Processed ${fileEntry.filePath} (CID: ${calculatedCid})`);
    services.progressTracker.increment('processed');
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

/**
 * Custom IPLD converter that calculates CIDs for linked files without uploading
 */
async function convertToIPLDWithCIDCalculation(
  data: any,
  currentFilePath: string,
  schema: any,
  services: {
    canonicalizerService: IPLDCanonicalizerService;
    cidCalculatorService: CidCalculatorService;
  },
  hashedFiles: HashedFile[],
  cidToFileMap: Map<string, HashedFile>
): Promise<{
  convertedData: any;
  hasLinks: boolean;
  linkedCIDs: string[];
  linkedFiles: Array<{
    path: string;
    cid: string;
    canonicalJson: string;
    processedData: any;
  }>;
}> {
  const linkedCIDs: string[] = [];
  const linkedFilesData: Array<{
    path: string;
    cid: string;
    canonicalJson: string;
    processedData: any;
  }> = [];

  const convertedData = await processDataForIPLD(
    data,
    linkedCIDs,
    currentFilePath,
    schema,
    services,
    hashedFiles,
    cidToFileMap,
    undefined,
    linkedFilesData
  );

  return {
    convertedData,
    hasLinks: linkedCIDs.length > 0,
    linkedCIDs,
    linkedFiles: linkedFilesData,
  };
}

async function processDataForIPLD(
  data: any,
  linkedCIDs: string[],
  currentFilePath: string,
  schema: any,
  services: {
    canonicalizerService: IPLDCanonicalizerService;
    cidCalculatorService: CidCalculatorService;
  },
  hashedFiles: HashedFile[],
  cidToFileMap: Map<string, HashedFile>,
  fieldName?: string,
  linkedFilesData?: Array<{
    path: string;
    cid: string;
    canonicalJson: string;
    processedData: any;
  }>
): Promise<any> {
  // Handle string values for ipfs_url fields or ipfs_uri format
  if (
    typeof data === 'string' &&
    (fieldName === 'ipfs_url' || schema?.format === 'ipfs_uri')
  ) {
    // Check if it's already an IPFS URI
    if (data.startsWith('ipfs://')) {
      return data;
    }

    // Check if it's a valid CID
    try {
      CID.parse(data);
      // It's a CID, convert to IPFS URI
      return `ipfs://${data}`;
    } catch {
      // Not a CID, treat as local path
    }

    // It's a local path
    if (isImageFile(data)) {
      const cid = await getCidForFilePath(
        data,
        currentFilePath,
        services,
        linkedCIDs,
        linkedFilesData
      );
      return `ipfs://${cid}`;
    }

    // Not an image file, return as-is
    return data;
  }

  if (!data || typeof data !== 'object') {
    return data;
  }

  // Check if this is a pointer object with file path
  if (
    Object.prototype.hasOwnProperty.call(data, '/') &&
    typeof data['/'] === 'string' &&
    Object.keys(data).length === 1
  ) {
    const pointerValue = data['/'];

    // Check if it's already a valid CID
    let isCID = false;
    try {
      CID.parse(pointerValue);
      isCID = true;
    } catch {
      // Not a valid CID, treat as file path
    }

    if (isCID) {
      // Already a CID, return as-is (proper IPLD link format)
      linkedCIDs.push(pointerValue);
      return data;
    } else {
      // This is a file path reference
      const cid = await getCidForFilePath(
        pointerValue,
        currentFilePath,
        services,
        linkedCIDs,
        linkedFilesData
      );
      return { '/': cid };
    }
  }

  // Handle arrays
  if (Array.isArray(data)) {
    const itemSchema = schema?.items;
    return Promise.all(
      data.map((item) =>
        processDataForIPLD(
          item,
          linkedCIDs,
          currentFilePath,
          itemSchema,
          services,
          hashedFiles,
          cidToFileMap,
          fieldName,
          linkedFilesData
        )
      )
    );
  }

  // Handle objects recursively
  const processed: any = {};
  for (const key in data) {
    if (Object.prototype.hasOwnProperty.call(data, key)) {
      const propertySchema = schema?.properties?.[key];
      processed[key] = await processDataForIPLD(
        data[key],
        linkedCIDs,
        currentFilePath,
        propertySchema,
        services,
        hashedFiles,
        cidToFileMap,
        key, // Pass the field name
        linkedFilesData
      );
    }
  }
  return processed;
}

/**
 * Calculate CID for a file without uploading it
 */
async function calculateCIDForFile(
  filePath: string,
  currentFilePath: string,
  services: {
    canonicalizerService: IPLDCanonicalizerService;
    cidCalculatorService: CidCalculatorService;
  },
  linkedFiles?: Array<{
    path: string;
    cid: string;
    canonicalJson: string;
    processedData: any;
  }>
): Promise<string> {
  let resolvedPath: string;

  // Determine if it's an absolute or relative path
  if (filePath.startsWith('/')) {
    resolvedPath = filePath;
  } else {
    // For relative paths, resolve based on directory of the current file
    const currentDir = path.dirname(currentFilePath);
    resolvedPath = path.join(currentDir, filePath);
  }

  if (isImageFile(resolvedPath)) {
    // Images are content-addressed by their bytes and never emitted as JSON blocks
    return services.cidCalculatorService.calculateCidV1ForRawData(
      await fsPromises.readFile(resolvedPath)
    );
  }

  if (path.extname(resolvedPath).toLowerCase() !== '.json') {
    throw new Error(
      `cannot link ${filePath}: only JSON and image files can be linked`
    );
  }

  const parsedData = JSON.parse(
    await fsPromises.readFile(resolvedPath, 'utf-8')
  );
  // Recursively process the parsed data to convert any nested file path links
  // Use the same linkedFiles collection to track nested files
  const nestedLinkedCIDs: string[] = [];
  const processedData = await processDataForIPLD(
    parsedData,
    nestedLinkedCIDs,
    resolvedPath,
    undefined, // No schema for nested files
    services,
    [], // Don't track in hashedFiles yet
    new Map(), // Don't track in cidToFileMap yet
    undefined, // No field name context
    linkedFiles // Pass the same linkedFiles collection to track nested files
  );

  const canonicalJson =
    services.canonicalizerService.canonicalize(processedData);
  const calculatedCid =
    await services.cidCalculatorService.calculateCidFromCanonicalJson(
      canonicalJson
    );

  // Track this linked file if we have a collection
  if (linkedFiles) {
    linkedFiles.push({
      path: resolvedPath,
      cid: calculatedCid,
      canonicalJson,
      processedData,
    });
  }

  logger.debug(
    `Calculated CID for linked file ${resolvedPath}: ${calculatedCid}`
  );
  return calculatedCid;
}

/**
 * Get CID for a file path
 */
async function getCidForFilePath(
  filePath: string,
  currentFilePath: string,
  services: {
    canonicalizerService: IPLDCanonicalizerService;
    cidCalculatorService: CidCalculatorService;
  },
  linkedCIDs: string[],
  linkedFilesData?: Array<{
    path: string;
    cid: string;
    canonicalJson: string;
    processedData: any;
  }>
): Promise<string> {
  const cid = await calculateCIDForFile(
    filePath,
    currentFilePath,
    services,
    linkedFilesData
  );
  linkedCIDs.push(cid);
  return cid;
}
