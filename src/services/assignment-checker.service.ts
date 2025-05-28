import { BlockchainService } from './blockchain.service.js';
import { OracleAssignment } from '../types/index.js';
import { DEFAULT_CONTRACT_ABI } from '../utils/constants.js';
import { logger } from '../utils/logger.js';

export class AssignmentCheckerService {
  private blockchainService: BlockchainService;
  private assignedCids: Set<string> = new Set();

  constructor(rpcUrl: string, contractAddress: string) {
    this.blockchainService = new BlockchainService(
      rpcUrl,
      contractAddress,
      DEFAULT_CONTRACT_ABI
    );
  }

  /**
   * Fetch and cache all assigned CIDs for a specific elephant address
   */
  async fetchAssignedCids(
    elephantAddress: string,
    fromBlock: number = 0,
    toBlock: number | 'latest' = 'latest'
  ): Promise<Set<string>> {
    logger.technical(
      `Fetching assigned CIDs for elephant ${elephantAddress} from block ${fromBlock} to ${toBlock}`
    );

    try {
      const parsedFromBlock = fromBlock;
      const parsedToBlock =
        toBlock === 'latest'
          ? await this.blockchainService.getCurrentBlock()
          : toBlock;

      logger.technical(
        `Scanning blocks ${parsedFromBlock} to ${parsedToBlock} for assignments`
      );

      const events: OracleAssignment[] =
        await this.blockchainService.getOracleAssignedEvents(
          elephantAddress,
          parsedFromBlock,
          parsedToBlock
        );

      this.assignedCids.clear();
      events.forEach((event) => {
        this.assignedCids.add(event.cid);
      });

      logger.technical(
        `Found ${events.length} assigned CID(s) for elephant ${elephantAddress}`
      );

      return new Set(this.assignedCids);
    } catch (error) {
      logger.error(
        `Error fetching assigned CIDs: ${error instanceof Error ? error.message : String(error)}`
      );
      throw error;
    }
  }

  /**
   * Check if a specific CID is assigned to the elephant
   */
  isCidAssigned(cid: string): boolean {
    return this.assignedCids.has(cid);
  }

  /**
   * Get all assigned CIDs
   */
  getAssignedCids(): Set<string> {
    return new Set(this.assignedCids);
  }

  /**
   * Get count of assigned CIDs
   */
  getAssignedCidsCount(): number {
    return this.assignedCids.size;
  }
}
