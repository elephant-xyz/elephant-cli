import { JsonRpcProvider, Contract } from 'ethers';
import { EventDecoderService } from './event-decoder.service.js';
import { ElephantAssignment, ABI } from '../types/index.js';
import { logger } from '../utils/logger.js';

export class BlockchainService {
  private provider: JsonRpcProvider;
  private contract: Contract;
  private eventDecoder: EventDecoderService;

  constructor(rpcUrl: string, contractAddress: string, abi: ABI) {
    this.provider = new JsonRpcProvider(rpcUrl);
    this.contract = new Contract(contractAddress, abi, this.provider);
    this.eventDecoder = new EventDecoderService();
  }

  public async getCurrentBlock(): Promise<number> {
    return this.provider.getBlockNumber();
  }

  public async getElephantAssignedEvents(
    oracleAddress: string,
    fromBlock: number,
    toBlock?: number
  ): Promise<ElephantAssignment[]> {
    // Define the filter for the ElephantAssigned event, filtering by the indexed elephant address
    // The event is: event ElephantAssigned(bytes propertyCid, address indexed elephant);
    // In ethers.js v6, contract.filters.EventName(arg1, arg2, ...) is used.
    // For an indexed address, you pass the address directly.
    // If an argument is not indexed or you don't want to filter by it, use null.
    const filter = this.contract.filters.OracleAssigned(null, oracleAddress);

    const eventsRaw = await this.contract.queryFilter(
      filter,
      fromBlock,
      toBlock
    );

    const parsedEvents = await Promise.all(
      eventsRaw.map(async (event) => {
        try {
          return await this.eventDecoder.parseElephantAssignedEvent(event);
        } catch (error) {
          logger.error(`Failed to parse event: ${error}, ${event}`);
          return null;
        }
      })
    );

    return parsedEvents.filter(
      (parsedEvent): parsedEvent is NonNullable<typeof parsedEvent> =>
        parsedEvent !== null
    );
  }
}
