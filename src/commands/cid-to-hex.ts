import { Command } from 'commander';
import chalk from 'chalk';
import { CidHexConverterService } from '../services/cid-hex-converter.service.js';
import { logger } from '../utils/logger.js';

interface CidToHexOptions {
  validate?: boolean;
  quiet?: boolean;
}

export async function cidToHexHandler(
  cid: string,
  options: CidToHexOptions
): Promise<void> {
  try {
    const converter = new CidHexConverterService();

    // Always validate first for consistent error messages
    const validation = converter.validateCidFormat(cid);
    if (!validation.valid) {
      const errorMessage = `Invalid CID format: ${validation.error}`;
      logger.error(`cid-to-hex command failed: ${errorMessage}`);
      console.error(chalk.red(`✗ ${errorMessage}`));
      process.exit(1);
    }

    if (options.validate && !options.quiet) {
      console.log(chalk.green('✓ Valid CID format'));
    }

    // The service's cidToHex method also validates, which is redundant but safe
    // This could be optimized in a future refactor
    const hex = converter.cidToHex(cid);

    // Output result
    if (options.quiet) {
      console.log(hex);
    } else {
      console.log(chalk.blue('Hex:'), hex);
    }
  } catch (error) {
    // This will now only catch unexpected errors during conversion itself,
    // as validation errors are handled above
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`cid-to-hex command failed: ${errorMessage}`);
    console.error(chalk.red(`Error: ${errorMessage}`));
    process.exit(1);
  }
}

export function registerCidToHexCommand(program: Command): void {
  program
    .command('cid-to-hex')
    .description('Convert CID v1 to Ethereum hex hash')
    .argument('<cid>', 'CID v1 string')
    .option('-v, --validate', 'Validate the CID format', false)
    .option(
      '-q, --quiet',
      'Output only the hex without additional information',
      false
    )
    .action(cidToHexHandler);
}
