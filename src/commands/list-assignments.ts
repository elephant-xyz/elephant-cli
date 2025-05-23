import { CommandOptions } from "../types";
import { isValidAddress, isValidUrl } from "../utils/validation";
import { BlockchainService } from "../services/blockchain.service";
import { IPFSService } from "../services/ipfs.service";
import { ORACLE_CONTRACT_ABI } from "../config/abi";

export async function listAssignments(options: CommandOptions): Promise<void> {
  if (!isValidAddress(options.oracle)) {
    console.error("Error: Invalid oracle address");
    process.exit(1);
  }

  if (options.contract && !isValidAddress(options.contract)) {
    console.error("Error: Invalid contract address");
    process.exit(1);
  }

  if (options.rpc && !isValidUrl(options.rpc)) {
    console.error("Error: Invalid RPC URL");
    process.exit(1);
  }

  if (options.gateway && !isValidUrl(options.gateway)) {
    console.error("Error: Invalid IPFS gateway URL");
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
    console.log("Fetching oracle assignments...");
    
    const fromBlock = parseInt(options.fromBlock || "0");
    const currentBlock = await blockchainService.getCurrentBlock();
    
    console.log(`Querying blocks ${fromBlock} to ${currentBlock}...`);
    
    const assignments = await blockchainService.getOracleAssignedEvents(
      options.oracle,
      fromBlock,
      currentBlock
    );
    
    console.log(`Found ${assignments.length} assignments`);
    
    if (assignments.length > 0) {
      assignments.forEach((assignment, index) => {
        console.log(`\nAssignment ${index + 1}:`);
        console.log(`  CID: ${assignment.cid}`);
        console.log(`  Block: ${assignment.blockNumber}`);
        console.log(`  Transaction: ${assignment.transactionHash}`);
      });
      
      // Download files sequentially
      console.log("\nDownloading files...");
      const downloadDir = options.downloadDir || "./downloads";
      
      for (let i = 0; i < assignments.length; i++) {
        const assignment = assignments[i];
        const outputPath = `${downloadDir}/${assignment.cid}`;
        
        console.log(`\nDownloading ${i + 1}/${assignments.length}: ${assignment.cid}`);
        const result = await ipfsService.downloadFile(assignment.cid, outputPath);
        
        if (result.success) {
          console.log(`  ✓ Downloaded to: ${result.path}`);
        } else {
          console.log(`  ✗ Failed: ${result.error?.message}`);
        }
      }
      
      console.log("\nDownload complete!");
    }
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
}