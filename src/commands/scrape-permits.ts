import { promises as fs } from 'fs';
import path from 'path';
import { Command } from 'commander';
import chalk from 'chalk';
import AdmZip from 'adm-zip';
import { logger } from '../utils/logger.js';
import { createSpinner } from '../utils/progress.js';
import { ProxyUrl, ProxyOptions, ScrapeResult } from '../lib/types.js';
import {
  getPermitScraper,
  SUPPORTED_COUNTIES,
} from '../lib/county-specific-scrape/index.js';

export interface ScrapePermitsOptions {
  outputDir: string;
  county: string;
  headless?: boolean;
  proxy?: ProxyUrl;
  zip?: boolean;
}

function parseProxy(proxy: ProxyUrl): ProxyOptions {
  const [, username, password, ip, port] =
    proxy.match(/^(.*?):(.*?)@(.*?):(\d+)$/) || [];
  if (!username || !password || !ip || !port) {
    throw new Error(
      'Invalid proxy format. Expected format: username:password@ip:port'
    );
  }
  return { username, password, ip, port: Number(port) };
}

async function writeManifest(
  outputDir: string,
  result: ScrapeResult
): Promise<string> {
  const manifest = {
    pcn: result.pcn,
    county: result.county,
    permitCount: result.permitCount,
    filesCount: result.files.length,
    files: result.files.map((f) => path.basename(f)),
    errors: result.errors,
    scrapedAt: new Date().toISOString(),
  };
  const filepath = path.join(outputDir, 'manifest.json');
  await fs.writeFile(filepath, JSON.stringify(manifest, null, 2), 'utf-8');
  return filepath;
}

async function createZipFromDir(
  outputDir: string,
  pcn: string
): Promise<string> {
  const zip = new AdmZip();
  const entries = await fs.readdir(outputDir);
  for (const entry of entries) {
    zip.addLocalFile(path.join(outputDir, entry));
  }
  const zipPath = path.join(path.dirname(outputDir), `${pcn}_permits.zip`);
  zip.writeZip(zipPath);
  return zipPath;
}

export function registerScrapePermitsCommand(program: Command) {
  program
    .command('scrape-permits')
    .description(
      'Scrape and download permit data HTML files for a property by parcel control number'
    )
    .argument('<pcn>', 'Parcel control number (e.g., 00424631070070270)')
    .requiredOption(
      '--output-dir <path>',
      'Directory to save downloaded HTML files'
    )
    .option(
      '--county <name>',
      `County to scrape (supported: ${SUPPORTED_COUNTIES.join(', ')})`,
      'palm-beach'
    )
    .option('--no-headless', 'Show the browser window during scraping')
    .option('--proxy <url>', 'Proxy URL (format: username:password@ip:port)')
    .option(
      '--zip',
      'Bundle output into a ZIP file alongside the output directory',
      false
    )
    .action(async (pcn: string, options: ScrapePermitsOptions) => {
      await handleScrapePermits(pcn, options);
    });
}

export async function handleScrapePermits(
  pcn: string,
  options: ScrapePermitsOptions
) {
  console.log(chalk.bold.blue('🐘 Elephant Network CLI - Scrape Permits'));
  console.log();

  const headless = options.headless ?? true;
  const proxy = options.proxy ? parseProxy(options.proxy) : undefined;
  const scraper = getPermitScraper(options.county);

  console.log(chalk.cyan(`County:     ${options.county}`));
  console.log(chalk.cyan(`PCN:        ${pcn}`));
  console.log(chalk.cyan(`Output Dir: ${options.outputDir}`));
  console.log(chalk.cyan(`Headless:   ${headless}`));
  if (options.zip) console.log(chalk.cyan(`ZIP:        enabled`));
  console.log();

  const spinner = createSpinner(
    `Scraping permits for PCN ${pcn} in ${options.county} county...`
  );

  const result = await scraper(pcn, options.outputDir, headless, proxy);

  const manifestPath = await writeManifest(options.outputDir, result);
  result.files.push(manifestPath);

  spinner.succeed('Scraping complete.');

  console.log();
  console.log(chalk.bold('📊 Results'));
  console.log(`  Permits found: ${chalk.green(String(result.permitCount))}`);
  console.log(`  Files saved:   ${chalk.green(String(result.files.length))}`);
  if (result.errors.length > 0) {
    console.log(`  Errors:        ${chalk.red(String(result.errors.length))}`);
  }
  if (result.permitCount === 0 && headless) {
    console.log();
    console.log(
      chalk.yellow(
        '  ⚠ No permits found in headless mode. This site may block headless browsers.'
      )
    );
    console.log(
      chalk.yellow('    Try running with --no-headless if you expect permits.')
    );
  }
  console.log();

  for (const file of result.files) {
    console.log(`  ${chalk.gray('→')} ${file}`);
  }

  if (result.errors.length > 0) {
    console.log();
    console.log(chalk.bold.yellow('⚠ Failed permits:'));
    for (const err of result.errors) {
      console.log(`  ${chalk.red('✗')} ${err.permitNumber}: ${err.error}`);
    }
  }

  if (options.zip) {
    const zipPath = await createZipFromDir(options.outputDir, pcn);
    console.log();
    console.log(`  ${chalk.gray('📦')} ${zipPath}`);
  }

  console.log();
  logger.success(`Output saved to: ${options.outputDir}`);
  console.log(chalk.green('✅ Scrape permits complete.'));
}
