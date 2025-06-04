import { JsonRpcProvider, Contract, Log } from 'ethers';
import { EventDecoderService } from './event-decoder.service.js';
import { OracleAssignment, ABI } from '../types/index.js';
import { logger } from '../utils/logger.js';
import { DEFAULT_BLOCK_RANGE } from '../utils/constants.js';

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

  public async getOracleAssignedEvents(
    oracleAddress: string,
    fromBlock: number,
    toBlock?: number
  ): Promise<OracleAssignment[]> {
    const MAX_BLOCK_RANGE = DEFAULT_BLOCK_RANGE;
    const finalToBlock = toBlock || (await this.getCurrentBlock());

    const filter = this.contract.filters.OracleAssigned(null, oracleAddress);
    let allEventsRaw: Log[] = [];

    logger.info(
      `Fetching OracleAssigned events for ${oracleAddress} from block ${fromBlock} to ${finalToBlock} in chunks of ${MAX_BLOCK_RANGE} blocks.`
    );

    for (
      let currentFromBlock = fromBlock;
      currentFromBlock <= finalToBlock;
      currentFromBlock += MAX_BLOCK_RANGE
    ) {
      const currentToBlock = Math.min(
        currentFromBlock + MAX_BLOCK_RANGE - 1,
        finalToBlock
      );
      logger.debug(`Querying chunk: ${currentFromBlock} - ${currentToBlock}`);
      try {
        const eventsChunkRaw = await this.contract.queryFilter(
          filter,
          currentFromBlock,
          currentToBlock
        );
        allEventsRaw = allEventsRaw.concat(eventsChunkRaw);
        logger.debug(
          `Fetched ${eventsChunkRaw.length} events in chunk ${currentFromBlock} - ${currentToBlock}. Total raw events: ${allEventsRaw.length}`
        );
      } catch (error) {
        logger.error(
          `Error fetching events for block range ${currentFromBlock}-${currentToBlock}: ${error}`
        );
        // Decide if you want to throw, or continue and try to get other chunks
        // For now, let's rethrow to indicate a failure in fetching part of the logs
        throw error;
      }
    }

    const parsedEvents = allEventsRaw.map((event) => {
      try {
        return this.eventDecoder.parseOracleAssignedEvent(event);
      } catch (error) {
        logger.error(`Failed to parse event: ${error}, ${event}`);
        return null;
      }
    });

    return parsedEvents.filter(
      (parsedEvent): parsedEvent is NonNullable<typeof parsedEvent> =>
        parsedEvent !== null
    );
  }
}
