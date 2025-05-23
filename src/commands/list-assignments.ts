import { CommandOptions } from '../types';
import { isValidAddress, isValidUrl } from '../utils/validation';
import { BlockchainService } from '../services/blockchain.service';
import { IPFSService } from '../services/ipfs.service';
import { ELEPHANT_CONTRACT_ABI } from '../config/abi';
import { logger } from '../utils/logger';
import { createSpinner } from '../utils/progress';

export async function listAssignments(options: CommandOptions): Promise<void> {
  const startTime = Date.now();
  if (!isValidAddress(options.elephant)) {
    logger.error('Invalid elephant address');
    process.exit(1);
  }

  if (options.contract && !isValidAddress(options.contract)) {
    logger.error('Invalid contract address');
    process.exit(1);
  }

  if (options.rpc && !isValidUrl(options.rpc)) {
    logger.error('Invalid RPC URL');
    process.exit(1);
  }

  if (options.gateway && !isValidUrl(options.gateway)) {
    logger.error('Invalid IPFS gateway URL');
    process.exit(1);
  }

  // Instantiate services
  const blockchainService = new BlockchainService(
    options.rpc!,
    options.contract!,
    ELEPHANT_CONTRACT_ABI
  );

  const ipfsService = new IPFSService(options.gateway!);

  try {
    const fromBlock = parseInt(options.fromBlock || '0');

    const blockSpinner = createSpinner('Fetching current block number...');
    const currentBlock = await blockchainService.getCurrentBlock();
    blockSpinner.succeed(`Current block: ${currentBlock}`);

    const querySpinner = createSpinner(
      `Querying blocks ${fromBlock} to ${currentBlock}...`
    );
    const assignments = await blockchainService.getElephantAssignedEvents(
      options.elephant,
      fromBlock,
      currentBlock
    );
    querySpinner.succeed(`Found ${assignments.length} assignments`);

    let results: any[] = [];

    if (assignments.length === 0) {
      logger.info(
        'No assignments found for this elephant address in the specified block range.'
      );
      const endTime = Date.now();
      const duration = ((endTime - startTime) / 1000).toFixed(1);
      logger.info(`Completed in ${duration} seconds`);
      return;
    }

    if (assignments.length > 0) {
      assignments.forEach((assignment, index) => {
        console.log(`\nAssignment ${index + 1}:`);
        console.log(`  CID: ${assignment.cid}`);
        console.log(`  Block: ${assignment.blockNumber}`);
        console.log(`  Transaction: ${assignment.transactionHash}`);
      });

      // Download files with concurrency
      logger.info('Starting downloads...');
      const downloadDir = options.downloadDir || './downloads';

      results = await ipfsService.downloadBatch(
        assignments,
        downloadDir,
        (completed, total) => {
          process.stdout.write(
            `\rDownloaded ${completed} of ${total} files...`
          );
        }
      );

      // Clear the progress line
      process.stdout.write('\r\x1b[K');

      // Report results
      const successful = results.filter((r) => r.success).length;
      const failed = results.filter((r) => !r.success).length;

      results.forEach((result, index) => {
        if (result.success) {
          logger.success(
            `Downloaded ${assignments[index].cid} to ${result.path}`
          );
        } else {
          logger.error(
            `Failed to download ${assignments[index].cid}: ${result.error?.message}`
          );
        }
      });

      logger.success(
        `Downloads complete! ${successful} succeeded, ${failed} failed.`
      );
    }

    const endTime = Date.now();
    const duration = ((endTime - startTime) / 1000).toFixed(1);

    // Summary statistics
    console.log('\n' + '='.repeat(50));
    logger.info('Summary:');
    logger.info(`  Total assignments found: ${assignments.length}`);
    if (assignments.length > 0) {
      logger.info(
        `  Files downloaded: ${results.filter((r) => r.success).length}`
      );
      logger.info(
        `  Download failures: ${results.filter((r) => !r.success).length}`
      );
    }
    logger.info(`  Blocks scanned: ${currentBlock - fromBlock + 1}`);
    logger.info(`  Execution time: ${duration} seconds`);
    console.log('='.repeat(50));
  } catch (error: any) {
    if (error.code === 'NETWORK_ERROR' || error.code === 'SERVER_ERROR') {
      logger.error(
        'Failed to connect to RPC endpoint. Please check your RPC URL and internet connection.'
      );
    } else if (error.message?.includes('invalid address')) {
      logger.error('Invalid contract or elephant address format.');
    } else {
      logger.error(`Error: ${error.message || error}`);
    }
    process.exit(1);
  }
}
