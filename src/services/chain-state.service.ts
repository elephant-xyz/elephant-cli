import { Contract, JsonRpcProvider, ZeroHash, getAddress, Log } from 'ethers';
import { BlockchainService } from './blockchain.service.js';
import { ABI } from '../types/index.js';
import { SUBMIT_CONTRACT_ABI_FRAGMENTS } from '../config/constants.js';
import {
  isValidCID,
  extractHashFromCID,
  deriveCIDFromHash,
} from '../utils/validation.js';
import { logger } from '../utils/logger.js';
import { DEFAULT_BLOCK_RANGE, DEFAULT_FROM_BLOCK } from '../utils/constants.js';

export class ChainStateService extends BlockchainService {
  private submitContract: Contract;
  private userSubmissionsCache: Map<string, Set<string>> = new Map();
  private consensusDataCache: Map<string, string> = new Map();

  constructor(
    rpcUrl: string,
    contractAddress: string,
    submitContractAddress: string,
    abi: ABI,
    submitAbi: ABI = SUBMIT_CONTRACT_ABI_FRAGMENTS
  ) {
    super(rpcUrl, contractAddress, abi);
    const provider = new JsonRpcProvider(rpcUrl);
    this.submitContract = new Contract(
      submitContractAddress,
      submitAbi,
      provider
    );
  }

  async prepopulateConsensusCache(): Promise<void> {
    if (this.consensusDataCache.size > 0) {
      logger.debug(
        'Consensus cache is already populated for all requested queries.'
      );
      return;
    }

    logger.technical(`Pre-populating consensus cache for all items.`);

    const eventFilter = this.submitContract.filters.ConsensusReached(
      null,
      null
    );

    const finalToBlock = await this.getCurrentBlock();
    const events = await this._queryEventsInChunks(
      eventFilter,
      DEFAULT_FROM_BLOCK,
      finalToBlock
    );
    logger.technical(
      `Found ${events.length} potentially relevant ConsensusReached events.`
    );

    for (const event of events) {
      const args = (event as any).args;
      if (args && args.propertyHash && args.dataGroupHash && args.dataHash) {
        const cacheKey = `${args.propertyHash}-${args.dataGroupHash}`;
        this.consensusDataCache.set(cacheKey, args.dataHash);
      }
    }

    logger.debug(
      `Consensus cache populated. ${this.consensusDataCache.size} items found.`
    );
  }

  /**
   * Gets the current data CID for a given property and data group.
   * @param propertyCid The property CID.
   * @param dataGroupCid The data group CID.
   * @returns The current data CID or null if not found or invalid.
   */
  async getCurrentDataCid(
    propertyCid: string,
    dataGroupCid: string
  ): Promise<string | null> {
    const propertyHash = extractHashFromCID(propertyCid);
    const dataGroupHash = extractHashFromCID(dataGroupCid);
    const cacheKey = `${propertyHash}-${dataGroupHash}`;

    if (this.consensusDataCache.has(cacheKey)) {
      const dataHash = this.consensusDataCache.get(cacheKey)!;
      logger.debug(
        `Cache hit for consensus data for property ${propertyCid}, group ${dataGroupCid}.`
      );
      if (
        !dataHash ||
        dataHash === '0x' ||
        dataHash === ZeroHash ||
        dataHash ===
          '0x0000000000000000000000000000000000000000000000000000000000000000'
      ) {
        return null;
      }
      const cidString = deriveCIDFromHash(dataHash);
      if (isValidCID(cidString)) {
        return cidString;
      } else {
        logger.warn(
          `Invalid data CID derived from cached hash: ${cidString} (raw hash: ${dataHash}) for property ${propertyCid}, group ${dataGroupCid}`
        );
        return null;
      }
    } else {
      logger.warn(
        `Cache miss for consensus data for property ${propertyCid}, group ${dataGroupCid}. Falling back to direct contract call.`
      );
      return null;
    }
  }

