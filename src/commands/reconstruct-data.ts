import { Command } from 'commander';
import { IPFSReconstructorService } from '../services/ipfs-reconstructor.service.js';
import { logger } from '../utils/logger.js';
import { createSpinner } from '../utils/progress.js';
import { isValidUrl, isValidCID } from '../utils/validation.js';
import { DEFAULT_IPFS_GATEWAY, DEFAULT_RPC_URL } from '../config/constants.js';
import { isHexString } from 'ethers';
import chalk from 'chalk';

export interface ReconstructDataOptions {
  gateway?: string;
  outputDir?: string;
  rpcUrl?: string;
}

export function registerReconstructDataCommand(program: Command) {
  program
    .command('reconstruct-data <input>')
    .description(
      'Reconstruct data tree from an IPFS CID or transaction hash, downloading all linked data'
    )
    .option(
      '-g, --gateway <url>',
      'IPFS gateway URL',
      process.env.IPFS_GATEWAY || DEFAULT_IPFS_GATEWAY
    )
    .option(
      '-o, --output-dir <path>',
      'Output directory for reconstructed data',
      'data'
    )
    .option(
      '-r, --rpc-url <url>',
      'RPC URL for fetching transaction data',
      process.env.RPC_URL || DEFAULT_RPC_URL
    )
    .action(async (input: string, options: ReconstructDataOptions) => {
      await reconstructData(input, options);
    });
}

async function reconstructData(
  input: string,
  options: ReconstructDataOptions
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

    spinner.start('Initializing IPFS reconstructor service...');
    const reconstructor = new IPFSReconstructorService(gatewayUrl, rpcUrl);
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
      await reconstructor.reconstructFromTransaction(input, outputDir);
      spinner.succeed('Transaction data reconstruction complete!');
    } else {
      spinner.start(`Starting reconstruction from CID: ${input}`);
      const resultDir = await reconstructor.reconstructData(input, outputDir);
      spinner.succeed('Data reconstruction complete!');
      logger.log(chalk.blue(`Data saved in: ${resultDir}`));
    }

    logger.log(chalk.green('\n✓ Reconstruction successful!'));
  } catch (error: unknown) {
    spinner.fail('Reconstruction failed');

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
