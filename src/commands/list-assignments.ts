import { CommandOptions } from "../types";
import { isValidAddress, isValidUrl } from "../utils/validation";

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

  console.log("listAssignments called with validated options:");
  console.log("- Oracle address:", options.oracle);
  console.log("- Contract address:", options.contract);
  console.log("- RPC URL:", options.rpc);
  console.log("- IPFS Gateway:", options.gateway);
  console.log("- From Block:", options.fromBlock);
  console.log("- Download Directory:", options.downloadDir);
}