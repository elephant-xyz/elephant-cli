import { Command } from 'commander';
import { IPFSReconstructorService } from '../services/ipfs-reconstructor.service.js';
import { logger } from '../utils/logger.js';
import { createSpinner } from '../utils/progress.js';
import { isValidUrl } from '../utils/validation.js';
import { DEFAULT_IPFS_GATEWAY } from '../config/constants.js';
import chalk from 'chalk';

export interface ReconstructDataOptions {
  gateway?: string;
  outputDir?: string;
}

export function registerReconstructDataCommand(program: Command) {
  program
    .command('reconstruct-data <cid>')
    .description(
      'Reconstruct data tree from an IPFS CID, downloading all linked data'
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
    .action(async (cid: string, options: ReconstructDataOptions) => {
      await reconstructData(cid, options);
    });
}

async function reconstructData(
  cid: string,
  options: ReconstructDataOptions
): Promise<void> {
  const spinner = createSpinner('Initializing...');

  try {
    // Validate gateway URL if provided
    if (options.gateway && !isValidUrl(options.gateway)) {
      logger.error(`Invalid IPFS Gateway URL: ${options.gateway}`);
      process.exit(1);
    }

    const gatewayUrl = options.gateway || DEFAULT_IPFS_GATEWAY;
    const outputDir = options.outputDir || 'data';

    spinner.start('Initializing IPFS reconstructor service...');
    const reconstructor = new IPFSReconstructorService(gatewayUrl);
    spinner.succeed('Service initialized.');

    spinner.start(`Starting reconstruction from CID: ${cid}`);

    const resultDir = await reconstructor.reconstructData(cid, outputDir);

    spinner.succeed('Data reconstruction complete!');

    logger.log(chalk.green('\n✓ Reconstruction successful!'));
    logger.log(chalk.blue(`Data saved in: ${resultDir}`));
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
