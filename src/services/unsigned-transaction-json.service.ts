import { writeFileSync } from 'fs';
import { dirname } from 'path';
import { mkdir } from 'fs/promises';
import { ethers } from 'ethers';
import { DataItem } from '../types/contract.types.js';
import { EIP1474Transaction } from '../types/submit.types.js';
import {
  SUBMIT_CONTRACT_ABI_FRAGMENTS,
  SUBMIT_CONTRACT_METHODS,
  GAS_ESTIMATION_BUFFER,
  FALLBACK_GAS_LIMIT,
  DEFAULT_MAX_FEE_PER_GAS_GWEI,
  DEFAULT_MAX_PRIORITY_FEE_PER_GAS_GWEI,
  MIN_PRIORITY_FEE_GWEI,
} from '../config/constants.js';
import { extractHashFromCID } from '../utils/validation.js';
import { logger } from '../utils/logger.js';

export class UnsignedTransactionJsonService {
  private jsonPath: string;
  private contractAddress: string;
  private gasPrice: string | number;
  private startingNonce: number;

  constructor(
    jsonPath: string,
    contractAddress: string,
    gasPrice: string | number = 'auto',
    _chainId: number = 137, // Polygon mainnet - kept for backward compatibility but not used
    startingNonce: number = 0
  ) {
    this.jsonPath = jsonPath;
    this.contractAddress = contractAddress;
    this.gasPrice = gasPrice;
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
    provider: ethers.JsonRpcProvider
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

    // Estimate gas using direct eth_estimateGas RPC call
    let gasLimit: string;
    try {
      const gasEstimateParams = [
        {
          from: userAddress,
          to: this.contractAddress,
          data: functionData,
          value: '0x0',
        },
        'latest',
      ];

      const estimatedGasHex = await provider.send(
        'eth_estimateGas',
        gasEstimateParams
      );
      const estimatedGas = BigInt(estimatedGasHex);

      // Add buffer for safety
      const gasWithBuffer =
        estimatedGas +
        BigInt(Math.floor(Number(estimatedGas) * GAS_ESTIMATION_BUFFER));
      gasLimit = `0x${gasWithBuffer.toString(16)}`;

      logger.technical(
        `Gas estimated: ${estimatedGas}, with ${GAS_ESTIMATION_BUFFER * 100}% buffer: ${gasWithBuffer}`
      );
    } catch (error) {
      logger.warn(
        `Gas estimation via eth_estimateGas failed: ${error instanceof Error ? error.message : String(error)}`
      );
      // Fallback to reasonable default
      gasLimit = `0x${BigInt(FALLBACK_GAS_LIMIT).toString(16)}`; // Fallback gas limit with buffer included
    }

    // Create EIP-1474 compliant transaction object
    // Always use EIP-1559 Type 2 transactions (no legacy support)
    const transaction: EIP1474Transaction = {
      from: userAddress,
      to: this.contractAddress,
      gas: gasLimit,
      value: '0x0',
      data: functionData,
      nonce: `0x${nonce.toString(16)}`,
      type: '0x2', // Always EIP-1559 Type 2
    };

    // Set gas pricing for EIP-1559 transaction
    if (this.gasPrice === 'auto') {
      // Fetch dynamic fee data from provider
      try {
        const feeData = await provider.getFeeData();
        if (feeData.maxFeePerGas && feeData.maxPriorityFeePerGas) {
          transaction.maxFeePerGas = `0x${feeData.maxFeePerGas.toString(16)}`;
          transaction.maxPriorityFeePerGas = `0x${feeData.maxPriorityFeePerGas.toString(16)}`;
        } else {
          // Fallback to reasonable defaults if provider doesn't support EIP-1559
          transaction.maxFeePerGas = `0x${ethers.parseUnits(DEFAULT_MAX_FEE_PER_GAS_GWEI, 'gwei').toString(16)}`;
          transaction.maxPriorityFeePerGas = `0x${ethers.parseUnits(DEFAULT_MAX_PRIORITY_FEE_PER_GAS_GWEI, 'gwei').toString(16)}`;
        }
      } catch (error) {
        logger.warn(
          `Failed to fetch fee data from provider: ${error instanceof Error ? error.message : String(error)}`
        );
        // Fallback to defaults
        transaction.maxFeePerGas = `0x${ethers.parseUnits(DEFAULT_MAX_FEE_PER_GAS_GWEI, 'gwei').toString(16)}`;
        transaction.maxPriorityFeePerGas = `0x${ethers.parseUnits(DEFAULT_MAX_PRIORITY_FEE_PER_GAS_GWEI, 'gwei').toString(16)}`;
      }
    } else {
      // Convert numeric gas price to EIP-1559 format
      const gasPrice = ethers.parseUnits(this.gasPrice.toString(), 'gwei');
      transaction.maxFeePerGas = `0x${gasPrice.toString(16)}`;
      // Use 10% of maxFeePerGas as priority fee, minimum MIN_PRIORITY_FEE_GWEI
      const priorityFee = BigInt(
        Math.max(
          Number(gasPrice) * 0.1,
          Number(ethers.parseUnits(MIN_PRIORITY_FEE_GWEI, 'gwei'))
        )
      );
      transaction.maxPriorityFeePerGas = `0x${priorityFee.toString(16)}`;
    }

    return transaction;
  }

  /**
   * Generates unsigned transactions for batches of items and returns them
   */
  public async generateUnsignedTransactions(
    batches: DataItem[][],
    rpcUrl: string,
    userAddress: string
  ): Promise<EIP1474Transaction[]> {
    // Create provider - required for gas estimation and nonce fetching
    const provider = new ethers.JsonRpcProvider(rpcUrl);

    // Get starting nonce from provider
    let currentNonce = this.startingNonce;
    try {
      currentNonce = await provider.getTransactionCount(userAddress, 'pending');
      logger.info(`Starting nonce from provider: ${currentNonce}`);
    } catch (error) {
      logger.warn(
        `Failed to get nonce from provider, using default: ${currentNonce}`
      );
      // Continue with default nonce but keep provider for gas estimation
    }

    const transactions: EIP1474Transaction[] = [];

    // Process each batch
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      logger.info(
        `Generating unsigned transaction for batch ${i + 1} of ${batches.length} (${batch.length} items)`
      );

      // Create EIP-1474 compliant transaction (gas estimation is now internal)
      const transaction = await this.createEIP1474Transaction(
        batch,
        userAddress,
        currentNonce + i,
        provider
      );

      transactions.push(transaction);
    }

    return transactions;
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

      // Generate the transactions
      const transactions = await this.generateUnsignedTransactions(
        batches,
        rpcUrl,
        userAddress
      );

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
