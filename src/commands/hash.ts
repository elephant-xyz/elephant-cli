import { Command } from 'commander';
import { promises as fsPromises } from 'fs';
import path from 'path';
import chalk from 'chalk';
import { Semaphore } from 'async-mutex';
import AdmZip from 'adm-zip';
import { DEFAULT_IPFS_GATEWAY } from '../config/constants.js';
import { createSubmitConfig } from '../config/submit.config.js';
import { logger } from '../utils/logger.js';
import { SchemaCacheService } from '../services/schema-cache.service.js';
import { JsonValidatorService } from '../services/json-validator.service.js';
import { IPLDCanonicalizerService } from '../services/ipld-canonicalizer.service.js';
import { CidCalculatorService } from '../services/cid-calculator.service.js';
import { CsvReporterService } from '../services/csv-reporter.service.js';
import { SimpleProgress } from '../utils/simple-progress.js';
import { FileEntry } from '../types/submit.types.js';
import { IPFSService } from '../services/ipfs.service.js';
import { IPLDConverterService } from '../services/ipld-converter.service.js';
import { SEED_DATAGROUP_SCHEMA_CID } from '../config/constants.js';
import {
  processSinglePropertyInput,
  validateDataGroupSchema,
} from '../utils/single-property-processor.js';
import { calculateEffectiveConcurrency } from '../utils/concurrency-calculator.js';
import { scanSinglePropertyDirectoryV2 } from '../utils/single-property-file-scanner-v2.js';
import { SchemaManifestService } from '../services/schema-manifest.service.js';
import { CID } from 'multiformats/cid';

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
  maxConcurrentTasks?: number;
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
      'upload-results.csv'
    )
    .option(
      '--max-concurrent-tasks <number>',
      "Target maximum concurrent processing tasks. If not provided, an OS-dependent limit (Unix: based on 'ulimit -n', Windows: CPU-based heuristic) is used, with a fallback of 10.",
      undefined
    )
    .action(async (input, options) => {
      options.maxConcurrentTasks =
        parseInt(options.maxConcurrentTasks, 10) || undefined;

      const commandOptions: HashCommandOptions = {
        ...options,
        input: path.resolve(input),
      };

      await handleHash(commandOptions);
    });
}

export interface HashServiceOverrides {
  ipfsServiceForSchemas?: IPFSService;
  schemaCacheService?: SchemaCacheService;
  jsonValidatorService?: JsonValidatorService;
  canonicalizerService?: IPLDCanonicalizerService;
  cidCalculatorService?: CidCalculatorService;
  csvReporterService?: CsvReporterService;
  progressTracker?: SimpleProgress;
  ipldConverterService?: IPLDConverterService;
  schemaManifestService?: SchemaManifestService;
}

