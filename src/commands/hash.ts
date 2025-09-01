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
import { isHtmlFile, isImageFile } from '../utils/file-type-helpers.js';

interface HashedFile {
  originalPath: string;
  propertyCid: string;
  dataGroupCid: string;
  calculatedCid: string;
  transformedData: any;
  canonicalJson: string;
}

interface MediaFile {
  originalPath: string;
  fileName: string;
  content: Buffer;
  isHtml: boolean;
}

export interface HashCommandOptions {
  input: string;
  outputZip: string;
  outputCsv: string;
  maxConcurrentTasks?: number;
  propertyCid?: string;
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

      const commandOptions: HashCommandOptions = {
        ...options,
        input: path.resolve(input),
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
  const mediaFiles: MediaFile[] = []; // Collect HTML and image files
  let mediaDirectoryCid: string | undefined; // CID for the media directory

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
    const allFiles = entries.filter((entry) => entry.isFile());
    const jsonFiles = allFiles.filter((file) => file.name.endsWith('.json'));
    const htmlFiles = allFiles.filter((file) => isHtmlFile(file.name));
    const imageFiles = allFiles.filter((file) => isImageFile(file.name));

    if (jsonFiles.length === 0) {
      logger.warn('No JSON files found in the property directory');
      await csvReporterService.finalize();
      await cleanup();
      return;
    }

    logger.success(
      `Found ${jsonFiles.length} JSON files, ${htmlFiles.length} HTML files, and ${imageFiles.length} image files in property directory`
    );

    // Collect HTML and image files as media files
    for (const htmlFile of htmlFiles) {
      const filePath = path.join(actualInputDir, htmlFile.name);
      const content = await fsPromises.readFile(filePath);
      mediaFiles.push({
        originalPath: filePath,
        fileName: htmlFile.name,
        content,
        isHtml: true,
      });
    }

    for (const imageFile of imageFiles) {
      const filePath = path.join(actualInputDir, imageFile.name);
      const content = await fsPromises.readFile(filePath);
      mediaFiles.push({
        originalPath: filePath,
        fileName: imageFile.name,
        content,
        isHtml: false,
      });
    }

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

    // We need to calculate the media directory CID after determining the final property CID
    // So we'll move this calculation to after the property CID determination

    // The scannedJsonFiles array is already populated from scanSinglePropertyDirectory

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

    // Now calculate directory CID for media files if any exist
    // We use the final property CID to match what the upload command does
    if (mediaFiles.length > 0) {
      logger.info('Calculating directory CID for HTML and image files...');
      try {
        const mediaFilesForCid = mediaFiles.map((file) => ({
          name: file.fileName,
          content: file.content,
        }));

        // Use the final property CID for the directory name to match upload command
        const directoryName = `${finalPropertyCid}_media`;

        // Sort files alphabetically to ensure deterministic CID
        const sortedMediaFiles = [...mediaFilesForCid].sort((a, b) =>
          a.name.localeCompare(b.name)
        );

        // Calculate the directory CID
        mediaDirectoryCid = await cidCalculatorService.calculateDirectoryCid(
          sortedMediaFiles,
          directoryName
        );

        // Log details for debugging
        logger.info(`Media directory details:
  Directory name: ${directoryName}
  Number of files: ${sortedMediaFiles.length}
  Files: ${sortedMediaFiles.map((f) => `${f.name} (${f.content.length} bytes)`).join(', ')}
  Calculated CID: ${mediaDirectoryCid}`);

        logger.success(`Calculated media directory CID: ${mediaDirectoryCid}`);
      } catch (error) {
        logger.error(
          `Failed to calculate media directory CID: ${error instanceof Error ? error.message : String(error)}`
        );
        // Continue without media directory CID
      }
    }

    // Phase 2: Process ALL files including the seed datagroup WITH links
    // Now that we have the media directory CID, we can properly process all files

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
        cidToFileMap,
        mediaDirectoryCid // Now we have media CID for any HTML references
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
      logger.info(
        `Processing ${updatedFiles.length} remaining files with media CID available...`
      );

      const allOperationPromises: Promise<void>[] = [];
      for (const fileEntry of updatedFiles) {
        allOperationPromises.push(
          localProcessingSemaphore.runExclusive(async () =>
            processFileForHashing(
              fileEntry,
              servicesForProcessing,
              hashedFiles,
              cidToFileMap,
              mediaDirectoryCid // Now all files have access to media CID
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
      'propertyCid,dataGroupCid,dataCid,filePath,uploadedAt,htmlLink', // Headers compatible with submit-to-contract and upload
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

        // Add empty uploadedAt field and htmlLink with media directory CID if available
        const htmlLink = mediaDirectoryCid
          ? `https://ipfs.io/ipfs/${mediaDirectoryCid}`
          : '';
        csvData.push(
          `${hashedFile.propertyCid},${hashedFile.dataGroupCid},${hashedFile.calculatedCid},${relativePath},,${htmlLink}`
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

    // Add media files (HTML and images) with their original names
    for (const mediaFile of mediaFiles) {
      const zipPath = path.join(propertyFolderName, mediaFile.fileName);
      zip.addFile(zipPath, mediaFile.content);
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
  cidToFileMap: Map<string, HashedFile>,
  mediaDirectoryCid?: string
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
          timestamp: new Date().toISOString(),
        });
        services.progressTracker.increment('errors');
        return;
      }
    } else {
      // No schema for non-datagroup files like fact_sheet.json
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

    // Special debug for fact_sheet.json
    if (fileEntry.filePath.includes('fact_sheet')) {
      logger.info(
        `Processing fact_sheet.json: hasLinks=${hasLinks}, ipfs_url="${jsonData.ipfs_url}", mediaDirectoryCid=${mediaDirectoryCid}`
      );
    }

    if (services.ipldConverterService && hasLinks) {
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
          cidToFileMap,
          mediaDirectoryCid
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
  cidToFileMap: Map<string, HashedFile>,
  mediaDirectoryCid?: string
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
    linkedFilesData,
    mediaDirectoryCid
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
  }>,
  mediaDirectoryCid?: string
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
    if (isImageFile(data) || isHtmlFile(data)) {
      const cid = await getCidForFilePath(
        data,
        currentFilePath,
        services,
        linkedCIDs,
        mediaDirectoryCid,
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
        mediaDirectoryCid,
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
          linkedFilesData,
          mediaDirectoryCid
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
        linkedFilesData,
        mediaDirectoryCid
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
  }>,
  mediaDirectoryCid?: string
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
        linkedFiles, // Pass the same linkedFiles collection to track nested files
        mediaDirectoryCid // Pass through the media directory CID
      );

      const canonicalJson =
        services.canonicalizerService.canonicalize(processedData);
      calculatedCid =
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
    } catch {
      // If not JSON, treat as raw text and calculate CID using raw codec
      const buffer = Buffer.from(fileContent as string, 'utf-8');
      calculatedCid =
        await services.cidCalculatorService.calculateCidV1ForRawData(buffer);

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
 * Get CID for a file path, using media directory CID for HTML files if available
 */
async function getCidForFilePath(
  filePath: string,
  currentFilePath: string,
  services: {
    canonicalizerService: IPLDCanonicalizerService;
    cidCalculatorService: CidCalculatorService;
  },
  linkedCIDs: string[],
  mediaDirectoryCid?: string,
  linkedFilesData?: Array<{
    path: string;
    cid: string;
    canonicalJson: string;
    processedData: any;
  }>
): Promise<string> {
  // For HTML files, always use the media directory CID
  if (isHtmlFile(filePath)) {
    if (!mediaDirectoryCid) {
      // This should only happen if the seed datagroup file references HTML, which is unusual
      // Log a warning and throw an error to make this explicit
      logger.error(
        `HTML file ${filePath} referenced but media directory CID not available. ` +
          `This typically happens when the seed datagroup file references HTML files. ` +
          `The seed datagroup should not reference HTML files directly.`
      );
      throw new Error(
        `Cannot process HTML reference in seed datagroup file. ` +
          `HTML files should only be referenced by other data files, not the seed datagroup.`
      );
    }
    linkedCIDs.push(mediaDirectoryCid);
    return mediaDirectoryCid;
  }

  // For non-HTML files (JSON and images), calculate individual CID
  const cid = await calculateCIDForFile(
    filePath,
    currentFilePath,
    services,
    false, // not necessarily an ipfs_uri format
    linkedFilesData,
    mediaDirectoryCid
  );
  linkedCIDs.push(cid);
  return cid;
}
