import { Command } from 'commander';
import { IPFSFetcherService } from '../services/ipfs-fetcher.service.js';
import { logger } from '../utils/logger.js';
import { createSpinner } from '../utils/progress.js';
import { isValidUrl, isValidCID } from '../utils/validation.js';
import { DEFAULT_IPFS_GATEWAY, DEFAULT_RPC_URL } from '../config/constants.js';
import { isHexString } from 'ethers';
import chalk from 'chalk';

export interface FetchDataOptions {
  gateway?: string;
  outputDir?: string;
  rpcUrl?: string;
}

export function registerFetchDataCommand(program: Command) {
  program
    .command('fetch-data <input>')
    .description(
      'Fetch data tree from an IPFS CID or transaction hash, downloading all linked data'
    )
    .option(
      '-g, --gateway <url>',
      'IPFS gateway URL',
      process.env.IPFS_GATEWAY || DEFAULT_IPFS_GATEWAY
    )
    .option(
      '-o, --output-dir <path>',
      'Output directory for fetched data',
      'data'
    )
    .option(
      '-r, --rpc-url <url>',
      'RPC URL for fetching transaction data',
      process.env.RPC_URL || DEFAULT_RPC_URL
    )
    .action(async (input: string, options: FetchDataOptions) => {
      await fetchData(input, options);
    });
}

async function fetchData(
  input: string,
  options: FetchDataOptions
): Promise<void> {
  const spinner = createSpinner('Initializing...');

  try {
    // Validate gateway URL if provided
    if (options.gateway && !isValidUrl(options.gateway)) {
      logger.error(`Invalid IPFS Gateway URL: ${options.gateway}`);
      process.exit(1);
    }

    // Validate RPC URL if provided
    if (options.rpcUrl && !isValidUrl(options.rpcUrl)) {
      logger.error(`Invalid RPC URL: ${options.rpcUrl}`);
      process.exit(1);
    }

    const gatewayUrl = options.gateway!;
    const outputDir = options.outputDir!;
    const rpcUrl = options.rpcUrl!;

    spinner.start('Initializing IPFS fetcher service...');
    const fetcher = new IPFSFetcherService(gatewayUrl, rpcUrl);
    spinner.succeed('Service initialized.');

    // Determine if input is a CID or transaction hash
    const isTransactionHash = isHexString(input, 32);
    const isCid = !isTransactionHash && isValidCID(input);

    if (!isCid && !isTransactionHash) {
      throw new Error(
        'Input must be either a valid IPFS CID or a transaction hash (32 bytes hex string)'
      );
    }

    if (isTransactionHash) {
      spinner.start(`Fetching transaction data for: ${input}`);
      await fetcher.fetchFromTransaction(input, outputDir);
      spinner.succeed('Transaction data fetch complete!');
    } else {
      spinner.start(`Starting fetch from CID: ${input}`);
      const resultDir = await fetcher.fetchData(input, outputDir);
      spinner.succeed('Data fetch complete!');
      logger.log(chalk.blue(`Data saved in: ${resultDir}`));
    }

    logger.log(chalk.green('\n✓ Fetch successful!'));
  } catch (error: unknown) {
    spinner.fail('Fetch failed');

    if (error instanceof Error) {
      logger.error(error.message);
      if (error.stack) {
        logger.debug(error.stack);
      }
    } else {
      logger.error(String(error));
    }

    process.exit(1);
  }
}
