import { readFileSync } from 'fs';
import { BlockchainService } from '../services/blockchain.service';
import { IPFSService } from '../services/ipfs.service';
import { CommandOptions, DownloadResult, ElephantAssignment } from '../types';
import { DEFAULT_CONTRACT_ABI } from '../utils/constants';
import { logger } from '../utils/logger';
import { createSpinner } from '../utils/progress';
import { isValidAddress, isValidBlock, isValidUrl } from '../utils/validation';

export async function listAssignments(options: CommandOptions): Promise<void> {
  // Validate inputs
  if (!options.elephant || !isValidAddress(options.elephant)) {
    logger.error(`Invalid elephant address: ${options.elephant}`);
    process.exit(1);
  }
  const elephantAddress: string = options.elephant;

  if (!options.contract || !isValidAddress(options.contract)) {
    logger.error(`Invalid contract address: ${options.contract}`);
    process.exit(1);
  }
  const contractAddress: string = options.contract;

  if (!options.rpc || !isValidUrl(options.rpc)) {
    logger.error(`Invalid RPC URL: ${options.rpc}`);
    process.exit(1);
  }
  const rpcUrl: string = options.rpc;

  if (!options.gateway || !isValidUrl(options.gateway)) {
    logger.error(`Invalid IPFS Gateway URL: ${options.gateway}`);
    process.exit(1);
  }
  const gatewayUrl: string = options.gateway;

  if (!options.fromBlock || !isValidBlock(options.fromBlock)) {
    logger.error(`Invalid fromBlock: ${options.fromBlock}`);
    process.exit(1);
  }
  const fromBlock: string = options.fromBlock;

  const toBlockOpt = options.toBlock ? options.toBlock : 'latest';
  if (!isValidBlock(toBlockOpt)) {
    logger.error(`Invalid toBlock: ${toBlockOpt}`);
    process.exit(1);
  }

  const downloadDir = options.downloadDir || './downloads';
  const contractAbi =
    options.abiPath && typeof options.abiPath === 'string'
      ? JSON.parse(readFileSync(options.abiPath, 'utf-8'))
      : DEFAULT_CONTRACT_ABI;

  const spinner = createSpinner('Initializing...'); // Provide initial text

  try {
    spinner.start('Initializing services...');
    const blockchainService = new BlockchainService(
      rpcUrl,
      contractAddress,
      contractAbi
    );
    const ipfsService = new IPFSService(
      gatewayUrl,
      options.maxConcurrentDownloads
    );
    spinner.succeed('Services initialized.');

    spinner.start('Fetching current block number...');
    const currentBlock = await blockchainService.getCurrentBlock();
    spinner.succeed(`Current block number: ${currentBlock}`);

    const parsedFromBlock =
      fromBlock === 'latest' ? currentBlock : parseInt(fromBlock, 10);
    const parsedToBlock =
      toBlockOpt === 'latest' ? currentBlock : parseInt(toBlockOpt, 10);

    if (parsedFromBlock > parsedToBlock) {
      logger.error(
        `fromBlock (${parsedFromBlock}) cannot be greater than toBlock (${parsedToBlock}).`
      );
      process.exit(1);
    }

    spinner.start(
      `Fetching ElephantAssigned events for ${elephantAddress} from block ${parsedFromBlock} to ${parsedToBlock}...`
    );

    const events: ElephantAssignment[] =
      await blockchainService.getElephantAssignedEvents(
        elephantAddress,
        parsedFromBlock,
        parsedToBlock
      );
    spinner.succeed(`Found ${events.length} assignment(s).`);

    if (events.length === 0) {
      logger.info(
        'No assignments found for this elephant address in the specified block range.'
      );
      return;
    }

    logger.info('Starting downloads...');

    let downloadedCount = 0;
    let failedCount = 0;
    const totalFiles = events.length;

    spinner.start(`Downloading files (0/${totalFiles})...`);

    const downloadResults: DownloadResult[] = await ipfsService.downloadBatch(
      events,
      downloadDir,
      (completed, total) => {
        spinner.text = `Downloading files (${completed}/${total})...`;
      }
    );

    downloadResults.forEach((result) => {
      if (result.success) {
        downloadedCount++;
      } else {
        failedCount++;
        logger.warn(
          `Failed to download CID ${result.cid}: ${result.error?.message || 'Unknown error'}`
        );
      }
    });

    if (failedCount > 0) {
      spinner.warn(
        `Downloads complete! ${downloadedCount} succeeded, ${failedCount} failed.`
      );
    } else {
      spinner.succeed(
        `Downloads complete! ${downloadedCount} succeeded, ${failedCount} failed.`
      );
    }

    logger.log('\nSummary:');
    logger.log(`Total assignments found: ${events.length}`);
    logger.log(`Files downloaded: ${downloadedCount}`);
    logger.log(`Files failed: ${failedCount}`);
    logger.log(`Blocks scanned: ${parsedToBlock - parsedFromBlock + 1}`);
  } catch (error: unknown) {
    spinner.fail('An error occurred:');
    if (error instanceof Error) {
      logger.error(error.message);
      if (error.stack) {
        logger.error(error.stack);
      }
    } else {
      logger.error(String(error));
    }

    process.exit(1);
  }
}
