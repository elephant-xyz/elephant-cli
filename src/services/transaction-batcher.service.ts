import {
  ethers,
  Wallet,
  Contract,
  TransactionResponse,
  Overrides,
} from 'ethers';
import { DataItem, BatchSubmissionResult } from '../types/contract.types.js';
import {
  SUBMIT_CONTRACT_ABI_FRAGMENTS,
  SUBMIT_CONTRACT_METHODS,
} from '../config/constants.js';
import {
  DEFAULT_SUBMIT_CONFIG,
  SubmitConfig,
} from '../config/submit.config.js';
import { extractHashFromCID } from '../utils/validation.js';
import { logger } from '../utils/logger.js';

export class TransactionBatcherService {
  private wallet: Wallet;
  private contract: Contract;
  private config: SubmitConfig;
  private nonce: number | undefined;
  private gasPrice: string | number;
  private maxFeePerGas?: string | number;
  private maxPriorityFeePerGas?: string | number;

  constructor(
    rpcUrl: string,
    submitContractAddress: string,
    privateKey: string,
    configOverrides: Partial<SubmitConfig> = {},
    gasPrice: string | number = 'auto',
    maxFeePerGas?: string | number,
    maxPriorityFeePerGas?: string | number
  ) {
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    this.wallet = new Wallet(privateKey, provider);
    this.contract = new Contract(
      submitContractAddress,
      SUBMIT_CONTRACT_ABI_FRAGMENTS,
      this.wallet
    );
    this.config = { ...DEFAULT_SUBMIT_CONFIG, ...configOverrides };
    this.gasPrice = gasPrice;
    this.maxFeePerGas = maxFeePerGas;
    this.maxPriorityFeePerGas = maxPriorityFeePerGas;

    logger.technical(
      `TransactionBatcherService initialized for address: ${this.wallet.address}`
    );
    logger.technical(
      `Interacting with submit contract at: ${submitContractAddress}`
    );

    // Log gas pricing configuration
    if (this.maxFeePerGas !== undefined) {
      logger.technical(
        `EIP-1559 maxFeePerGas: ${this.maxFeePerGas}${this.maxFeePerGas === 'auto' ? '' : ' Gwei'}`
      );
      if (this.maxPriorityFeePerGas !== undefined) {
        logger.technical(
          `EIP-1559 maxPriorityFeePerGas: ${this.maxPriorityFeePerGas}${this.maxPriorityFeePerGas === 'auto' ? '' : ' Gwei'}`
        );
      }
    } else {
      logger.technical(`Gas price setting (legacy): ${this.gasPrice}`);
    }
  }

  /**
   * Prepares DataItem for contract call by converting CIDs to hashes.
   */
  private prepareDataItemForContract(item: DataItem): {
    propertyHash: string;
    dataGroupHash: string;
    dataHash: string;
  } {
    // Strip leading dots from CIDs if present and convert to hashes
    const cleanPropertyCid = item.propertyCid.startsWith('.')
      ? item.propertyCid.substring(1)
      : item.propertyCid;
    const cleanDataGroupCID = item.dataGroupCID.startsWith('.')
      ? item.dataGroupCID.substring(1)
      : item.dataGroupCID;
    const cleanDataCID = item.dataCID.startsWith('.')
      ? item.dataCID.substring(1)
      : item.dataCID;

    return {
      propertyHash: extractHashFromCID(cleanPropertyCid),
      dataGroupHash: extractHashFromCID(cleanDataGroupCID),
      dataHash: extractHashFromCID(cleanDataCID),
    };
  }

  /**
   * Manages nonce for transactions. Fetches initial nonce if not set.
   */
  private async getNonce(): Promise<number> {
    if (this.nonce === undefined) {
      this.nonce = await this.wallet.getNonce('pending');
      logger.info(`Initial nonce set to: ${this.nonce}`);
    }
    return this.nonce++;
  }

