import { ethers } from "ethers";
import { Assignment } from "../types";

export class BlockchainService {
  private provider: ethers.JsonRpcProvider;
  private contract: ethers.Contract;

  constructor(rpcUrl: string, contractAddress: string, abi: any[]) {
    this.provider = new ethers.JsonRpcProvider(rpcUrl);
    this.contract = new ethers.Contract(contractAddress, abi, this.provider);
  }

  async getCurrentBlock(): Promise<number> {
    return await this.provider.getBlockNumber();
  }

  async getOracleAssignedEvents(
    oracleAddress: string,
    fromBlock: number,
    toBlock?: number
  ): Promise<Assignment[]> {
    return [];
  }
}