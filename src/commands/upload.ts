import { Command } from 'commander';
import { promises as fsPromises } from 'fs';
import path from 'path';
import chalk from 'chalk';
import { logger } from '../utils/logger.js';
import { ZipExtractorService } from '../services/zip-extractor.service.js';
import { PinataDirectoryUploadService } from '../services/pinata-directory-upload.service.js';
import { SimpleProgress } from '../utils/simple-progress.js';
import { analyzeDatagroupFiles } from '../utils/datagroup-analyzer.js';
import { SchemaManifestService } from '../services/schema-manifest.service.js';

export interface UploadCommandOptions {
  input: string;
  pinataJwt?: string;
  outputCsv?: string;
}

export function registerUploadCommand(program: Command) {
  program
    .command('upload <input>')
    .description(
      'Upload single property data from the output of hash command to IPFS. The input should be a ZIP file containing a single property directory with CID-named JSON files.'
    )
    .option(
      '--pinata-jwt <jwt>',
      'Pinata JWT for authentication. If not provided, uses PINATA_JWT environment variable.'
    )
    .option(
      '-o, --output-csv <path>',
      'Output CSV file path for upload results',
      'upload-results.csv'
    )
    .action(async (input, options) => {
      const commandOptions: UploadCommandOptions = {
        ...options,
        input: path.resolve(input),
        pinataJwt: options.pinataJwt || process.env.PINATA_JWT,
      };

      if (!commandOptions.pinataJwt) {
        console.error(
          chalk.red(
            '❌ Pinata JWT is required. Provide it via --pinata-jwt option or PINATA_JWT environment variable.'
          )
        );
        process.exit(1);
      }

      await handleUpload(commandOptions);
    });
}

export interface UploadServiceOverrides {
  zipExtractorService?: ZipExtractorService;
  pinataDirectoryUploadService?: PinataDirectoryUploadService;
  progressTracker?: SimpleProgress;
  schemaManifestService?: SchemaManifestService;
}

