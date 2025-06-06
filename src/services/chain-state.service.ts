import { Contract, JsonRpcProvider, ZeroHash, getAddress, Log } from 'ethers';
import { BlockchainService } from './blockchain.service.js';
import { ABI } from '../types/index.js';
import {
  SUBMIT_CONTRACT_ABI_FRAGMENTS,
  SUBMIT_CONTRACT_METHODS,
} from '../config/constants.js';
import {
  isValidCID,
  extractHashFromCID,
  deriveCIDFromHash,
} from '../utils/validation.js';
import { logger } from '../utils/logger.js';
import { DEFAULT_BLOCK_RANGE, DEFAULT_FROM_BLOCK } from '../utils/constants.js';

interface DataQuery {
  propertyCid: string;
  dataGroupCid: string;
}

export class ChainStateService extends BlockchainService {
  private submitContract: Contract;
  private userSubmissionsCache: Map<string, Set<string>> = new Map();

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
    try {
      // Convert CIDs to hashes for contract call
      const propertyHash = extractHashFromCID(propertyCid);
      const dataGroupHash = extractHashFromCID(dataGroupCid);

      const returnedHash: string = await this.submitContract[
        SUBMIT_CONTRACT_METHODS.GET_CURRENT_FIELD_DATA_HASH
      ](propertyHash, dataGroupHash);

      if (
        !returnedHash ||
        returnedHash === '0x' ||
        returnedHash === ZeroHash ||
        returnedHash ===
        '0x0000000000000000000000000000000000000000000000000000000000000000'
      ) {
        logger.debug(
          `No data hash found on-chain for property ${propertyCid}, group ${dataGroupCid}`
        );
        return null;
      }

      // Convert hash back to CID
      const cidString = deriveCIDFromHash(returnedHash);

      if (isValidCID(cidString)) {
        return cidString;
      } else {
        logger.warn(
          `Invalid data CID derived from hash: ${cidString} (raw hash: ${returnedHash}) for property ${propertyCid}, group ${dataGroupCid}`
        );
        return null;
      }
    } catch (error: unknown) {
      if (error instanceof AggregateError) {
        logger.error(
          `Error fetching current data CID for ${propertyCid}/${dataGroupCid}: ${error.errors.map((e) => e.message).join(', ')}`
        );
        return null;
      }
      logger.error(
        `Error fetching current data CID for ${propertyCid}/${dataGroupCid}: ${error instanceof Error ? error.message : String(error)}`
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
      const submittedDataHashes =
        this.userSubmissionsCache.get(normalizedUserAddress)!;
      const hasSubmitted = submittedDataHashes.has(submissionKey);
      logger.debug(
        `Cache hit for user ${normalizedUserAddress}. User ${hasSubmitted ? 'HAS' : 'HAS NOT'
        } submitted data for key ${submissionKey}.`
      );
      return hasSubmitted;
    }

    logger.debug(
      `Cache miss for user ${normalizedUserAddress}. Querying all DataSubmitted events for this user.`
    );

    try {
      const userSubmissions = await this.getUserSubmissions(normalizedUserAddress);
      const hasSubmitted = userSubmissions.has(submissionKey);

      logger.technical(
        `User ${normalizedUserAddress} has${hasSubmitted ? '' : ' not'
        } submitted data for ${propertyCid}/${dataGroupCid}/${dataCid} (after event query & cache population)`
      );

      return hasSubmitted;
    } catch (error) {
      logger.error(
        `Error querying DataSubmitted events for user ${normalizedUserAddress}: ${error instanceof Error ? error.message : String(error)
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
    const MAX_BLOCK_RANGE = DEFAULT_BLOCK_RANGE;
    const finalToBlock = await this.getCurrentBlock();
    let events: Log[] = [];

    logger.technical(
      `Querying DataSubmitted events for user: ${normalizedUserAddress} from block ${DEFAULT_FROM_BLOCK} to ${finalToBlock} in chunks of ${MAX_BLOCK_RANGE} blocks.`
    );
    for (
      let currentFromBlock = DEFAULT_FROM_BLOCK;
      currentFromBlock <= finalToBlock;
      currentFromBlock += MAX_BLOCK_RANGE
    ) {
      const currentToBlock = Math.min(
        currentFromBlock + MAX_BLOCK_RANGE - 1,
        finalToBlock
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
}
