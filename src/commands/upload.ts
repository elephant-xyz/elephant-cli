import { Command } from 'commander';
import { promises as fsPromises } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import chalk from 'chalk';
import { logger } from '../utils/logger.js';
import { ZipExtractorService } from '../services/zip-extractor.service.js';
import { PinataDirectoryUploadService } from '../services/pinata-directory-upload.service.js';
import { SimpleProgress } from '../utils/simple-progress.js';
import { SchemaManifestService } from '../services/schema-manifest.service.js';
import { isMediaFile } from '../utils/file-type-helpers.js';

export interface UploadCommandOptions {
  input: string;
  pinataJwt?: string;
  silent?: boolean;
  cwd?: string;
}

export function registerUploadCommand(program: Command) {
  program
    .command('upload <input>')
    .description(
      'Upload property data from the output of hash command to IPFS. The input should be a ZIP file containing property directories with CID-named JSON files. Supports single or multiple properties.'
    )
    .option(
      '--pinata-jwt <jwt>',
      'Pinata JWT for authentication. If not provided, uses PINATA_JWT environment variable.'
    )
    .action(async (input, options) => {
      const workingDir = options.cwd || process.cwd();
      const commandOptions: UploadCommandOptions = {
        ...options,
        input: path.resolve(workingDir, input),
        pinataJwt: options.pinataJwt || process.env.PINATA_JWT,
        cwd: workingDir,
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

async function createTempDir(prefix: string): Promise<string> {
  const base = path.join(tmpdir(), `${prefix}-`);
  await fsPromises.mkdir(base);
  return base;
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

  if (!isTestMode && !options.silent) {
    console.log(chalk.bold.blue('🐘 Elephant Network CLI - Upload to IPFS'));
    console.log();
  }

  const zipExtractorService =
    serviceOverrides.zipExtractorService ?? new ZipExtractorService();
  let extractedPath: string | null = null;
  let tempDir: string | null = null;
  let progressTracker = serviceOverrides.progressTracker;

  if (!options.pinataJwt) {
    throw new Error(
      'Pinata JWT is required. Provide it via --pinata-jwt option or PINATA_JWT environment variable.'
    );
  }

  try {
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
    } else if (subdirs.length >= 1) {
      propertyDirs = subdirs.map((dir) => ({
        name: dir.name,
        path: path.join(extractedPath!, dir.name),
      }));
      logger.info(
        `Found ${subdirs.length} property ${subdirs.length === 1 ? 'directory' : 'directories'}`
      );
    } else {
      throw new Error(
        'No valid structure found in the extracted ZIP. Expected property directories with JSON files from hash command.'
      );
    }

    // Initialize Pinata service
    const pinataService =
      serviceOverrides.pinataDirectoryUploadService ??
      new PinataDirectoryUploadService(options.pinataJwt!);

    // Initialize progress tracking
    if (!progressTracker) {
      progressTracker = new SimpleProgress(
        propertyDirs.length,
        'Uploading to IPFS'
      );
    }
    progressTracker.start();

    // Upload the property directory
    const uploadResults: Array<{
      propertyDir: string;
      success: boolean;
      cid?: string;
      error?: string;
    }> = [];

    // Create temp directory in OS temp dir for better reliability
    tempDir = await createTempDir('elephant-upload-');
    for (const propertyDir of propertyDirs) {
      logger.info(`Processing property directory: ${propertyDir.name}`);

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

        // Create property subdirectory in temp
        const tempPropertyDir = path.join(tempDir, propertyDir.name);
        await fsPromises.mkdir(tempPropertyDir, { recursive: true });

        // Handle media files if present
        if (mediaFiles.length > 0) {
          logger.info(`Copying ${mediaFiles.length} media files...`);
          const tempMediaDir = path.join(tempPropertyDir, 'media');
          await fsPromises.mkdir(tempMediaDir, { recursive: true });

          for (const mediaFile of mediaFiles) {
            const sourcePath = path.join(propertyDir.path, mediaFile);
            const destMediaPath = path.join(tempMediaDir, mediaFile);
            await fsPromises.copyFile(sourcePath, destMediaPath);
          }
        }

        // Handle JSON files
        const tempJsonDir = path.join(tempPropertyDir, 'json');
        await fsPromises.mkdir(tempJsonDir, { recursive: true });

        for (const jsonFile of jsonFiles) {
          const sourcePath = path.join(propertyDir.path, jsonFile);
          const destPath = path.join(tempJsonDir, jsonFile);
          await fsPromises.copyFile(sourcePath, destPath);
        }

        uploadResults.push({
          propertyDir: propertyDir.name,
          success: true,
        });
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.error(`Error processing ${propertyDir.name}: ${errorMsg}`);
        uploadResults.push({
          propertyDir: propertyDir.name,
          success: false,
          error: errorMsg,
        });
        progressTracker.increment('errors');
      }
    }

    // Check if there are any successful property preparations
    const successfulUploads = uploadResults.filter((r) => r.success);
    if (successfulUploads.length === 0) {
      progressTracker.stop();
      const errorMsg = 'No properties with JSON files to upload';
      logger.warn(errorMsg);

      if (options.silent) {
        return {
          success: false,
          error: errorMsg,
        };
      }

      if (!isTestMode) {
        console.log(chalk.yellow(`\n⚠️  ${errorMsg}\n`));
        process.exit(1);
      }

      throw new Error(errorMsg);
    }

    // Upload everything as one directory to IPFS
    logger.info('Uploading directory structure to IPFS...');
    const uploadResult = await pinataService.uploadDirectory(tempDir, {
      name: 'elephant-upload',
      keyvalues: {
        source: 'elephant-cli-upload',
        timestamp: new Date().toISOString(),
      },
    });

    if (uploadResult.success) {
      logger.success(
        `Successfully uploaded to IPFS - CID: ${uploadResult.cid}`
      );

      for (const result of uploadResults) {
        if (result.success) {
          result.cid = uploadResult.cid;
          progressTracker.increment('processed');
        }
      }

      progressTracker.stop();

      // Print clean summary
      if (!isTestMode && !options.silent) {
        console.log(chalk.green('\n✅ Upload completed successfully\n'));
        console.log(chalk.bold('Upload Summary:'));
        console.log(`  Root CID: ${uploadResult.cid}`);
        console.log(`  Properties: ${propertyDirs.length}`);
        console.log(`  IPFS Gateway: https://ipfs.io/ipfs/${uploadResult.cid}`);
        console.log();
      }

      return {
        success: true,
        cid: uploadResult.cid,
      };
    }

    throw new Error(uploadResult.error || 'Upload failed');
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to upload to IPFS: ${errorMsg}`);

    if (progressTracker) {
      progressTracker.stop();
    }

    if (options.silent) {
      return {
        success: false,
        error: errorMsg,
      };
    }

    if (!isTestMode) {
      console.log(chalk.red(`\n❌ Upload failed: ${errorMsg}\n`));
      process.exit(1);
    }

    throw error;
  } finally {
    // Clean up temp directory for upload staging
    if (tempDir) {
      try {
        await fsPromises.rm(tempDir, { recursive: true, force: true });
      } catch (err) {
        logger.debug(
          `Failed to cleanup temp directory: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    // Clean up extracted ZIP directory
    if (extractedPath) {
      const tempRootDir = zipExtractorService.getTempRootDir(extractedPath);
      if (tempRootDir) {
        try {
          await zipExtractorService.cleanup(tempRootDir);
        } catch (err) {
          logger.debug(
            `Failed to cleanup extracted directory: ${err instanceof Error ? err.message : String(err)}`
          );
        }
      }
    }
  }
}
