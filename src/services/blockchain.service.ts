import { JsonRpcProvider, Contract, Log } from 'ethers';
import { EventDecoderService } from './event-decoder.service.js';
import {
  OracleAssignment,
  ABI,
  DataSubmittedEvent,
  StreamingOptions,
} from '../types/index.js';
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

  public async *getDataSubmittedEventsStream(
    fromBlock: number,
    toBlock?: number,
    options: StreamingOptions = {}
  ): AsyncGenerator<DataSubmittedEvent[], void, unknown> {
    const {
      blockChunkSize = 2500, // Smaller chunks for Polygon's high event density
      eventBatchSize = 500,
      retryAttempts = 3,
      retryDelay = 2000,
    } = options;

    const finalToBlock = toBlock || (await this.getCurrentBlock());
    const filter = this.contract.filters.DataSubmitted();

    let eventBuffer: DataSubmittedEvent[] = [];

    logger.info(
      `Streaming DataSubmitted events from block ${fromBlock} to ${finalToBlock} in chunks of ${blockChunkSize} blocks.`
    );

    for (
      let currentFromBlock = fromBlock;
      currentFromBlock <= finalToBlock;
      currentFromBlock += blockChunkSize
    ) {
      const currentToBlock = Math.min(
        currentFromBlock + blockChunkSize - 1,
        finalToBlock
      );

      // Retry logic for RPC failures
      let attempts = 0;
      let eventsChunkRaw: Log[] = [];

      while (attempts < retryAttempts) {
        try {
          logger.debug(
            `Querying chunk: ${currentFromBlock} - ${currentToBlock}`
          );
          eventsChunkRaw = await this.contract.queryFilter(
            filter,
            currentFromBlock,
            currentToBlock
          );
          logger.debug(
            `Fetched ${eventsChunkRaw.length} events in chunk ${currentFromBlock} - ${currentToBlock}`
          );
          break; // Success
        } catch (error) {
          attempts++;
          if (attempts >= retryAttempts) {
            logger.error(
              `Failed to fetch events after ${retryAttempts} attempts for block range ${currentFromBlock}-${currentToBlock}: ${error}`
            );
            throw error;
          }

          logger.warn(
            `Retry ${attempts}/${retryAttempts} for block range ${currentFromBlock}-${currentToBlock} after ${retryDelay}ms`
          );
          await new Promise((resolve) =>
            setTimeout(resolve, retryDelay * attempts)
          );
        }
      }

      // Parse and buffer events
      for (const rawEvent of eventsChunkRaw) {
        const parsed = this.eventDecoder.parseDataSubmittedEvent(rawEvent);
        if (parsed) {
          eventBuffer.push(parsed);

          // Yield when buffer is full
          if (eventBuffer.length >= eventBatchSize) {
            yield eventBuffer;
            eventBuffer = [];
          }
        }
      }
    }

    // Yield remaining events
    if (eventBuffer.length > 0) {
      yield eventBuffer;
    }
  }
}
