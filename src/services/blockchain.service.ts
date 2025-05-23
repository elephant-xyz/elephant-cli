import { ethers } from 'ethers';
import { ElephantAssignment } from '../types';
import { EventDecoderService } from './event-decoder.service';

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

  async getElephantAssignedEvents(
    elephantAddress: string,
    fromBlock: number,
    toBlock?: number
  ): Promise<ElephantAssignment[]> {
    const filter = this.contract.filters.ElephantAssigned(
      null,
      elephantAddress
    );
    const events = await this.contract.queryFilter(filter, fromBlock, toBlock);

    return events.map((event) =>
      this.eventDecoder.parseElephantAssignedEvent(event)
    );
  }
}
