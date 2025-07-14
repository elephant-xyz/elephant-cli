import { writeFileSync } from 'fs';
import { dirname } from 'path';
import { mkdir } from 'fs/promises';
import { ethers } from 'ethers';
import { DataItem } from '../types/contract.types.js';
import { EIP1474Transaction } from '../types/submit.types.js';
import {
  SUBMIT_CONTRACT_ABI_FRAGMENTS,
  SUBMIT_CONTRACT_METHODS,
} from '../config/constants.js';
import { extractHashFromCID } from '../utils/validation.js';
import { logger } from '../utils/logger.js';

export class UnsignedTransactionJsonService {
  private jsonPath: string;
  private contractAddress: string;
  private gasPrice: string | number;
  private chainId: number;
  private startingNonce: number;

  constructor(
    jsonPath: string,
    contractAddress: string,
    gasPrice: string | number = 'auto',
    chainId: number = 137, // Polygon mainnet
    startingNonce: number = 0
  ) {
    this.jsonPath = jsonPath;
    this.contractAddress = contractAddress;
    this.gasPrice = gasPrice;
    this.chainId = chainId;
    this.startingNonce = startingNonce;
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
   * Creates EIP-1474 compliant transaction object for a batch of items
   */
  private async createEIP1474Transaction(
    batchItems: DataItem[],
    userAddress: string,
    nonce: number,
    gasLimit: string,
    provider?: ethers.JsonRpcProvider
  ): Promise<EIP1474Transaction> {
    const preparedBatch = batchItems.map((item) =>
      this.prepareDataItemForContract(item)
    );

    // Create contract interface to encode function data
    const contractInterface = new ethers.Interface(
      SUBMIT_CONTRACT_ABI_FRAGMENTS
    );
    const functionData = contractInterface.encodeFunctionData(
      SUBMIT_CONTRACT_METHODS.SUBMIT_BATCH_DATA,
      [preparedBatch]
    );

    // Create EIP-1474 compliant transaction object
    // All values must be hex-encoded with 0x prefix
    const transaction: EIP1474Transaction = {
      from: userAddress,
      to: this.contractAddress,
      gas: `0x${BigInt(gasLimit).toString(16)}`,
      value: '0x0',
      data: functionData,
      nonce: `0x${nonce.toString(16)}`,
    };

    // Add gas pricing based on transaction type
    if (this.gasPrice === 'auto') {
      // EIP-1559 transaction (type 2)
      transaction.type = '0x2';

      // Fetch dynamic fee data from provider if available
      if (provider) {
        try {
          const feeData = await provider.getFeeData();
          if (feeData.maxFeePerGas && feeData.maxPriorityFeePerGas) {
            transaction.maxFeePerGas = `0x${feeData.maxFeePerGas.toString(16)}`;
            transaction.maxPriorityFeePerGas = `0x${feeData.maxPriorityFeePerGas.toString(16)}`;
          } else {
            // Fallback to reasonable defaults if provider doesn't support EIP-1559
            transaction.maxFeePerGas = `0x${ethers.parseUnits('50', 'gwei').toString(16)}`;
            transaction.maxPriorityFeePerGas = `0x${ethers.parseUnits('2', 'gwei').toString(16)}`;
          }
        } catch (error) {
          logger.warn(
            `Failed to fetch fee data from provider: ${error instanceof Error ? error.message : String(error)}`
          );
          // Fallback to defaults
          transaction.maxFeePerGas = `0x${ethers.parseUnits('50', 'gwei').toString(16)}`;
          transaction.maxPriorityFeePerGas = `0x${ethers.parseUnits('2', 'gwei').toString(16)}`;
        }
      } else {
        // Fallback to defaults if no provider is available
        transaction.maxFeePerGas = `0x${ethers.parseUnits('50', 'gwei').toString(16)}`;
        transaction.maxPriorityFeePerGas = `0x${ethers.parseUnits('2', 'gwei').toString(16)}`;
      }
    } else {
      // Legacy transaction (type 0)
      transaction.type = '0x0';
      transaction.gasPrice = `0x${ethers.parseUnits(this.gasPrice.toString(), 'gwei').toString(16)}`;
    }

    return transaction;
  }

  /**
   * Estimates gas for a batch of items
   */
  public async estimateGasForBatch(
    batchItems: DataItem[],
    rpcUrl: string
  ): Promise<string> {
    try {
      const provider = new ethers.JsonRpcProvider(rpcUrl);
      const contract = new ethers.Contract(
        this.contractAddress,
        SUBMIT_CONTRACT_ABI_FRAGMENTS,
        provider
      );

      const preparedBatch = batchItems.map((item) =>
        this.prepareDataItemForContract(item)
      );

      const estimatedGas =
        await contract[SUBMIT_CONTRACT_METHODS.SUBMIT_BATCH_DATA].estimateGas(
          preparedBatch
        );

      // Add 20% buffer
      const gasWithBuffer =
        estimatedGas + BigInt(Math.floor(Number(estimatedGas) * 0.2));
      return gasWithBuffer.toString();
    } catch (error) {
      logger.warn(
        `Gas estimation failed: ${error instanceof Error ? error.message : String(error)}`
      );
      // Return a reasonable default if estimation fails
      return '500000'; // 500k gas as fallback
    }
  }

  /**
   * Generates unsigned transactions JSON for batches of items
   */
  public async generateUnsignedTransactionsJson(
    batches: DataItem[][],
    rpcUrl: string,
    userAddress: string
  ): Promise<void> {
    try {
      // Ensure directory exists
      await mkdir(dirname(this.jsonPath), { recursive: true });

      // Get starting nonce from provider if we have an RPC URL
      let currentNonce = this.startingNonce;
      let provider: ethers.JsonRpcProvider | undefined;
      if (rpcUrl && userAddress) {
        try {
          provider = new ethers.JsonRpcProvider(rpcUrl);
          currentNonce = await provider.getTransactionCount(
            userAddress,
            'pending'
          );
          logger.info(`Starting nonce from provider: ${currentNonce}`);
        } catch (error) {
          logger.warn(
            `Failed to get nonce from provider, using default: ${currentNonce}`
          );
          provider = undefined; // Reset provider on error
        }
      }

      const transactions: EIP1474Transaction[] = [];

      // Process each batch
      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        logger.info(
          `Generating unsigned transaction for batch ${i + 1} of ${batches.length} (${batch.length} items)`
        );

        // Estimate gas for this batch
        const gasLimit = await this.estimateGasForBatch(batch, rpcUrl);

        // Create EIP-1474 compliant transaction
        const transaction = await this.createEIP1474Transaction(
          batch,
          userAddress,
          currentNonce + i,
          gasLimit,
          provider
        );

        transactions.push(transaction);
      }

      // Write JSON file
      const jsonOutput = JSON.stringify(transactions, null, 2);
      writeFileSync(this.jsonPath, jsonOutput, 'utf-8');
      logger.success(`Unsigned transactions JSON written to: ${this.jsonPath}`);
      logger.info(
        `Generated ${transactions.length} unsigned transactions for ${batches.reduce((sum, batch) => sum + batch.length, 0)} total items`
      );
    } catch (error) {
      const errorMsg = `Failed to generate unsigned transactions JSON: ${error instanceof Error ? error.message : String(error)}`;
      logger.error(errorMsg);
      throw new Error(errorMsg);
    }
  }
}
