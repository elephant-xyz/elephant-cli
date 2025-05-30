import { Contract, JsonRpcProvider, ZeroHash, getAddress } from 'ethers';
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

interface DataQuery {
  propertyCid: string;
  dataGroupCid: string;
}

export class ChainStateService extends BlockchainService {
  private submitContract: Contract;

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
    } catch (error) {
      logger.error(
        `Error fetching current data CID for ${propertyCid}/${dataGroupCid}: ${error instanceof Error ? error.message : String(error)}`
      );
      return null;
    }
  }

  /**
   * Gets the list of participants who have submitted data for a given CIDs combination.
   * @param propertyCid The property CID.
   * @param dataGroupCid The data group CID.
   * @param dataCid The data CID.
   * @returns An array of participant addresses.
   */
  async getSubmittedParticipants(
    propertyCid: string,
    dataGroupCid: string,
    dataCid: string
  ): Promise<string[]> {
    try {
      // Convert CIDs to hashes for contract call
      const propertyHash = extractHashFromCID(propertyCid);
      const dataGroupHash = extractHashFromCID(dataGroupCid);
      const dataHash = extractHashFromCID(dataCid);

      const participants: string[] = await this.submitContract[
        SUBMIT_CONTRACT_METHODS.GET_PARTICIPANTS_FOR_CONSENSUS_DATA_HASH
      ](propertyHash, dataGroupHash, dataHash);
      logger.technical(
        `Fetched submitted participants for ${propertyCid}/${dataGroupCid}/${dataCid}. Submitted participants: ${participants.join(', ')}`
      );

      return participants.map((addr) => getAddress(addr));
    } catch (error) {
      logger.error(
        `Error fetching submitted participants for ${propertyCid}/${dataGroupCid}/${dataCid}: ${error instanceof Error ? error.message : String(error)}`
      );
      return [];
    }
  }

  /**
   * Batch gets current data CIDs for multiple items.
   * @param items Array of DataQuery objects.
   * @returns A map where keys are combined CIDs (propertyCid/dataGroupCid) and values are data CIDs.
   */
  async batchGetCurrentDataCids(
    items: DataQuery[]
  ): Promise<Map<string, string | null>> {
    const results = new Map<string, string | null>();

    const promises = items.map(async (item) => {
      const dataCid = await this.getCurrentDataCid(
        item.propertyCid,
        item.dataGroupCid
      );
      const key = `${item.propertyCid}/${item.dataGroupCid}`;
      results.set(key, dataCid);
    });

    try {
      await Promise.all(promises);
    } catch (error) {
      logger.error(
        `Error in batchGetCurrentDataCids: ${error instanceof Error ? error.message : String(error)}`
      );
      return results;
    }

    return results;
  }

  /**
   * Checks if a specific user has already submitted data for the given CIDs combination.
   * @param userAddress The user's wallet address.
   * @param propertyCid The property CID.
   * @param dataGroupCid The data group CID.
   * @param dataCid The data CID.
   * @returns True if the user has already submitted this data.
   */
  async hasUserSubmittedData(
    userAddress: string,
    propertyCid: string,
    dataGroupCid: string,
    dataCid: string
  ): Promise<boolean> {
    try {
      // Convert CIDs to hashes for contract call
      const propertyHash = extractHashFromCID(propertyCid);
      const dataGroupHash = extractHashFromCID(dataGroupCid);
      const dataHash = extractHashFromCID(dataCid);
      const normalizedUserAddress = getAddress(userAddress);

      const hasSubmitted: boolean = await this.submitContract[
        SUBMIT_CONTRACT_METHODS.HAS_USER_SUBMITTED_DATA_HASH
      ](propertyHash, dataGroupHash, dataHash, normalizedUserAddress);

      logger.technical(
        `Hash values - propertyHash: ${propertyHash}, dataGroupHash: ${dataGroupHash}, dataHash: ${dataHash}, userAddress: ${normalizedUserAddress}`
      );
      logger.technical(
        `User ${normalizedUserAddress} has${hasSubmitted ? '' : ' not'} submitted data for ${propertyCid}/${dataGroupCid}/${dataCid}`
      );

      return hasSubmitted;
    } catch (error) {
      logger.error(
        `Error checking if user ${userAddress} has submitted data for ${propertyCid}/${dataGroupCid}/${dataCid}: ${error instanceof Error ? error.message : String(error)}`
      );
      return false; // Default to false to allow submission if check fails
    }
  }
}