  /**
   * Detects if an error is related to nonce issues
   */
  private isNonceError(errorMessage: string): boolean {
    const lowerMessage = errorMessage.toLowerCase();
    return (
      lowerMessage.includes('nonce') ||
      lowerMessage.includes('nonce too low') ||
      lowerMessage.includes('nonce too high') ||
      lowerMessage.includes('nonce has already been used') ||
      lowerMessage.includes('replacement transaction underpriced')
    );
  }

  /**
   * Synchronizes nonce with current blockchain state
   */
  private async synchronizeNonce(): Promise<void> {
    try {
      const currentNonce = await this.wallet.getNonce('pending');
      logger.info(`Synchronized nonce with blockchain: ${currentNonce}`);
      this.nonce = currentNonce;
    } catch (error) {
      logger.error(`Failed to synchronize nonce: ${error}`);
      // Reset to undefined to force fresh fetch on next attempt
      this.nonce = undefined;
    }
  }

  /**
   * Implements transaction batching logic (Task 11.2).
   * Groups items into batches of configured size.
   */
  public groupItemsIntoBatches(items: DataItem[]): DataItem[][] {
    const batches: DataItem[][] = [];
    for (let i = 0; i < items.length; i += this.config.transactionBatchSize) {
      batches.push(items.slice(i, i + this.config.transactionBatchSize));
    }
    logger.info(
      `Grouped ${items.length} items into ${batches.length} batches of up to ${this.config.transactionBatchSize} items each.`
    );
    return batches;
  }

