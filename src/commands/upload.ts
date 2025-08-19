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
import { isMediaFile } from '../utils/file-type-helpers.js';

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
      mediaCid?: string; // CID for HTML and image files
    }> = [];

    for (const propertyDir of propertyDirs) {
      logger.info(`Uploading property directory: ${propertyDir.name}`);

      try {
        // Check directory contents and separate JSON from media files
        const propertyFiles = await fsPromises.readdir(propertyDir.path, {
          withFileTypes: true,
        });

        const jsonFiles = propertyFiles
          .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
          .map((entry) => entry.name);

        const mediaFiles = propertyFiles
          .filter((entry) => entry.isFile() && isMediaFile(entry.name))
          .map((entry) => entry.name);

        if (jsonFiles.length === 0) {
          logger.warn(
            `No JSON files found in ${propertyDir.name}, skipping...`
          );
          progressTracker.increment('skipped');
          continue;
        }

        logger.technical(
          `Found ${jsonFiles.length} JSON files and ${mediaFiles.length} media files in ${propertyDir.name}`
        );

        // Create temporary directories for separate uploads
        const tempJsonDir = path.join(
          propertyDir.path,
          '..',
          `${propertyDir.name}_json_temp`
        );
        const tempMediaDir = path.join(
          propertyDir.path,
          '..',
          `${propertyDir.name}_media_temp`
        );

        let mediaCid: string | undefined;

        // Upload media files first if they exist
        if (mediaFiles.length > 0) {
          logger.info(`Uploading ${mediaFiles.length} media files...`);

          // Create temp directory for media files
          await fsPromises.mkdir(tempMediaDir, { recursive: true });

          // Copy media files to temp directory
          for (const mediaFile of mediaFiles) {
            const sourcePath = path.join(propertyDir.path, mediaFile);
            const destPath = path.join(tempMediaDir, mediaFile);
            await fsPromises.copyFile(sourcePath, destPath);
          }

          // Upload media directory to IPFS
          const mediaUploadResult = await pinataService.uploadDirectory(
            tempMediaDir,
            {
              name: `${propertyDir.name}_media`,
              keyvalues: {
                source: 'elephant-cli-upload-media',
                propertyId: propertyDir.name,
                type: 'media',
              },
            }
          );

          if (mediaUploadResult.success) {
            mediaCid = mediaUploadResult.cid;
            logger.success(
              `Successfully uploaded media files - CID: ${mediaCid}`
            );
          } else {
            logger.error(
              `Failed to upload media files: ${mediaUploadResult.error}`
            );
          }

          // Clean up temp media directory
          await fsPromises.rm(tempMediaDir, { recursive: true, force: true });
        }

        // Create temp directory for JSON files
        await fsPromises.mkdir(tempJsonDir, { recursive: true });

        // Copy JSON files to temp directory
        for (const jsonFile of jsonFiles) {
          const sourcePath = path.join(propertyDir.path, jsonFile);
          const destPath = path.join(tempJsonDir, jsonFile);
          await fsPromises.copyFile(sourcePath, destPath);
        }

        logger.technical(
          `Uploading ${jsonFiles.length} JSON files from ${propertyDir.name}`
        );

        // Upload the JSON directory to IPFS
        const uploadResult = await pinataService.uploadDirectory(tempJsonDir, {
          name: propertyDir.name,
          keyvalues: {
            source: 'elephant-cli-upload',
            propertyId: propertyDir.name,
            type: 'json',
          },
        });

        // Clean up temp JSON directory
        await fsPromises.rm(tempJsonDir, { recursive: true, force: true });

        if (uploadResult.success) {
          logger.success(
            `Successfully uploaded ${propertyDir.name} - CID: ${uploadResult.cid}`
          );
          uploadResults.push({
            propertyDir: propertyDir.name,
            success: true,
            cid: uploadResult.cid,
            mediaCid: mediaCid,
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
            mediaCid: mediaCid,
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

      // CSV header matching hash command format with htmlLink column
      const csvData: string[] = [
        'propertyCid,dataGroupCid,dataCid,filePath,uploadedAt,htmlLink',
      ];

      // Initialize schema manifest service for analyzing datagroup files (reuse if provided)
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
            const htmlLink = result.mediaCid ? `ipfs://${result.mediaCid}` : '';
            for (const dgFile of datagroupFiles) {
              csvData.push(
                `${result.propertyDir},${dgFile.dataGroupCid},${dgFile.dataCid},${dgFile.fileName},${uploadTimestamp},${htmlLink}`
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
