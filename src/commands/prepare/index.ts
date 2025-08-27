import { Command } from 'commander';
import chalk from 'chalk';
import { createSpinner } from '../../utils/progress.js';
import { logger } from '../../utils/logger.js';
import { tmpdir } from 'os';
import { promises as fs } from 'fs';
import path from 'path';
import { extractZipToTemp } from '../../utils/zip.js';

export interface PrepareCommandOptions {
  outputZip: string;
  noBrowser?: boolean;
}

interface PreparedContent {
  content: string;
  contentType: 'json' | 'html';
}

type SourceHttpRequest = {
  url: string;
  method: 'GET' | 'POST';
  multiValueQueryString: string;
  headers?: Record<string, string>;
  json?: unknown;
  body?: string;
};

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
  const tempRoot = await fs.mkdtemp(path.join(tmpdir(), 'elephant-transform-'));
  const cleanup: Array<() => Promise<void>> = [
    async () => {
      try {
        await fs.rm(tempRoot, { recursive: true, force: true });
      } catch {
        logger.warn(`Unable to remove ${tempRoot}`);
      }
    },
  ];

  spinner.start('Extracting input...');
  try {
    const inputDir = await extractZipToTemp(inputZip, tempRoot, 'input');
    let propertySeed: string;
    try {
      propertySeed = await fs.readFile(
        path.join(inputDir, 'property_seed.json'),
        'utf-8'
      );
    } catch {
      console.error(chalk.red('property_seed.json not found in inputZip'));
      process.exit(1);
    }
    try {
      await fs.access(path.join(inputDir, 'unnormalized_address.json'));
    } catch {
      console.error(
        chalk.red('unnormalized_address.json not found in inputZip')
      );
      process.exit(1);
    }
    spinner.succeed('Input extracted.');
    spinner.start('Preparing output...');
    const propertySeedJson = JSON.parse(propertySeed);
    if (!(typeof propertySeedJson === 'object')) {
      console.error(
        chalk.red(
          'property_seed.json is not a valid JSON object. Please check the file contents.'
        )
      );
      process.exit(1);
    }
    if (!Object.hasOwn(propertySeedJson, 'source_http_request')) {
      console.error(
        chalk.red(
          'property_seed.json does not contain source_http_request field'
        )
      );
      process.exit(1);
    }
    const sourceHttpRequest =
      propertySeedJson.source_http_request as SourceHttpRequest;
  } finally {
    await Promise.all(cleanup);
  }
}

async function prepareWithFetch(sourceHttpRequest: SourceHttpRequest) {}

async function prepareWithBrowser(sourceHttpRequest: SourceHttpRequest) {}
