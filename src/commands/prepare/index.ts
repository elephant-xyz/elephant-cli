import { Command } from 'commander';
import chalk from 'chalk';
import { createSpinner } from '../../utils/progress.js';
import { logger } from '../../utils/logger.js';
import { prepare as prepareCore } from '../../lib/prepare.js';
import { ProxyUrl } from '../../lib/types.js';

export interface PrepareCommandOptions {
  outputZip: string;
  /** When false, skip clicking any Continue button in browser mode */
  continue?: boolean;
  /** CSS selector for a continue/agree button to click automatically */
  continueButton?: string;
  useBrowser?: boolean;
  headless?: boolean;
  browserFlowTemplate?: string;
  browserFlowParameters?: string;
  browserFlowFile?: string;
  ignoreCaptcha?: boolean;
  proxy?: ProxyUrl;
  multiRequestFlowFile?: string;
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
      '--continue-button <selector>',
      'CSS selector for a continue/agree button to click automatically'
    )
    .option('--no-headless', 'Disable headless browser mode')
    .option(
      '--browser-flow-template <template>',
      'Browser flow template name (e.g., SEARCH_BY_PARCEL_ID)'
    )
    .option(
      '--browser-flow-parameters <json>',
      'JSON parameters for the browser flow template'
    )
    .option(
      '--browser-flow-file <path>',
      'Path to custom browser flow JSON file (takes precedence over template)'
    )
    .option(
      '--ignore-captcha',
      'Proceed even if a CAPTCHA is detected and not affecting page content, capturing the current page content.'
    )
    .option(
      '--proxy <url>',
      'Proxy URL to use for headless browser with auth derails (e.g., username:password@ip:port)'
    )
    .option(
      '--multi-request-flow-file <path>',
      'Path to JSON file defining a multi-request flow (sequence of HTTP requests)'
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
    clickContinue: options['continue'],
    continueButtonSelector: options.continueButton,
    useBrowser: options.useBrowser,
    headless: options.headless,
    browserFlowTemplate: options.browserFlowTemplate,
    browserFlowParameters: options.browserFlowParameters,
    browserFlowFile: options.browserFlowFile,
    ignoreCaptcha: options.ignoreCaptcha,
    proxy: options.proxy,
    multiRequestFlowFile: options.multiRequestFlowFile,
  });
  spinner.succeed('Prepared.');
  logger.success(`Output saved to: ${options.outputZip}`);
  console.log(chalk.green('✅ Prepare complete.'));
}
