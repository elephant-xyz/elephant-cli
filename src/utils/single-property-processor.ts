import { promises as fsPromises } from 'fs';
import path from 'path';
import { logger } from './logger.js';
import { ZipExtractorService } from '../services/zip-extractor.service.js';
import chalk from 'chalk';

export interface SinglePropertyInput {
  inputPath: string;
  requireZip: boolean;
}

export interface ProcessedSinglePropertyInput {
  actualInputDir: string;
  tempDir: string | null;
  cleanup: () => Promise<void>;
}

/**
 * Process input for single property commands (validate and hash).
 * Ensures the input is a ZIP file containing data for a single property.
 *
 * @param input - The input configuration
 * @returns Processed input information including cleanup function
 */
export async function processSinglePropertyInput(
  input: SinglePropertyInput
): Promise<ProcessedSinglePropertyInput> {
  const zipExtractor = new ZipExtractorService();
  let actualInputDir = input.inputPath;
  let tempDir: string | null = null;

  try {
    // Check if input exists and get stats
    const stats = await fsPromises.stat(input.inputPath);

    if (!stats.isFile()) {
      const errorMsg = 'Input must be a ZIP file, not a directory';
      console.error(chalk.red(`❌ Error: ${errorMsg}`));
      console.error(
        chalk.yellow(
          'This command only accepts ZIP archives containing single property data.'
        )
      );
      throw new Error(errorMsg);
    }

    // Validate that it's a ZIP file
    const isZip = await zipExtractor.isZipFile(input.inputPath);
    if (!isZip) {
      const errorMsg = 'Input must be a valid ZIP file';
      console.error(chalk.red(`❌ Error: ${errorMsg}`));
      console.error(
        chalk.yellow(
          'This command only accepts ZIP archives containing single property data.'
        )
      );
      throw new Error(errorMsg);
    }

    // Extract the ZIP file
    logger.info(`Processing single property ZIP file: ${input.inputPath}`);
    const extractedDir = await zipExtractor.extractZip(input.inputPath);
    tempDir = zipExtractor.getTempRootDir(extractedDir);
    logger.info(`Extracted single property data to temporary directory`);

    // Verify the extracted directory exists
    const extractedStats = await fsPromises.stat(extractedDir);
    if (!extractedStats.isDirectory()) {
      throw new Error(`Extracted path ${extractedDir} is not a directory`);
    }

    // Look for the single property directory inside the extracted content
    const entries = await fsPromises.readdir(extractedDir, {
      withFileTypes: true,
    });
    const directories = entries.filter((entry) => entry.isDirectory());

    if (directories.length === 0) {
      // No subdirectories - the extracted content IS the property directory
      actualInputDir = extractedDir;
      logger.debug('Using extracted root as property directory');
    } else if (directories.length === 1) {
      // Single subdirectory - this should be the property directory
      actualInputDir = path.join(extractedDir, directories[0].name);
      logger.debug(
        `Using single subdirectory as property directory: ${directories[0].name}`
      );
    } else {
      throw new Error(
        `Expected single property data, but found ${directories.length} directories. ` +
          'Single property ZIP should contain files directly or within a single property directory.'
      );
    }

    // Return the processed input with cleanup function
    return {
      actualInputDir,
      tempDir,
      cleanup: async () => {
        if (tempDir) {
          await zipExtractor.cleanup(tempDir);
          logger.debug('Cleaned up temporary directory');
        }
      },
    };
  } catch (error) {
    // Clean up on error
    if (tempDir) {
      await zipExtractor.cleanup(tempDir);
    }

    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to process ZIP input: ${errorMsg}`);
    throw error;
  }
}

/**
 * Helper to validate data group schema structure
 */
export function validateDataGroupSchema(schema: any): {
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
