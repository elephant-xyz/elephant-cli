import { Command } from 'commander';
import chalk from 'chalk';
import { createSpinner } from '../../utils/progress.js';
import { logger } from '../../utils/logger.js';
import { prepare as prepareCore } from '../../lib/prepare.js';

export interface PrepareCommandOptions {
  outputZip: string;
  browser?: boolean;
  /** When false, skip clicking any Continue button in browser mode */
  continue?: boolean;
  // fast kept for backward-compat (not exposed directly); use --no-fast to disable
  fast?: boolean;
  useBrowser?: boolean;
}

export function registerPrepareCommand(program: Command) {
  program
    .command('prepare <inputZip>')
    .description(
      'Prepare data from transform output ZIP for further processing'
    )
    .requiredOption('--output-zip <path>', 'Output ZIP file path')
    .option('--use-browser', 'Force headless browser functionality')
    .option('--no-continue', 'Do not click any Continue modal in browser mode')
    .option(
      '--no-fast',
      'Disable fast browser mode (lighter waits, blocked assets)'
    )
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
    clickContinue: options['continue'],
    fast: options.fast,
    // pass through positive flag separately
    // (core will decide precedence & defaults)
    useBrowser: options.useBrowser,
  });
  spinner.succeed('Prepared.');
  logger.success(`Output saved to: ${options.outputZip}`);
  console.log(chalk.green('✅ Prepare complete.'));
}