export async function handleHash(
  options: HashCommandOptions,
  serviceOverrides: HashServiceOverrides = {}
) {
  console.log(
    chalk.bold.blue('🐘 Elephant Network CLI - Hash (Single Property)')
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
  logger.technical(`Output ZIP: ${options.outputZip}`);
  logger.technical(`Output CSV: ${options.outputCsv}`);
  logger.info('Note: Processing single property data only');

  // Calculate effective concurrency
  const { effectiveConcurrency } = calculateEffectiveConcurrency({
    userSpecified: options.maxConcurrentTasks,
    fallback: 10,
    windowsFactor: 4,
  });

  const config = createSubmitConfig({
    maxConcurrentUploads: undefined,
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
    }

    // The allFiles array is already populated from scanSinglePropertyDirectory

    // Phase 2: Processing Files
    progressTracker.setPhase('Processing Files', allFiles.length);
    const localProcessingSemaphore = new Semaphore(effectiveConcurrency);

    const servicesForProcessing = {
      schemaCacheService,
      jsonValidatorService,
      canonicalizerService,
      cidCalculatorService,
      csvReporterService,
      progressTracker,
      ipldConverterService,
    };

    // Map to store seed CIDs for directories
    const seedCidMap = new Map<string, string>(); // directory path -> calculated seed CID
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
              hashedFiles,
              cidToFileMap,
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

    // Generate CSV with hash results (similar to validate-and-upload but without htmlLink)
    logger.info('Generating CSV with hash results...');
    const csvData: string[] = [
      'propertyCid,dataGroupCid,dataCid,filePath,uploadedAt', // Headers compatible with submit-to-contract
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

        // Add empty uploadedAt field for compatibility with submit-to-contract
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

    // Determine the property CID (should be consistent for single property)
    // Use the first non-empty propertyCid found
    let propertyFolderName = '';
    for (const hashedFile of hashedFiles) {
      if (hashedFile.propertyCid && hashedFile.propertyCid !== '') {
        propertyFolderName = hashedFile.propertyCid;
        break;
      }
    }

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

    console.log(chalk.green('\n✅ Hash process finished\n'));
    console.log(chalk.bold('📊 Final Report:'));
    console.log(
      `  Total files scanned:    ${finalMetrics.total || totalFiles}`
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

    process.exit(1);
  }
}

async function processSeedFile(
  fileEntry: FileEntry,
  services: {
    schemaCacheService: SchemaCacheService;
    jsonValidatorService: JsonValidatorService;
    canonicalizerService: IPLDCanonicalizerService;
    cidCalculatorService: CidCalculatorService;
    csvReporterService: CsvReporterService;
    progressTracker: SimpleProgress;
    ipldConverterService: IPLDConverterService;
  },
  hashedFiles: HashedFile[],
  cidToFileMap: Map<string, HashedFile>,
  seedCidMap: Map<string, string>,
  failedSeedDirectories: Set<string>
): Promise<void> {
  const dirPath = path.dirname(fileEntry.filePath);
  const hashedFilesCountBefore = hashedFiles.length;
  const errorsCountBefore = services.progressTracker.getMetrics().errors;

  try {
    // Process the seed file exactly like a normal file
    await processFileForHashing(fileEntry, services, hashedFiles, cidToFileMap);

    // Check if processing was successful
    const latestFile = hashedFiles[hashedFiles.length - 1];
    const fileAdded =
      hashedFiles.length > hashedFilesCountBefore &&
      latestFile &&
      latestFile.originalPath === fileEntry.filePath;

    const errorsCountAfter = services.progressTracker.getMetrics().errors;
    const newErrorsOccurred = errorsCountAfter > errorsCountBefore;

    if (fileAdded) {
      // Successful processing
      seedCidMap.set(dirPath, latestFile.calculatedCid);
      // Update the seed file's property CID to the calculated CID
      latestFile.propertyCid = latestFile.calculatedCid;
      logger.debug(
        `Stored seed CID ${latestFile.calculatedCid} for directory ${dirPath}`
      );
    } else if (newErrorsOccurred) {
      // Validation or processing failed
      failedSeedDirectories.add(dirPath);
      logger.error(
        `Seed validation/processing failed for ${fileEntry.filePath}. All other files in directory ${dirPath} will be skipped.`
      );
    } else {
      // No file added and no errors - this shouldn't happen, but treat as failure
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

async function processFileForHashing(
  fileEntry: FileEntry,
  services: {
    schemaCacheService: SchemaCacheService;
    jsonValidatorService: JsonValidatorService;
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

    // Check if data has IPLD links that need conversion
    let dataToProcess = jsonData;
    const dataForValidation = jsonData;

    // First validate the original data with file paths that can be resolved locally
    // Note: We pass false to allow resolution of local file references for validation
    const validationResult = await services.jsonValidatorService.validate(
      dataForValidation,
      schema,
      fileEntry.filePath,
      false // allow resolution of local file references for validation
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

    // Determine the property CID early for seed files
    const isSeedFile = fileEntry.dataGroupCid === SEED_DATAGROUP_SCHEMA_CID;

    let linkedFilesFromConversion: Array<{
      path: string;
      cid: string;
      canonicalJson: string;
      processedData: any;
    }> = [];

    // After successful validation, process IPLD links to convert file paths to CIDs
    if (
      services.ipldConverterService &&
      services.ipldConverterService.hasIPLDLinks(jsonData, schema)
    ) {
      logger.debug(
        `Data has IPLD links, converting file paths to CIDs for ${fileEntry.filePath}`
      );

      try {
        // Create a custom IPLD converter that calculates CIDs without uploading
        // Use a placeholder property CID for now
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
      } catch (conversionError) {
        const errorMsg =
          conversionError instanceof Error
            ? conversionError.message
            : String(conversionError);
        logger.error(
          `Failed to convert IPLD links for ${fileEntry.filePath}: ${errorMsg}`
        );
        // Continue with original data
        dataToProcess = jsonData;
      }
    }

    // Calculate canonical JSON and CID for the final transformed data
    const finalCanonicalJson =
      services.canonicalizerService.canonicalize(dataToProcess);

    const calculatedCid =
      await services.cidCalculatorService.calculateCidFromCanonicalJson(
        finalCanonicalJson,
        dataToProcess
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

    // It's a local path, calculate CID for the file
    if (isImageFile(data)) {
      const cid = await calculateCIDForFile(
        data,
        currentFilePath,
        services,
        true, // treat as ipfs_uri format
        linkedFilesData
      );
      linkedCIDs.push(cid);
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
      // This is a file path reference - calculate its CID
      const cid = await calculateCIDForFile(
        pointerValue,
        currentFilePath,
        services,
        false, // not necessarily an ipfs_uri format
        linkedFilesData
      );
      linkedCIDs.push(cid);
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
  isIpfsUriFormat: boolean,
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

  // Check if it's an image file and schema expects IPFS URI
  const isImage = isImageFile(resolvedPath) && isIpfsUriFormat;

  // Read the file (binary for images, utf-8 for text)
  const fileContent = isImage
    ? await fsPromises.readFile(resolvedPath)
    : await fsPromises.readFile(resolvedPath, 'utf-8');

  // Handle based on file type
  let calculatedCid: string;

  if (isImage) {
    // For images, calculate CID v1 with raw codec
    calculatedCid =
      await services.cidCalculatorService.calculateCidV1ForRawData(
        fileContent as Buffer
      );
  } else {
    // Try to parse as JSON
    try {
      const parsedData = JSON.parse(fileContent as string);
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
      calculatedCid =
        await services.cidCalculatorService.calculateCidFromCanonicalJson(
          canonicalJson,
          processedData
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
    } catch {
      // If not JSON, treat as raw text and calculate CID
      const buffer = Buffer.from(fileContent as string, 'utf-8');
      calculatedCid =
        await services.cidCalculatorService.calculateCidV1(buffer);

      // Track this linked file if we have a collection
      if (linkedFiles) {
        linkedFiles.push({
          path: resolvedPath,
          cid: calculatedCid,
          canonicalJson: buffer.toString('utf-8'),
          processedData: buffer.toString('utf-8'),
        });
      }
    }
  }

  logger.debug(
    `Calculated CID for linked file ${resolvedPath}: ${calculatedCid}`
  );
  return calculatedCid;
}

/**
 * Check if a file is an image based on its extension
 */
function isImageFile(filePath: string): boolean {
  const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp'];
  const ext = path.extname(filePath).toLowerCase();
  return imageExtensions.includes(ext);
}
