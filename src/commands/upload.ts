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
import { importCar } from '../services/car-import.service.js';

export interface UploadCommandOptions {
  input: string;
  pinataJwt?: string;
  silent?: boolean;
  cwd?: string;
  /** CAR options, used only when `input` is a `.car` file. */
  api?: string;
  token?: string;
  gateway?: string;
  timeout?: number;
  outputJson?: string;
}

/** Filebase's Kubo RPC token is `base64(access key:secret key:bucket)`. */
function filebaseToken(env: NodeJS.ProcessEnv): string | undefined {
  const parts = [
    env.FILEBASE_ACCESS_KEY,
    env.FILEBASE_SECRET_KEY,
    env.FILEBASE_BUCKET,
  ];
  return parts.every(Boolean)
    ? Buffer.from(parts.join(':')).toString('base64')
    : undefined;
}

export function isCarInput(input: string): boolean {
  return input.toLowerCase().endsWith('.car');
}

export function registerUploadCommand(program: Command) {
  program
    .command('upload <input>')
    .description(
      'Upload property data from the output of hash command to IPFS. A ZIP of property directories with CID-named JSON files is uploaded to Pinata; a .car file from hash --output-car is imported through a Kubo RPC API (local kubo, Filebase, ...) and its root read back from the gateway.'
    )
    .option(
      '--pinata-jwt <jwt>',
      'Pinata JWT for authentication. If not provided, uses PINATA_JWT environment variable.'
    )
    .option(
      '--api <url>',
      'Kubo RPC API for a .car input. If not provided, uses IPFS_API environment variable or http://127.0.0.1:5001.'
    )
    .option(
      '--token <bearer>',
      'Bearer token for the API. If not provided, uses IPFS_API_TOKEN, or composes the Filebase token from FILEBASE_ACCESS_KEY, FILEBASE_SECRET_KEY and FILEBASE_BUCKET.'
    )
    .option(
      '--gateway <url>',
      'IPFS gateway used to read the CAR root back. If not provided, uses IPFS_GATEWAY; defaults to https://ipfs.filebase.io for rpc.filebase.io, otherwise http://127.0.0.1:8080.'
    )
    .option(
      '--timeout <seconds>',
      'Seconds to wait for the CAR root to resolve on the gateway.',
      '300'
    )
    .option(
      '--output-json <path>',
      'Write the CAR upload summary (api, root, blocks, gateway URL) as JSON.'
    )
    .action(async (input, options) => {
      const workingDir = options.cwd || process.cwd();
      const commandOptions: UploadCommandOptions = {
        ...options,
        input: path.resolve(workingDir, input),
        pinataJwt: options.pinataJwt || process.env.PINATA_JWT,
        timeout: Number(options.timeout),
        cwd: workingDir,
      };

      if (!isCarInput(commandOptions.input) && !commandOptions.pinataJwt) {
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
  const tempDir = await fsPromises.mkdtemp(path.join(tmpdir(), prefix));
  return tempDir;
}

export interface UploadServiceOverrides {
  zipExtractorService?: ZipExtractorService;
  pinataDirectoryUploadService?: PinataDirectoryUploadService;
  progressTracker?: SimpleProgress;
  schemaManifestService?: SchemaManifestService;
}

/** `.car` input: one `dag/import` through the Kubo RPC API, then read the root back from the gateway. */
async function handleCarUpload(options: UploadCommandOptions) {
  const result = await importCar({
    input: options.input,
    api: options.api || process.env.IPFS_API,
    token:
      options.token || process.env.IPFS_API_TOKEN || filebaseToken(process.env),
    gateway: options.gateway || process.env.IPFS_GATEWAY,
    timeout: options.timeout,
  }).catch((error: unknown) =>
    error instanceof Error ? error : new Error(String(error))
  );

  if (result instanceof Error) {
    logger.error(`Failed to upload CAR: ${result.message}`);
    if (options.silent) {
      return { success: false, error: result.message };
    }
    console.log(chalk.red(`\n❌ Upload failed: ${result.message}\n`));
    process.exit(1);
  }

  if (options.outputJson) {
    await fsPromises.writeFile(
      path.resolve(options.cwd || process.cwd(), options.outputJson),
      JSON.stringify(result, null, 2)
    );
  }
  if (!options.silent) {
    console.log(chalk.green('\n✅ Upload completed successfully\n'));
    console.log(chalk.bold('Upload Summary:'));
    for (const [name, value] of Object.entries(result)) {
      console.log(`  ${name}: ${value}`);
    }
    console.log();
  }
  return { success: true, cid: result.root, ...result };
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

  if (isCarInput(options.input)) {
    return handleCarUpload(options);
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
    // console.log(entries);

    // Determine if we need to go up one level
    // If the extracted path contains only JSON files (no subdirectories),
    // it means we're already inside a property directory
    const jsonFiles = entries.filter(
      (entry) => entry.isFile() && entry.name.endsWith('.json')
    );
    const subdirs = entries.filter((entry) => entry.isDirectory());
    // console.log(subdirs);

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
    const preUpload: Array<{
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
          recursive: true,
        });
        // console.log(propertyFiles);

        const jsonFiles = propertyFiles.filter(
          (entry) => entry.isFile() && entry.name.endsWith('.json')
        );

        const mediaFiles = propertyFiles.filter(
          (entry) => entry.isFile() && isMediaFile(entry.name)
        );

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
            mediaFile.parentPath;
            const sourcePath = path.join(mediaFile.parentPath, mediaFile.name);
            const destMediaPath = path.join(tempMediaDir, mediaFile.name);
            await fsPromises.copyFile(sourcePath, destMediaPath);
          }
        }

        // Handle JSON files
        const tempJsonDir = path.join(tempPropertyDir, 'json');
        await fsPromises.mkdir(tempJsonDir, { recursive: true });

        for (const jsonFile of jsonFiles) {
          const sourcePath = path.join(jsonFile.parentPath, jsonFile.name);
          const destPath = path.join(tempJsonDir, jsonFile.name);
          await fsPromises.copyFile(sourcePath, destPath);
        }

        preUpload.push({
          propertyDir: propertyDir.name,
          success: true,
        });
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.error(`Error processing ${propertyDir.name}: ${errorMsg}`);
        preUpload.push({
          propertyDir: propertyDir.name,
          success: false,
          error: errorMsg,
        });
        progressTracker.increment('errors');
      }
    }

    // Check if there are any successful property preparations
    const failedPreps = preUpload.filter((r) => !r.success);
    const successfulPreps = preUpload.filter((r) => r.success);
    if (failedPreps.length > 0 || successfulPreps.length === 0) {
      progressTracker.stop();
      const errorMsg =
        failedPreps.length > 0
          ? 'Upload preparation failed'
          : 'No properties with JSON files to upload';
      logger.warn(errorMsg);

      if (options.silent) {
        return {
          success: false,
          error: errorMsg,
          errors: failedPreps.length > 0 ? failedPreps : undefined,
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

      for (const result of preUpload) {
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
