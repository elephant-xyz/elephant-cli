import { Command } from 'commander';
import chalk from 'chalk';
import { createSpinner } from '../../utils/progress.js';
import { logger } from '../../utils/logger.js';
import { prepare as prepareCore } from '../../lib/prepare.js';

export interface PrepareCommandOptions {
  outputZip: string;
  browser?: boolean;
}

export function registerPrepareCommand(program: Command) {
  program
    .command('prepare <inputZip>')
    .description(
      'Prepare data from transform output ZIP for further processing'
    )
    .requiredOption('--output-zip <path>', 'Output ZIP file path')
    .option('--no-browser', 'Disable headless browser functionality', false)
    .action(async (inputZip: string, options: PrepareCommandOptions) => {
      await handlePrepare(inputZip, options);
    });
}

export async function handlePrepare(
  inputZip: string,
  options: PrepareCommandOptions
) {
  console.log(chalk.bold.blue('🐘 Elephant Network CLI - Prepare'));
  console.log();

  const spinner = createSpinner(`Preparing data from ${inputZip}...`);
  await prepareCore(inputZip, options.outputZip, {
    browser: options.browser,
  });
  spinner.succeed('Prepared.');
  logger.success(`Output saved to: ${options.outputZip}`);
  console.log(chalk.green('✅ Prepare complete.'));
}
