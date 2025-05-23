import { CommandOptions } from "../types";
import { isValidAddress, isValidUrl } from "../utils/validation";
import { BlockchainService } from "../services/blockchain.service";
import { IPFSService } from "../services/ipfs.service";
import { ORACLE_CONTRACT_ABI } from "../config/abi";
import { logger } from "../utils/logger";
import { createSpinner } from "../utils/progress";

export async function listAssignments(options: CommandOptions): Promise<void> {
  if (!isValidAddress(options.oracle)) {
    logger.error("Invalid oracle address");
    process.exit(1);
  }

  if (options.contract && !isValidAddress(options.contract)) {
    logger.error("Invalid contract address");
    process.exit(1);
  }

  if (options.rpc && !isValidUrl(options.rpc)) {
    logger.error("Invalid RPC URL");
    process.exit(1);
  }

  if (options.gateway && !isValidUrl(options.gateway)) {
    logger.error("Invalid IPFS gateway URL");
    process.exit(1);
  }

  // Instantiate services
  const blockchainService = new BlockchainService(
    options.rpc!,
    options.contract!,
    ORACLE_CONTRACT_ABI
  );

  const ipfsService = new IPFSService(options.gateway!);

  try {
    const fromBlock = parseInt(options.fromBlock || "0");
    
    const blockSpinner = createSpinner("Fetching current block number...");
    const currentBlock = await blockchainService.getCurrentBlock();
    blockSpinner.succeed(`Current block: ${currentBlock}`);
    
    const querySpinner = createSpinner(`Querying blocks ${fromBlock} to ${currentBlock}...`);
    const assignments = await blockchainService.getOracleAssignedEvents(
      options.oracle,
      fromBlock,
      currentBlock
    );
    querySpinner.succeed(`Found ${assignments.length} assignments`);
    
    if (assignments.length > 0) {
      assignments.forEach((assignment, index) => {
        console.log(`\nAssignment ${index + 1}:`);
        console.log(`  CID: ${assignment.cid}`);
        console.log(`  Block: ${assignment.blockNumber}`);
        console.log(`  Transaction: ${assignment.transactionHash}`);
      });
      
      // Download files with concurrency
      logger.info("Starting downloads...");
      const downloadDir = options.downloadDir || "./downloads";
      
      const results = await ipfsService.downloadBatch(
        assignments, 
        downloadDir,
        (completed, total) => {
          process.stdout.write(`\rDownloaded ${completed} of ${total} files...`);
        }
      );
      
      // Clear the progress line
      process.stdout.write("\r\x1b[K");
      
      // Report results
      const successful = results.filter(r => r.success).length;
      const failed = results.filter(r => !r.success).length;
      
      results.forEach((result, index) => {
        if (result.success) {
          logger.success(`Downloaded ${assignments[index].cid} to ${result.path}`);
        } else {
          logger.error(`Failed to download ${assignments[index].cid}: ${result.error?.message}`);
        }
      });
      
      logger.success(`Downloads complete! ${successful} succeeded, ${failed} failed.`);
    }
  } catch (error) {
    logger.error(`Error: ${error}`);
    process.exit(1);
  }
}