export async function handleUpload(
  options: UploadCommandOptions,
  serviceOverrides: UploadServiceOverrides = {}
) {
  const isTestMode =
    serviceOverrides.zipExtractorService ||
    serviceOverrides.pinataDirectoryUploadService ||
    serviceOverrides.progressTracker;

  if (!isTestMode) {
    console.log(chalk.bold.blue('🐘 Elephant Network CLI - Upload to IPFS'));
    console.log();
  }

  const zipExtractorService =
    serviceOverrides.zipExtractorService ?? new ZipExtractorService();
  let extractedPath: string | null = null;
  let tempRootDir: string | null = null;
  let progressTracker = serviceOverrides.progressTracker;

  try {
    // Verify JWT is available
    if (!options.pinataJwt) {
      throw new Error(
        'Pinata JWT is required. Provide it via --pinata-jwt option or PINATA_JWT environment variable.'
      );
    }

    // Verify input file exists and is a ZIP file
    logger.info(`Checking input file: ${options.input}`);
    const inputStats = await fsPromises.stat(options.input).catch(() => null);
    if (!inputStats || !inputStats.isFile()) {
      throw new Error(`Input file not found: ${options.input}`);
    }

    const isZip = await zipExtractorService.isZipFile(options.input);
    if (!isZip) {
      throw new Error('Input must be a ZIP file (output from hash command)');
    }

    // Extract the ZIP file
    logger.info('Extracting ZIP file...');
    extractedPath = await zipExtractorService.extractZip(options.input);
    tempRootDir = zipExtractorService.getTempRootDir(extractedPath);
    logger.technical(`Extracted to: ${extractedPath}`);

    // Validate the extracted structure
    const entries = await fsPromises.readdir(extractedPath, {
      withFileTypes: true,
    });

    // Determine if we need to go up one level
    // If the extracted path contains only JSON files (no subdirectories),
    // it means we're already inside a property directory
    const jsonFiles = entries.filter(
      (entry) => entry.isFile() && entry.name.endsWith('.json')
    );
    const subdirs = entries.filter((entry) => entry.isDirectory());

    let propertyDirs: Array<{ name: string; path: string }> = [];

    if (subdirs.length === 0 && jsonFiles.length > 0) {
      // We're inside a property directory already (single property case)
      // Use the parent directory name as the property name
      const propertyName = path.basename(extractedPath);
      propertyDirs = [{ name: propertyName, path: extractedPath }];
      logger.info(
        `Detected single property directory: ${propertyName} with ${jsonFiles.length} JSON files`
      );
    } else if (subdirs.length === 1) {
      // We have exactly one property directory
      propertyDirs = [
        {
          name: subdirs[0].name,
          path: path.join(extractedPath!, subdirs[0].name),
        },
      ];
      logger.info(`Found single property directory: ${subdirs[0].name}`);
    } else if (subdirs.length > 1) {
      // Multiple directories found - this is an error
      throw new Error(
        'Multiple property directories found. The upload command only supports single property data. Please use the hash command to process single property data first.'
      );
    } else {
      throw new Error(
        'No valid structure found in the extracted ZIP. Expected property directories with JSON files from hash command.'
      );
    }

    // Ensure we have exactly one property directory
    if (propertyDirs.length !== 1) {
      throw new Error(
        `Expected exactly one property directory, found ${propertyDirs.length}. The upload command only supports single property data.`
      );
    }

    // Initialize Pinata service
    const pinataService =
      serviceOverrides.pinataDirectoryUploadService ??
      new PinataDirectoryUploadService(options.pinataJwt!);

    // Initialize progress tracking
    if (!progressTracker) {
      progressTracker = new SimpleProgress(1, 'Uploading to IPFS');
    }
    progressTracker.start();

    // Upload the single property directory
    const uploadResults: Array<{
      propertyDir: string;
      success: boolean;
      cid?: string;
      error?: string;
    }> = [];

    for (const propertyDir of propertyDirs) {
      logger.info(`Uploading property directory: ${propertyDir.name}`);

      try {
        // Check if directory contains JSON files
        const propertyFiles = await fsPromises.readdir(propertyDir.path);
        const jsonFilesInDir = propertyFiles.filter((file) =>
          file.endsWith('.json')
        );

        if (jsonFilesInDir.length === 0) {
          logger.warn(
            `No JSON files found in ${propertyDir.name}, skipping...`
          );
          progressTracker.increment('skipped');
          continue;
        }

        logger.technical(
          `Uploading ${jsonFilesInDir.length} files from ${propertyDir.name}`
        );

        // Upload the directory to IPFS
        const uploadResult = await pinataService.uploadDirectory(
          propertyDir.path,
          {
            name: propertyDir.name,
            keyvalues: {
              source: 'elephant-cli-upload',
              propertyId: propertyDir.name,
            },
          }
        );

        if (uploadResult.success) {
          logger.success(
            `Successfully uploaded ${propertyDir.name} - CID: ${uploadResult.cid}`
          );
          uploadResults.push({
            propertyDir: propertyDir.name,
            success: true,
            cid: uploadResult.cid,
          });
          progressTracker.increment('processed');
        } else {
          logger.error(
            `Failed to upload ${propertyDir.name}: ${uploadResult.error}`
          );
          uploadResults.push({
            propertyDir: propertyDir.name,
            success: false,
            error: uploadResult.error,
          });
          progressTracker.increment('errors');
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.error(`Error uploading ${propertyDir.name}: ${errorMsg}`);
        uploadResults.push({
          propertyDir: propertyDir.name,
          success: false,
          error: errorMsg,
        });
        progressTracker.increment('errors');
      }
    }

    progressTracker.stop();

    // Generate CSV output in the same format as hash command
    if (options.outputCsv) {
      logger.info('Generating CSV report...');

      // CSV header matching hash command format
      const csvData: string[] = [
        'propertyCid,dataGroupCid,dataCid,filePath,uploadedAt',
      ];

      // Initialize schema manifest service for analyzing datagroup files
      const schemaManifestService =
        serviceOverrides.schemaManifestService ?? new SchemaManifestService();

      // Process each successfully uploaded directory
      for (const result of uploadResults) {
        if (result.success && result.cid) {
          try {
            // Find the corresponding property directory
            const propertyDir = propertyDirs.find(
              (p) => p.name === result.propertyDir
            );
            if (!propertyDir) continue;

            // Analyze the datagroup files in this directory
            const datagroupFiles = await analyzeDatagroupFiles(
              propertyDir.path,
              schemaManifestService
            );

            // Add a CSV row for each datagroup file
            const uploadTimestamp = new Date().toISOString();
            for (const dgFile of datagroupFiles) {
              csvData.push(
                `${result.propertyDir},${dgFile.dataGroupCid},${dgFile.dataCid},${dgFile.fileName},${uploadTimestamp}`
              );
            }

            if (datagroupFiles.length === 0) {
              logger.warn(`No datagroup files found in ${result.propertyDir}`);
            } else {
              logger.info(
                `Found ${datagroupFiles.length} datagroup files in ${result.propertyDir}`
              );
            }
          } catch (error) {
            logger.error(
              `Error analyzing datagroup files for ${result.propertyDir}: ${
                error instanceof Error ? error.message : String(error)
              }`
            );
          }
        }
      }

      await fsPromises.writeFile(
        options.outputCsv,
        csvData.join('\n'),
        'utf-8'
      );
      logger.success(`CSV results written to: ${options.outputCsv}`);
    }

    // Print summary
    const successful = uploadResults.filter((r) => r.success).length;
    const failed = uploadResults.filter((r) => !r.success).length;

    if (!isTestMode) {
      console.log(chalk.green('\n✅ Upload process finished\n'));
      console.log(chalk.bold('📊 Final Report:'));
      console.log(`  Total directories:    ${propertyDirs.length}`);
      console.log(`  Successfully uploaded: ${successful}`);
      console.log(`  Failed uploads:       ${failed}`);

      if (options.outputCsv) {
        console.log(`\n  Output CSV: ${options.outputCsv}`);
      }
    }

    // Print successful uploads with their CIDs
    if (successful > 0 && !isTestMode) {
      console.log(chalk.green('\n📦 Uploaded directories:'));
      uploadResults
        .filter((r) => r.success)
        .forEach((r) => {
          console.log(`  ${r.propertyDir}: ${chalk.cyan(r.cid)}`);
        });
    }

    // Cleanup temporary directory
    if (tempRootDir) {
      await zipExtractorService.cleanup(tempRootDir);
      logger.debug('Cleaned up temporary extraction directory');
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    if (!isTestMode) {
      console.error(chalk.red(`\n❌ Error: ${errorMessage}`));
    }

    if (progressTracker) {
      progressTracker.stop();
    }

    // Cleanup on error
    if (tempRootDir) {
      await zipExtractorService.cleanup(tempRootDir);
    }

    // In test mode, throw the error; otherwise exit
    if (isTestMode) {
      throw error;
    } else {
      process.exit(1);
    }
  }
}
