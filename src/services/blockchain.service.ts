import { ethers } from "ethers";
import { Assignment } from "../types";
import { EventDecoderService } from "./event-decoder.service";

export class BlockchainService {
  private provider: ethers.JsonRpcProvider;
  private contract: ethers.Contract;
  private eventDecoder: EventDecoderService;

  constructor(rpcUrl: string, contractAddress: string, abi: any[]) {
    this.provider = new ethers.JsonRpcProvider(rpcUrl);
    this.contract = new ethers.Contract(contractAddress, abi, this.provider);
    this.eventDecoder = new EventDecoderService();
  }

  async getCurrentBlock(): Promise<number> {
    return await this.provider.getBlockNumber();
  }

  async getOracleAssignedEvents(
    oracleAddress: string,
    fromBlock: number,
    toBlock?: number
  ): Promise<Assignment[]> {
    const filter = this.contract.filters.OracleAssigned(null, oracleAddress);
    const events = await this.contract.queryFilter(filter, fromBlock, toBlock);
    
    return events.map(event => this.eventDecoder.parseOracleAssignedEvent(event));
  }
}