import { Command } from 'commander';
import chalk from 'chalk';
import { CidHexConverterService } from '../services/cid-hex-converter.service.js';
import { logger } from '../utils/logger.js';

interface HexToCidOptions {
  validate?: boolean;
  quiet?: boolean;
}

export async function hexToCidHandler(
  hex: string,
  options: HexToCidOptions
): Promise<void> {
  try {
    const converter = new CidHexConverterService();

    // Validate if requested
    if (options.validate) {
      const validation = converter.validateHexFormat(hex);
      if (!validation.valid) {
        console.error(chalk.red(`✗ Invalid hex format: ${validation.error}`));
        process.exit(1);
      }
      if (!options.quiet) {
        console.log(chalk.green('✓ Valid hex format'));
      }
    }

    // Convert hex to CID
    const cid = converter.hexToCid(hex);

    // Output result
    if (options.quiet) {
      console.log(cid);
    } else {
      console.log(chalk.blue('CID:'), cid);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`hex-to-cid command failed: ${errorMessage}`);
    console.error(chalk.red(`Error: ${errorMessage}`));
    process.exit(1);
  }
}

export function registerHexToCidCommand(program: Command): void {
  program
    .command('hex-to-cid')
    .description('Convert Ethereum hex hash to CID v1 with raw codec')
    .argument('<hex>', 'Ethereum hex hash (with or without 0x prefix)')
    .option('-v, --validate', 'Validate the input format', false)
    .option(
      '-q, --quiet',
      'Output only the CID without additional information',
      false
    )
    .action(hexToCidHandler);
}
