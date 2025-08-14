import { Command } from 'commander';
import { existsSync, promises as fsPromises } from 'fs';
import path from 'path';
import chalk from 'chalk';
import { execSync } from 'child_process';
import { tmpdir } from 'os';
import AdmZip from 'adm-zip';
import { logger } from '../utils/logger.js';
import {
  checkFactSheetInstalled,
  installOrUpdateFactSheet,
  generateHTMLFiles,
} from '../utils/fact-sheet.js';
import { ZipExtractorService } from '../services/zip-extractor.service.js';

export interface TransformCommandOptions {
  outputZip?: string;
  [key: string]: any; // Allow any other arguments to be passed through
}

export function registerTransformCommand(program: Command) {
  program
    .command('transform')
    .description(
      'Transform property data to Lexicon schema-valid format and generate HTML presentation'
    .description('Transform property data to Lexicon schema-valid format and generate HTML presentation')
    .allowUnknownOption() // Allow any arguments to be passed through to AI-agent
    .option(
      '--output-zip <path>',
      'Output ZIP file path',
      'transformed-data.zip'
    )
    .action(async (options) => {
      await handleTransform(options);
    });
}

export async function handleTransform(options: TransformCommandOptions) {
  console.log(chalk.bold.blue('🐘 Elephant Network CLI - Transform'));
  console.log();

  const zipExtractor = new ZipExtractorService();
  const tempDirs: string[] = [];

  try {
    // Step 1: Run AI-agent transformer
    logger.info('Step 1: Running AI-agent transformer...');

    // Build the command for AI-agent
    const outputZip = options.outputZip || 'transformed-data.zip';
    const aiAgentCmd = buildAIAgentCommand(options, outputZip);

    logger.debug(`Running command: ${aiAgentCmd}`);

    try {
      execSync(aiAgentCmd, {
        encoding: 'utf8',
        cwd: process.cwd(),
        stdio: ['inherit', 'pipe', 'pipe'], // Suppress stdout, keep stderr
      });
      logger.success('AI-agent transformer completed successfully');
    } catch (execError) {
      logger.error('AI-agent transformer failed');
      throw execError;
    }

    // Verify the output ZIP was created
    if (!existsSync(outputZip)) {
      throw new Error(`Expected output ZIP file not found: ${outputZip}`);
    }

    // Step 2: Generate HTML files using fact-sheet-template
    logger.info('Step 2: Generating HTML files...');

    // Install or update fact-sheet tool
    logger.info('Checking fact-sheet installation...');

    // Check if curl is available
    try {
      execSync('which curl', { stdio: 'pipe' });
      logger.debug('curl is available');
    } catch {
      logger.error(
        'curl is not available. Please install curl to use HTML generation feature.'
      );
      throw new Error(
        'curl is required for fact-sheet installation but was not found'
      );
    }

    try {
      await installOrUpdateFactSheet();
    } catch (installError) {
      logger.warn(
        'Failed to install/update fact-sheet tool, but will attempt to continue with existing version if available'
      );

      const isInstalled = await checkFactSheetInstalled();
      if (!isInstalled) {
        throw new Error(
          'fact-sheet tool is not installed and installation failed'
        );
      }
      logger.info('Using existing fact-sheet installation');
    }

    // Extract the transformed data ZIP
    logger.info('Extracting transformed data...');
    const extractedDir = await zipExtractor.extractZip(outputZip);
    tempDirs.push(extractedDir);

    // The extractZip method returns either:
    // 1. The path to a single directory if the ZIP contains only one directory
    // 2. The temp directory itself if the ZIP has multiple items at root

    // Check if we're already in the property directory (case 1)
    // or if we need to find it (case 2)
    let propertyPath: string;
    let propertyDirName: string;

    const entries = await fsPromises.readdir(extractedDir, {
      withFileTypes: true,
    });

    // Check if the extracted directory itself contains the property files
    const hasJsonFiles = entries.some(
      (entry) => entry.isFile() && entry.name.endsWith('.json')
    );

    if (hasJsonFiles) {
      // The extracted directory IS the property directory
      propertyPath = extractedDir;
      // Extract the directory name from the path
      propertyDirName = path.basename(extractedDir);
      logger.debug(
        `Using extracted directory as property directory: ${propertyPath}`
      );
    } else {
      // Look for a subdirectory containing the property files
      const propertyDirs = entries.filter((entry) => entry.isDirectory());
      if (propertyDirs.length === 0) {
        throw new Error('No property directory found in transformed data ZIP');
      }

      propertyDirName = propertyDirs[0].name;
      propertyPath = path.join(extractedDir, propertyDirName);
      logger.debug(`Found property directory: ${propertyPath}`);
    }

    // Create a temporary directory structure for fact-sheet-template
    // It expects multiple property directories, but we only have one
    const tempInputBase = path.join(tmpdir(), 'elephant-cli-transform-input-');
    const tempInputDir = await fsPromises.mkdtemp(tempInputBase);
    tempDirs.push(tempInputDir);

    // Copy the property directory to the temporary input directory
    const targetPropertyPath = path.join(tempInputDir, propertyDirName);
    await copyDirectory(propertyPath, targetPropertyPath);

    logger.debug(`Prepared input directory for fact-sheet: ${tempInputDir}`);

    // Generate HTML files
    const htmlOutputDir = path.join(tmpdir(), 'generated-htmls');
    tempDirs.push(htmlOutputDir);

    await generateHTMLFiles(tempInputDir, htmlOutputDir);

    // Step 3: Merge HTML files with JSON data and create the final ZIP
    logger.info('Merging HTML files with transformed data...');

    // The fact-sheet tool creates a subdirectory with the property name inside htmlOutputDir
    // We need to find that subdirectory and copy its contents (not the directory itself)
    const htmlEntries = await fsPromises.readdir(htmlOutputDir, {
      withFileTypes: true,
    });

    // Check if there's a single directory that matches our property name pattern
    const propertySubDirs = htmlEntries.filter((entry) => entry.isDirectory());

    if (propertySubDirs.length === 1) {
      // The HTML files are in a subdirectory - copy the contents of that subdirectory
      const htmlPropertyDir = path.join(htmlOutputDir, propertySubDirs[0].name);
      const htmlPropertyEntries = await fsPromises.readdir(htmlPropertyDir, {
        withFileTypes: true,
      });

      logger.debug(
        `Found HTML files in subdirectory: ${propertySubDirs[0].name}`
      );

      // Copy all files from the HTML property subdirectory to the property directory
      for (const entry of htmlPropertyEntries) {
        const srcPath = path.join(htmlPropertyDir, entry.name);
        const destPath = path.join(propertyPath, entry.name);

        if (entry.isFile()) {
          await fsPromises.copyFile(srcPath, destPath);
          logger.debug(`Copied ${entry.name} to property directory`);
        } else if (entry.isDirectory()) {
          await copyDirectory(srcPath, destPath);
          logger.debug(`Copied directory ${entry.name} to property directory`);
        }
      }
    } else {
      // Fallback: copy files directly from htmlOutputDir if no subdirectory structure
      for (const entry of htmlEntries) {
        if (entry.isFile()) {
          const srcFile = path.join(htmlOutputDir, entry.name);
          const destFile = path.join(propertyPath, entry.name);
          await fsPromises.copyFile(srcFile, destFile);
          logger.debug(`Copied ${entry.name} to property directory`);
        }
      }
    }

    // Step 4: Create the final ZIP archive
    logger.info('Creating final output ZIP...');

    // Create a new ZIP file
    const finalZip = new AdmZip();

    // Add the merged directory (property directory with both JSON and HTML files)
    finalZip.addLocalFolder(propertyPath, propertyDirName);

    // Write the final ZIP
    finalZip.writeZip(outputZip);

    logger.success(`Transformation complete! Output saved to: ${outputZip}`);
    console.log();
    console.log(chalk.green('✅ Transform process finished'));
    console.log(chalk.bold('📊 Output:'));
    console.log(`  Transformed data with HTML: ${chalk.cyan(outputZip)}`);
    console.log();
    console.log(chalk.gray('The output ZIP contains:'));
    console.log(
      chalk.gray(
        `  - ${propertyDirName}/ (transformed data with HTML fact sheets)`
      )
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(chalk.red(`Error during transform: ${errorMessage}`));
    if (error instanceof Error && error.stack) {
      logger.debug(error.stack);
    }
    process.exit(1);
  } finally {
    // Clean up temporary directories
    for (const tempDir of tempDirs) {
      try {
        if (existsSync(tempDir)) {
          await fsPromises.rm(tempDir, { recursive: true, force: true });
          logger.debug(`Cleaned up temporary directory: ${tempDir}`);
        }
      } catch (cleanupError) {
        logger.debug(
          `Failed to clean up temporary directory ${tempDir}: ${
            cleanupError instanceof Error
              ? cleanupError.message
              : String(cleanupError)
          }`
        );
      }
    }
  }
}

function buildAIAgentCommand(
  options: TransformCommandOptions,
  outputZip: string
): string {
  // Base command
  let cmd =
    'uvx --from git+https://github.com/elephant-xyz/AI-Agent test-evaluator-agent --transform';

  // Add all the options passed by the user, except our own output-zip
  for (const [key, value] of Object.entries(options)) {
    if (key === 'outputZip') {
      // Skip our own option
      continue;
    }

    // Convert camelCase to kebab-case for CLI arguments
    const argName = key.replace(/([A-Z])/g, '-$1').toLowerCase();

    if (typeof value === 'boolean') {
      if (value) {
        cmd += ` --${argName}`;
      }
    } else if (value !== undefined && value !== null) {
      cmd += ` --${argName} "${value}"`;
    }
  }

  // Always add the output-zip argument
  cmd += ` --output-zip "${outputZip}"`;

  // Handle any remaining arguments that were passed directly
  const args = process.argv.slice(3); // Skip 'node', 'elephant-cli', and 'transform'
  const outputZipIndex = args.findIndex((arg) => arg === '--output-zip');

  // Add any arguments that weren't already processed
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    // Skip --output-zip and its value as we handle it separately
    if (i === outputZipIndex || i === outputZipIndex + 1) {
      continue;
    }

    // Check if this argument was already added via options
    const cleanArg = arg.replace(/^--/, '').replace(/-/g, '');
    const inOptions = Object.keys(options).some(
      (key) => key.toLowerCase().replace(/-/g, '') === cleanArg.toLowerCase()
    );

    if (!inOptions && arg.startsWith('--')) {
      // This is an unknown option that should be passed to AI-agent
      cmd += ` ${arg}`;
      // Check if the next item is a value for this option
      if (i + 1 < args.length && !args[i + 1].startsWith('--')) {
        cmd += ` "${args[i + 1]}"`;
        i++; // Skip the value in the next iteration
      }
    } else if (!inOptions && !arg.startsWith('--')) {
      // This might be a positional argument
      cmd += ` "${arg}"`;
    }
  }

  return cmd;
}

async function copyDirectory(src: string, dest: string): Promise<void> {
  await fsPromises.mkdir(dest, { recursive: true });

  const entries = await fsPromises.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      await copyDirectory(srcPath, destPath);
    } else {
      await fsPromises.copyFile(srcPath, destPath);
    }
  }
}