  /**
   * Implements single batch submission (Task 11.3).
   * Submits one batch of items to the contract.
   * Includes gas estimation and retry logic.
   */
  public async submitBatch(
    batchItems: DataItem[]
  ): Promise<BatchSubmissionResult> {
    if (batchItems.length === 0) {
      throw new Error('Cannot submit an empty batch.');
    }
    if (batchItems.length > this.config.transactionBatchSize) {
      throw new Error(
        `Batch size ${batchItems.length} exceeds configured max of ${this.config.transactionBatchSize}`
      );
    }

    const preparedBatch = batchItems.map((item) =>
      this.prepareDataItemForContract(item)
    );
    logger.info(`Submitting batch of ${preparedBatch.length} items.`);

    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        const currentNonce = await this.getNonce();
        logger.debug(`Attempt ${attempt + 1} with nonce ${currentNonce - 1}`); // Nonce was incremented by getNonce

        // Estimate gas
        // TODO: Add more sophisticated gas price optimization if needed
        const estimatedGas =
          await this.contract[
            SUBMIT_CONTRACT_METHODS.SUBMIT_BATCH_DATA
          ].estimateGas(preparedBatch);
        logger.info(`Estimated gas for batch: ${estimatedGas.toString()}`);

        const txOptions: Overrides = {
          gasLimit:
            estimatedGas + BigInt(Math.floor(Number(estimatedGas) * 0.2)), // Add 20% buffer
        };

        // Gas pricing strategy (backward compatible):
        // 1. If EIP-1559 params are provided, use them (Type 2 transaction)
        // 2. Otherwise, use legacy gasPrice (Type 0 transaction)
        // 3. If gasPrice is 'auto', let provider determine pricing
        if (this.maxFeePerGas !== undefined) {
          // EIP-1559 transaction (Type 2)
          if (this.maxFeePerGas !== 'auto') {
            txOptions.maxFeePerGas = ethers.parseUnits(
              this.maxFeePerGas.toString(),
              'gwei'
            );
            logger.info(
              `Using EIP-1559 maxFeePerGas: ${this.maxFeePerGas} Gwei`
            );
          }

          if (
            this.maxPriorityFeePerGas !== undefined &&
            this.maxPriorityFeePerGas !== 'auto'
          ) {
            txOptions.maxPriorityFeePerGas = ethers.parseUnits(
              this.maxPriorityFeePerGas.toString(),
              'gwei'
            );
            logger.info(
              `Using EIP-1559 maxPriorityFeePerGas: ${this.maxPriorityFeePerGas} Gwei`
            );
          }

          if (
            this.maxFeePerGas === 'auto' ||
            this.maxPriorityFeePerGas === 'auto'
          ) {
            const autoParams = [
              this.maxFeePerGas === 'auto' ? 'maxFeePerGas' : null,
              this.maxPriorityFeePerGas === 'auto'
                ? 'maxPriorityFeePerGas'
                : null,
            ]
              .filter(Boolean)
              .join(', ');
            logger.info(
              `Using automatic EIP-1559 fee data from provider for: ${autoParams}`
            );
          }
        } else if (this.gasPrice !== 'auto') {
          // Legacy transaction (Type 0)
          txOptions.gasPrice = ethers.parseUnits(
            this.gasPrice.toString(),
            'gwei'
          );
          logger.info(`Using legacy gas price: ${this.gasPrice} Gwei`);
        } else {
          logger.info('Using automatic gas price from provider.');
        }

        const txResponse: TransactionResponse = await this.contract[
          SUBMIT_CONTRACT_METHODS.SUBMIT_BATCH_DATA
        ](preparedBatch, txOptions);
        logger.info(`Transaction submitted: ${txResponse.hash} (pending)`);

        // Don't wait for confirmation - return immediately with pending status
        // This matches the API mode behavior
        return {
          transactionHash: txResponse.hash,
          blockNumber: undefined,
          gasUsed: undefined,
          itemsSubmitted: batchItems.length,
        };
      } catch (error) {
        lastError = error as Error;
        logger.warn(
          `Batch submission attempt ${attempt + 1} failed: ${lastError.message}`
        );

        // If it's a nonce error, reset nonce and fetch latest from blockchain
        if (this.isNonceError(lastError.message)) {
          logger.warn(
            'Nonce error detected, synchronizing with blockchain state.'
          );
          await this.synchronizeNonce();
        }

        if (attempt < this.config.maxRetries) {
          const delay =
            Math.pow(this.config.retryBackoffMultiplier, attempt) *
            this.config.retryDelay;
          logger.info(`Retrying batch submission in ${delay / 1000}s...`);
          await new Promise((resolve) => setTimeout(resolve, delay));
        } else {
          // If it was the last attempt and it failed, decrement nonce as it wasn't used.
          // This is tricky; if the tx is stuck in mempool, this could be problematic.
          // For now, assume failure means nonce can be reused or re-evaluated.
          // A more robust system might involve checking tx status on chain.
          if (this.nonce !== undefined) this.nonce--;
        }
      }
    }

    logger.error(
      `Failed to submit batch after ${this.config.maxRetries + 1} attempts.`
    );
    throw lastError || new Error('Unknown error during batch submission.');
  }

  /**
   * Implements multi-batch submission (Task 11.4).
   * Submits all items by breaking them into batches and submitting each one.
   * Uses an async generator to yield results for each batch.
   */
  public async *submitAll(
    allItems: DataItem[]
  ): AsyncGenerator<BatchSubmissionResult> {
    const batches = this.groupItemsIntoBatches(allItems);
    logger.info(
      `Starting submission of ${batches.length} batches for ${allItems.length} total items.`
    );

    // Synchronize nonce with blockchain at the beginning of a multi-batch submission sequence
    await this.synchronizeNonce();

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      logger.info(`Processing batch ${i + 1} of ${batches.length}...`);
      try {
        const result = await this.submitBatch(batch);
        yield result;
      } catch (error) {
        logger.error(
          `Failed to submit batch ${i + 1}: ${error instanceof Error ? error.message : String(error)}`
        );
        // Decide on error handling: rethrow, or yield an error object, or skip?
        // For now, rethrow to stop the process. Consumer can decide how to handle.
        // Yielding an error object might be better for partial success scenarios.
        throw error;
      }
    }
    logger.info('All batches processed.');
  }
}
