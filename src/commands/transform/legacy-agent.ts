import { existsSync, promises as fsPromises } from 'fs';
import path from 'path';
import chalk from 'chalk';
import { execSync } from 'child_process';
import { tmpdir } from 'os';
import AdmZip from 'adm-zip';
import { logger } from '../../utils/logger.js';
import {
  checkFactSheetInstalled,
  installOrUpdateFactSheet,
  generateHTMLFiles,
} from '../../utils/fact-sheet.js';
import { runAIAgent } from '../../utils/ai-agent.js';
import { ZipExtractorService } from '../../services/zip-extractor.service.js';
import { FactSheetRelationshipService } from '../../services/fact-sheet-relationship.service.js';
import { SchemaManifestService } from '../../services/schema-manifest.service.js';

export interface LegacyTransformOptions {
  outputZip?: string;
  [key: string]: any;
}

export async function handleLegacyTransform(options: LegacyTransformOptions) {
  const zipExtractor = new ZipExtractorService();
  const tempDirs: string[] = [];

  try {
    logger.info('Step 1: Running AI-agent transformer...');

    const outputZip = options.outputZip || 'transformed-data.zip';
    const aiAgentArgs = buildAIAgentArgs(options, outputZip);

    try {
      const exitCode = runAIAgent(aiAgentArgs);
      if (exitCode !== 0) {
        throw new Error(`AI-agent exited with code ${exitCode}`);
      }
      logger.success('AI-agent transformer completed successfully');
    } catch (execError) {
      logger.error('AI-agent transformer failed');
      throw execError;
    }

    if (!existsSync(outputZip)) {
      throw new Error(`Expected output ZIP file not found: ${outputZip}`);
    }

    logger.info('Step 2: Generating HTML files...');

    logger.info('Checking fact-sheet installation...');

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

    logger.info('Extracting transformed data...');
    const extractedDir = await zipExtractor.extractZip(outputZip);
    tempDirs.push(extractedDir);

    let propertyPath: string;
    let propertyDirName: string;

    const entries = await fsPromises.readdir(extractedDir, {
      withFileTypes: true,
    });

    const hasJsonFiles = entries.some(
      (entry) => entry.isFile() && entry.name.endsWith('.json')
    );

    if (hasJsonFiles) {
      propertyPath = extractedDir;
      propertyDirName = path.basename(extractedDir);
      logger.debug(
        `Using extracted directory as property directory: ${propertyPath}`
      );
    } else {
      const propertyDirs = entries.filter((entry) => entry.isDirectory());
      if (propertyDirs.length === 0) {
        throw new Error('No property directory found in transformed data ZIP');
      }

      propertyDirName = propertyDirs[0].name;
      propertyPath = path.join(extractedDir, propertyDirName);
      logger.debug(`Found property directory: ${propertyPath}`);
    }

    const tempInputBase = path.join(tmpdir(), 'elephant-cli-transform-input-');
    const tempInputDir = await fsPromises.mkdtemp(tempInputBase);
    tempDirs.push(tempInputDir);

    const targetPropertyPath = path.join(tempInputDir, propertyDirName);
    await copyDirectory(propertyPath, targetPropertyPath);

    logger.debug(`Prepared input directory for fact-sheet: ${tempInputDir}`);

    const htmlOutputDir = path.join(tmpdir(), 'generated-htmls');
    tempDirs.push(htmlOutputDir);

    await generateHTMLFiles(tempInputDir, htmlOutputDir);

    logger.info('Step 3: Merging HTML files with transformed data...');

    const htmlEntries = await fsPromises.readdir(htmlOutputDir, {
      withFileTypes: true,
    });

    const propertySubDirs = htmlEntries.filter((entry) => entry.isDirectory());

    if (propertySubDirs.length === 1) {
      const htmlPropertyDir = path.join(htmlOutputDir, propertySubDirs[0].name);
      const htmlPropertyEntries = await fsPromises.readdir(htmlPropertyDir, {
        withFileTypes: true,
      });

      logger.debug(
        `Found HTML files in subdirectory: ${propertySubDirs[0].name}`
      );

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
      for (const entry of htmlEntries) {
        if (entry.isFile()) {
          const srcFile = path.join(htmlOutputDir, entry.name);
          const destFile = path.join(propertyPath, entry.name);
          await fsPromises.copyFile(srcFile, destFile);
          logger.debug(`Copied ${entry.name} to property directory`);
        }
      }
    }

    logger.info('Step 4: Generating fact_sheet relationships...');

    try {
      const schemaManifestService = new SchemaManifestService();
      const factSheetRelationshipService = new FactSheetRelationshipService(
        schemaManifestService
      );

      await factSheetRelationshipService.generateFactSheetRelationships(
        propertyPath
      );

      logger.success('Successfully generated fact_sheet relationships');
    } catch (error) {
      logger.error(
        `Failed to generate fact_sheet relationships: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      logger.warn('Continuing without fact_sheet relationships');
    }

    logger.info('Step 5: Creating final output ZIP...');

    const finalZip = new AdmZip();
    finalZip.addLocalFolder(propertyPath, propertyDirName);
    finalZip.writeZip(outputZip);

    logger.success(`Transformation complete! Output saved to: ${outputZip}`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(chalk.red(`Error during transform: ${errorMessage}`));
    if (error instanceof Error && error.stack) {
      logger.debug(error.stack);
    }
    process.exit(1);
  } finally {
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

function buildAIAgentArgs(
  options: LegacyTransformOptions,
  outputZip: string
): string[] {
  const args: string[] = ['--transform'];

  for (const [key, value] of Object.entries(options)) {
    if (key === 'outputZip') continue;
    if (key === 'legacyMode') continue;
    const argName = key.replace(/([A-Z])/g, '-$1').toLowerCase();
    if (typeof value === 'boolean') {
      if (value) args.push(`--${argName}`);
    } else if (value !== undefined && value !== null) {
      args.push(`--${argName}`, String(value));
    }
  }

  args.push('--output-zip', outputZip);

  const processArgs = process.argv.slice(3);
  const outputZipIndex = processArgs.findIndex((arg) => arg === '--output-zip');
  for (let i = 0; i < processArgs.length; i++) {
    const arg = processArgs[i];
    if (i === outputZipIndex || i === outputZipIndex + 1) continue;
    const cleanArg = arg.replace(/^--/, '').replace(/-/g, '');
    const inOptions = Object.keys(options).some(
      (key) => key.toLowerCase().replace(/-/g, '') === cleanArg.toLowerCase()
    );
    if (!inOptions && arg.startsWith('--')) {
      args.push(arg);
      if (i + 1 < processArgs.length && !processArgs[i + 1].startsWith('--')) {
        args.push(processArgs[i + 1]);
        i++;
      }
    } else if (!inOptions && !arg.startsWith('--')) {
      args.push(arg);
    }
  }

  return args;
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