  /**
   * Checks if a specific user has already submitted data for the given CIDs combination
   * by querying all historical 'DataSubmitted' events for that user once and caching the results.
   * @param userAddress The user's wallet address.
   * @param propertyCid The property CID.
   * @param dataGroupCid The data group CID.
   * @param dataCid The data CID.
   * @returns True if the user has already submitted this data according to event logs, false otherwise or on error.
   */
  async hasUserSubmittedData(
    userAddress: string,
    propertyCid: string,
    dataGroupCid: string,
    dataCid: string
  ): Promise<boolean> {
    const propertyHash = extractHashFromCID(propertyCid);
    const dataGroupHash = extractHashFromCID(dataGroupCid);
    const dataHashToFind = extractHashFromCID(dataCid);
    const normalizedUserAddress = getAddress(userAddress);

    const submissionKey = `${propertyHash}-${dataGroupHash}-${dataHashToFind}`;

    // Check if we have already fetched events for this user.
    if (this.userSubmissionsCache.has(normalizedUserAddress)) {
      const submittedDataHashes = this.userSubmissionsCache.get(
        normalizedUserAddress
      )!;
      const hasSubmitted = submittedDataHashes.has(submissionKey);
      logger.debug(
        `Cache hit for user ${normalizedUserAddress}. User ${
          hasSubmitted ? 'HAS' : 'HAS NOT'
        } submitted data for key ${submissionKey}.`
      );
      return hasSubmitted;
    }

    logger.debug(
      `Cache miss for user ${normalizedUserAddress}. Querying all DataSubmitted events for this user.`
    );

    try {
      const userSubmissions = await this.getUserSubmissions(
        normalizedUserAddress
      );
      const hasSubmitted = userSubmissions.has(submissionKey);

      logger.technical(
        `User ${normalizedUserAddress} has${
          hasSubmitted ? '' : ' not'
        } submitted data for ${propertyCid}/${dataGroupCid}/${dataCid} (after event query & cache population)`
      );

      return hasSubmitted;
    } catch (error) {
      logger.error(
        `Error querying DataSubmitted events for user ${normalizedUserAddress}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      // Do not populate cache for user on error.
      return false; // Default to false on error.
    }
  }

  async getUserSubmissions(userAddress: string): Promise<Set<string>> {
    const normalizedUserAddress = getAddress(userAddress);
    if (this.userSubmissionsCache.has(normalizedUserAddress)) {
      return this.userSubmissionsCache.get(normalizedUserAddress)!;
    }
    // Event: DataSubmitted(bytes32 indexed propertyHash, bytes32 indexed dataGroupHash, address indexed submitter, bytes32 dataHash)
    // We filter by submitter address only. The indexed parameters are propertyHash, dataGroupHash, submitter.
    // We pass null for the filters we want to ignore.
    const eventFilter = this.submitContract.filters.DataSubmitted(
      null, // propertyHash
      null, // dataGroupHash
      normalizedUserAddress // submitter
    );
    const finalToBlock = await this.getCurrentBlock();
    const events = await this._queryEventsInChunks(
      eventFilter,
      DEFAULT_FROM_BLOCK,
      finalToBlock
    );

    logger.technical(
      `Found ${events.length} total DataSubmitted events for ${normalizedUserAddress}.`
    );

    const userSubmissions = new Set<string>();
    for (const event of events) {
      const args = (event as any).args;
      if (args && args.propertyHash && args.dataGroupHash && args.dataHash) {
        userSubmissions.add(
          `${args.propertyHash}-${args.dataGroupHash}-${args.dataHash}`
        );
      } else {
        logger.warn(
          `Event for ${normalizedUserAddress} found but missing required hash arguments: ${JSON.stringify(
            args
          )}`
        );
      }
    }

    this.userSubmissionsCache.set(normalizedUserAddress, userSubmissions);
    logger.debug(
      `Cached ${userSubmissions.size} unique submissions for user ${normalizedUserAddress}.`
    );

    return userSubmissions;
  }

  private async _queryEventsInChunks(
    eventFilter: any,
    fromBlock: number,
    toBlock: number
  ): Promise<Log[]> {
    const MAX_BLOCK_RANGE = DEFAULT_BLOCK_RANGE;
    let events: Log[] = [];

    logger.technical(
      `Querying events from block ${fromBlock} to ${toBlock} in chunks of ${MAX_BLOCK_RANGE} blocks.`
    );
    for (
      let currentFromBlock = fromBlock;
      currentFromBlock <= toBlock;
      currentFromBlock += MAX_BLOCK_RANGE
    ) {
      const currentToBlock = Math.min(
        currentFromBlock + MAX_BLOCK_RANGE - 1,
        toBlock
      );
      logger.debug(`Querying chunk: ${currentFromBlock} - ${currentToBlock}`);
      try {
        const eventsChunkRaw = await this.submitContract.queryFilter(
          eventFilter,
          currentFromBlock,
          currentToBlock
        );
        events = events.concat(eventsChunkRaw);
      } catch (error) {
        logger.error(
          `Error fetching events for block range ${currentFromBlock}-${currentToBlock}: ${error}`
        );
        throw error;
      }
    }
    return events;
  }
}
