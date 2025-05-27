import { ethers, Wallet, Contract, TransactionResponse, TransactionReceipt } from 'ethers';
import { DataItem, BatchSubmissionResult } from '../types/contract.types';
import { SUBMIT_CONTRACT_ABI_FRAGMENTS, SUBMIT_CONTRACT_METHODS } from '../config/constants';
import { DEFAULT_SUBMIT_CONFIG, SubmitConfig } from '../config/submit.config';
import { logger } from '../utils/logger';
import { toUtf8Bytes } from 'ethers'; // For converting CIDs to bytes

export class TransactionBatcherService {
  private wallet: Wallet;
  private contract: Contract;
  private config: SubmitConfig;
  private nonce: number | undefined;

  constructor(
    rpcUrl: string,
    submitContractAddress: string,
    privateKey: string,
    configOverrides: Partial<SubmitConfig> = {}
  ) {
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    this.wallet = new Wallet(privateKey, provider);
    this.contract = new Contract(submitContractAddress, SUBMIT_CONTRACT_ABI_FRAGMENTS, this.wallet);
    this.config = { ...DEFAULT_SUBMIT_CONFIG, ...configOverrides };

    logger.info(`TransactionBatcherService initialized for address: ${this.wallet.address}`);
    logger.info(`Interacting with submit contract at: ${submitContractAddress}`);
  }

  /**
   * Prepares DataItem for contract call by converting CIDs to bytes.
   */
  private prepareDataItemForContract(item: DataItem): any {
    return {
      propertyCid: toUtf8Bytes(`.${item.propertyCid}`),
      dataGroupCID: toUtf8Bytes(`.${item.dataGroupCID}`), // Matches contract.types.ts and ABI
      dataCID: toUtf8Bytes(`.${item.dataCID}`),           // Matches contract.types.ts and ABI
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
   * Implements transaction batching logic (Task 11.2).
   * Groups items into batches of configured size.
   */
  public groupItemsIntoBatches(items: DataItem[]): DataItem[][] {
    const batches: DataItem[][] = [];
    for (let i = 0; i < items.length; i += this.config.transactionBatchSize) {
      batches.push(items.slice(i, i + this.config.transactionBatchSize));
    }
    logger.info(`Grouped ${items.length} items into ${batches.length} batches of up to ${this.config.transactionBatchSize} items each.`);
    return batches;
  }

  /**
   * Implements single batch submission (Task 11.3).
   * Submits one batch of items to the contract.
   * Includes gas estimation and retry logic.
   */
  public async submitBatch(batchItems: DataItem[]): Promise<BatchSubmissionResult> {
    if (batchItems.length === 0) {
      throw new Error('Cannot submit an empty batch.');
    }
    if (batchItems.length > this.config.transactionBatchSize) {
      throw new Error(`Batch size ${batchItems.length} exceeds configured max of ${this.config.transactionBatchSize}`);
    }

    const preparedBatch = batchItems.map(item => this.prepareDataItemForContract(item));
    logger.info(`Submitting batch of ${preparedBatch.length} items.`);

    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        const currentNonce = await this.getNonce();
        logger.debug(`Attempt ${attempt + 1} with nonce ${currentNonce -1}`); // Nonce was incremented by getNonce

        // Estimate gas
        // TODO: Add more sophisticated gas price optimization if needed
        const estimatedGas = await this.contract[SUBMIT_CONTRACT_METHODS.SUBMIT_BATCH_DATA].estimateGas(preparedBatch);
        logger.info(`Estimated gas for batch: ${estimatedGas.toString()}`);
        
        const txOptions = {
          gasLimit: estimatedGas + BigInt(Math.floor(Number(estimatedGas) * 0.2)), // Add 20% buffer
          nonce: currentNonce -1, // Use the nonce fetched for this attempt
        };

        const txResponse: TransactionResponse = await this.contract[SUBMIT_CONTRACT_METHODS.SUBMIT_BATCH_DATA](
          preparedBatch,
          txOptions
        );
        logger.info(`Transaction sent: ${txResponse.hash}, waiting for confirmation...`);

        const receipt: TransactionReceipt | null = await txResponse.wait(this.config.chainQueryTimeout); // Wait for 1 confirmation by default

        if (!receipt) {
          throw new Error(`Transaction ${txResponse.hash} timed out or failed to confirm.`);
        }
        
        if (receipt.status === 0) { // 0 means transaction failed
          logger.error(`Transaction ${receipt.hash} failed. Status: ${receipt.status}`);
          throw new Error(`Transaction ${receipt.hash} reverted by EVM.`);
        }

        logger.info(`Transaction confirmed: ${receipt.hash}, Block: ${receipt.blockNumber}`);
        return {
          transactionHash: receipt.hash,
          blockNumber: receipt.blockNumber,
          gasUsed: receipt.gasUsed.toString(),
          itemsSubmitted: batchItems.length,
        };

      } catch (error) {
        lastError = error as Error;
        logger.warn(`Batch submission attempt ${attempt + 1} failed: ${lastError.message}`);
        
        // If it's a nonce error, reset nonce for next attempt
        if (lastError.message.toLowerCase().includes('nonce')) {
            logger.warn('Nonce error detected, resetting nonce for next attempt.');
            this.nonce = undefined; // Force re-fetch
        }

        if (attempt < this.config.maxRetries) {
          const delay = Math.pow(this.config.retryBackoffMultiplier, attempt) * this.config.retryDelay;
          logger.info(`Retrying batch submission in ${delay / 1000}s...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        } else {
          // If it was the last attempt and it failed, decrement nonce as it wasn't used.
          // This is tricky; if the tx is stuck in mempool, this could be problematic.
          // For now, assume failure means nonce can be reused or re-evaluated.
          // A more robust system might involve checking tx status on chain.
          if (this.nonce !== undefined) this.nonce--; 
        }
      }
    }
    
    logger.error(`Failed to submit batch after ${this.config.maxRetries + 1} attempts.`);
    throw lastError || new Error('Unknown error during batch submission.');
  }

  /**
   * Implements multi-batch submission (Task 11.4).
   * Submits all items by breaking them into batches and submitting each one.
   * Uses an async generator to yield results for each batch.
   */
  public async* submitAll(allItems: DataItem[]): AsyncGenerator<BatchSubmissionResult> {
    const batches = this.groupItemsIntoBatches(allItems);
    logger.info(`Starting submission of ${batches.length} batches for ${allItems.length} total items.`);
    
    // Reset nonce at the beginning of a multi-batch submission sequence
    this.nonce = undefined; 

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      logger.info(`Processing batch ${i + 1} of ${batches.length}...`);
      try {
        const result = await this.submitBatch(batch);
        yield result;
      } catch (error) {
        logger.error(`Failed to submit batch ${i + 1}: ${error instanceof Error ? error.message : String(error)}`);
        // Decide on error handling: rethrow, or yield an error object, or skip?
        // For now, rethrow to stop the process. Consumer can decide how to handle.
        // Yielding an error object might be better for partial success scenarios.
        throw error; 
      }
    }
    logger.info('All batches processed.');
  }
}
