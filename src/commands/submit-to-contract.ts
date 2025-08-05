import { Command } from 'commander';
import { readFileSync, writeFileSync } from 'fs';
import path from 'path';
import chalk from 'chalk';
import { parse } from 'csv-parse/sync';
import {
  DEFAULT_RPC_URL,
  DEFAULT_CONTRACT_ADDRESS,
  SUBMIT_CONTRACT_ABI_FRAGMENTS,
  POLYGON_MAINNET_CHAIN_ID,
  ZERO_ADDRESS,
} from '../config/constants.js';
import { createSubmitConfig } from '../config/submit.config.js';
import { logger } from '../utils/logger.js';
import { ChainStateService } from '../services/chain-state.service.js';
import { TransactionBatcherService } from '../services/transaction-batcher.service.js';
import { CsvReporterService } from '../services/csv-reporter.service.js';
import { UnsignedTransactionJsonService } from '../services/unsigned-transaction-json.service.js';
import { SimpleProgress } from '../utils/simple-progress.js';
import { DataItem } from '../types/contract.types.js';
import { Wallet } from 'ethers';
import { ApiSubmissionService } from '../services/api-submission.service.js';
import { TransactionStatusService } from '../services/transaction-status.service.js';
import { TransactionStatusReporterService } from '../services/transaction-status-reporter.service.js';
import { ApiSubmissionResult } from '../types/submit.types.js';

export interface SubmitToContractCommandOptions {
  rpcUrl: string;
  contractAddress: string;
  privateKey: string;
  csvFile: string;
  transactionBatchSize?: number;
  gasPrice: string | number;
  dryRun: boolean;
  unsignedTransactionsJson?: string;
  fromAddress?: string;
  domain?: string;
  apiKey?: string;
  oracleKeyId?: string;
  checkEligibility?: boolean;
  transactionIdsCsv?: string;
}

interface CsvRecord {
  propertyCid: string;
  dataGroupCid: string;
  dataCid: string;
  filePath: string;
  uploadedAt: string;
}

interface SubmissionCheckResult {
  canSubmit: boolean;
  reason?: string;
  dataItem?: DataItem;
}

interface TransactionRecord {
  transactionHash: string;
  batchIndex: number;
  itemCount: number;
  timestamp: string;
  status: string;
}

export function registerSubmitToContractCommand(program: Command) {
  program
    .command('submit-to-contract <csvFile>')
    .description(
      'Submit data hashes from CSV file to the Elephant Network smart contract'
    )
    .option(
      '-k, --private-key <key>',
      'Private key for the submitting wallet. (Or set ELEPHANT_PRIVATE_KEY env var)'
    )
    .option(
      '--rpc-url <url>',
      'RPC URL for the blockchain network.',
      process.env.RPC_URL || DEFAULT_RPC_URL
    )
    .option(
      '--contract-address <address>',
      'Address of the submit smart contract.',
      process.env.SUBMIT_CONTRACT_ADDRESS || DEFAULT_CONTRACT_ADDRESS
    )
    .option(
      '--transaction-batch-size <number>',
      'Number of items per blockchain transaction (default: 200)'
    )
    .option(
      '--gas-price <value>',
      "Gas price in Gwei ('auto' or a number, default: 30)",
      '30'
    )
    .option(
      '--dry-run',
      'Perform all checks without submitting transactions.',
      false
    )
    .option(
      '--unsigned-transactions-json <path>',
      'Generate JSON file with unsigned transactions for later signing and submission (dry-run mode only)'
    )
    .option(
      '--from-address <address>',
      'Address to use as "from" field in unsigned transactions (makes private key optional for unsigned transaction generation)'
    )
    .option(
      '--domain <domain>',
      'Domain for centralized API submission (e.g., oracles.staircaseapi.com)'
    )
    .option('--api-key <key>', 'API key for centralized submission')
    .option('--oracle-key-id <id>', 'Oracle key ID for centralized submission')
    .option(
      '--check-eligibility',
      'Enable eligibility checks to verify if data has reached consensus or if user has already submitted (slower but safer)',
      false
    )
    .option(
      '--transaction-ids-csv <path>',
      'Output CSV file for transaction IDs (default: transaction-ids-{timestamp}.csv in reports directory)'
    )
    .action(async (csvFile, options) => {
      if (
        options.gasPrice !== 'auto' &&
        (isNaN(parseFloat(options.gasPrice)) || !isFinite(options.gasPrice))
      ) {
        const errorMsg =
          'Error: Invalid gas-price. Must be a number or "auto".';
        logger.error(errorMsg);
        console.error(errorMsg);
        process.exit(1);
      }

      const gasPrice =
        options.gasPrice === 'auto' ? 'auto' : parseFloat(options.gasPrice);

      // Validate unsigned transactions JSON option
      if (options.unsignedTransactionsJson && !options.dryRun) {
        const errorMsg =
          'Error: --unsigned-transactions-json can only be used with --dry-run mode.';
        logger.error(errorMsg);
        console.error(errorMsg);
        process.exit(1);
      }

      // Validate API parameters - all three must be provided together
      const apiParamsCount = [
        options.domain,
        options.apiKey,
        options.oracleKeyId,
      ].filter(Boolean).length;
      if (apiParamsCount > 0 && apiParamsCount < 3) {
        const errorMsg =
          'Error: When using centralized API submission, all three parameters must be provided: --domain, --api-key, and --oracle-key-id';
        logger.error(errorMsg);
        console.error(errorMsg);
        process.exit(1);
      }

      const isApiMode = apiParamsCount === 3;

      // Handle private key from environment
      if (!isApiMode) {
        options.privateKey =
          options.privateKey || process.env.ELEPHANT_PRIVATE_KEY;
      } else if (process.env.ELEPHANT_PRIVATE_KEY && !options.privateKey) {
        // In API mode with env var set but no CLI private key
        console.log(
          chalk.yellow(
            'Note: Ignoring ELEPHANT_PRIVATE_KEY environment variable in API mode'
          )
        );
        logger.info(
          'API mode detected, ignoring ELEPHANT_PRIVATE_KEY environment variable'
        );
      }

      // Validate from-address format if provided
      if (
        options.fromAddress &&
        !options.fromAddress.match(/^0x[a-fA-F0-9]{40}$/)
      ) {
        const errorMsg =
          'Error: Invalid from-address format. Must be a valid Ethereum address.';
        logger.error(errorMsg);
        console.error(errorMsg);
        process.exit(1);
      }

      // Private key is optional when generating unsigned transactions with --from-address or using API mode
      const isUnsignedTransactionMode =
        options.unsignedTransactionsJson &&
        options.dryRun &&
        options.fromAddress;

      if (!options.privateKey && !isUnsignedTransactionMode && !isApiMode) {
        const errorMsg =
          'Error: Private key is required when not using API mode. Provide via --private-key or ELEPHANT_PRIVATE_KEY env var.';
        logger.error(errorMsg);
        console.error(errorMsg);
        process.exit(1);
      }

      // Ensure private key is not used with API mode
      if (options.privateKey && isApiMode) {
        // Check if private key was explicitly provided via CLI (not from env)
        const wasExplicitlyProvided =
          process.argv.includes('--private-key') || process.argv.includes('-k');
        if (wasExplicitlyProvided) {
          const errorMsg =
            'Error: Private key should not be provided when using API mode (--domain, --api-key, --oracle-key-id).';
          logger.error(errorMsg);
          console.error(errorMsg);
          process.exit(1);
        }
        // Clear any private key in API mode
        options.privateKey = '';
      }

      options.transactionBatchSize =
        parseInt(options.transactionBatchSize, 10) || 200;

      const commandOptions: SubmitToContractCommandOptions = {
        ...options,
        csvFile: path.resolve(csvFile),
        gasPrice,
        unsignedTransactionsJson: options.unsignedTransactionsJson
          ? path.resolve(options.unsignedTransactionsJson)
          : undefined,
        fromAddress: options.fromAddress,
        domain: options.domain,
        apiKey: options.apiKey,
        oracleKeyId: options.oracleKeyId,
        checkEligibility: options.checkEligibility || false,
        transactionIdsCsv: options.transactionIdsCsv
          ? path.resolve(options.transactionIdsCsv)
          : undefined,
      };

      await handleSubmitToContract(commandOptions);
    });
}

async function checkSubmissionEligibility(
  record: CsvRecord,
  chainStateService: ChainStateService,
  userAddress: string,
  performChecks: boolean = false
): Promise<SubmissionCheckResult> {
  // By default, skip expensive blockchain checks unless explicitly requested
  if (!performChecks) {
    return {
      canSubmit: true,
      dataItem: {
        propertyCid: record.propertyCid,
        dataGroupCID: record.dataGroupCid,
        dataCID: record.dataCid,
      },
    };
  }

  try {
    // Check if the latest consensus data hash differs from the one being submitted
    const currentDataCid = await chainStateService.getCurrentDataCid(
      record.propertyCid,
      record.dataGroupCid
    );

    if (currentDataCid === record.dataCid) {
      return {
        canSubmit: false,
        reason: `Data CID ${record.dataCid} already exists on chain for property ${record.propertyCid}, dataGroup ${record.dataGroupCid}`,
      };
    }

    // Check if user has previously submitted this specific property-data group pair with the same hash
    const hasUserSubmitted = await chainStateService.hasUserSubmittedData(
      userAddress,
      record.propertyCid,
      record.dataGroupCid,
      record.dataCid
    );

    if (hasUserSubmitted) {
      return {
        canSubmit: false,
        reason: `User has already submitted data CID ${record.dataCid} for property ${record.propertyCid}, dataGroup ${record.dataGroupCid}`,
      };
    }

    return {
      canSubmit: true,
      dataItem: {
        propertyCid: record.propertyCid,
        dataGroupCID: record.dataGroupCid,
        dataCID: record.dataCid,
      },
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return {
      canSubmit: false,
      reason: `Error checking submission eligibility: ${errorMsg}`,
    };
  }
}

export interface SubmitToContractServiceOverrides {
  chainStateService?: ChainStateService;
  transactionBatcherService?: TransactionBatcherService;
  csvReporterService?: CsvReporterService;
  unsignedTransactionJsonService?: UnsignedTransactionJsonService;
  progressTracker?: SimpleProgress;
  apiSubmissionService?: ApiSubmissionService;
  transactionStatusService?: TransactionStatusService;
  transactionStatusReporter?: TransactionStatusReporterService;
}

async function processRecord(
  record: CsvRecord,
  chainStateService: ChainStateService,
  userAddress: string,
  progressTracker: SimpleProgress,
  csvReporterService: CsvReporterService,
  performChecks: boolean = false
): Promise<{ record: CsvRecord; checkResult: SubmissionCheckResult }> {
  const checkResult = await checkSubmissionEligibility(
    record,
    chainStateService,
    userAddress,
    performChecks
  );

  if (checkResult.canSubmit && checkResult.dataItem) {
    progressTracker.increment('processed');
  } else {
    await csvReporterService.logWarning({
      propertyCid: record.propertyCid,
      dataGroupCid: record.dataGroupCid,
      filePath: record.filePath,
      reason: checkResult.reason || 'Unknown reason',
      timestamp: new Date().toISOString(),
    });
    progressTracker.increment('skipped');
  }
  return { record, checkResult };
}

export async function handleSubmitToContract(
  options: SubmitToContractCommandOptions,
  serviceOverrides: SubmitToContractServiceOverrides = {}
) {
  console.log(chalk.bold.blue('🐘 Elephant Network CLI - Submit to Contract'));
  console.log();

  const isApiMode = !!(options.domain && options.apiKey && options.oracleKeyId);

  if (options.dryRun) {
    logger.warn('DRY RUN MODE: No transactions will be sent');
  }

  if (options.checkEligibility) {
    console.log(
      chalk.yellow(
        'Eligibility checks enabled - this will perform additional blockchain queries'
      )
    );
    logger.info('Eligibility checks enabled');
  } else {
    logger.info(
      'Eligibility checks disabled (default) - skipping consensus and submission history verification'
    );
  }

  if (isApiMode) {
    console.log(chalk.yellow('Using centralized API submission mode'));
    logger.info('Using centralized API submission mode');
    logger.technical(`API Domain: ${options.domain}`);
    logger.technical(`Oracle Key ID: ${options.oracleKeyId}`);
  }

  logger.technical(`CSV file: ${options.csvFile}`);
  logger.technical(`RPC URL: ${options.rpcUrl}`);
  logger.technical(`Contract: ${options.contractAddress}`);
  logger.technical(`Transaction batch size: ${options.transactionBatchSize}`);
  logger.technical(`Gas price: ${options.gasPrice}`);

  const config = createSubmitConfig({
    transactionBatchSize: options.transactionBatchSize,
  });

  // Create mock services when eligibility checks are disabled, in dry-run mode, or API mode to avoid blockchain calls
  const chainStateService =
    serviceOverrides.chainStateService ??
    (!options.checkEligibility || options.dryRun || isApiMode
      ? ({
          prepopulateConsensusCache: async () => {},
          getUserSubmissions: async () => new Set<string>(),
          getCurrentDataCid: async () => null,
          hasUserSubmittedData: async () => false,
        } as any)
      : new ChainStateService(
          options.rpcUrl,
          options.contractAddress,
          options.contractAddress,
          SUBMIT_CONTRACT_ABI_FRAGMENTS,
          SUBMIT_CONTRACT_ABI_FRAGMENTS
        ));

  const transactionBatcherService =
    serviceOverrides.transactionBatcherService ??
    (options.dryRun || isApiMode
      ? ({
          groupItemsIntoBatches: (items: DataItem[]) => {
            const batchSize = options.transactionBatchSize || 200;
            const batches: DataItem[][] = [];
            for (let i = 0; i < items.length; i += batchSize) {
              batches.push(items.slice(i, i + batchSize));
            }
            return batches;
          },
          submitAll: async function* () {
            // No-op generator for dry-run and API mode
          },
        } as any)
      : new TransactionBatcherService(
          options.rpcUrl,
          options.contractAddress,
          options.privateKey,
          config,
          options.gasPrice
        ));
  const csvReporterService =
    serviceOverrides.csvReporterService ??
    new CsvReporterService(config.errorCsvPath, config.warningCsvPath);

  const unsignedTransactionJsonService =
    serviceOverrides.unsignedTransactionJsonService ??
    (options.unsignedTransactionsJson
      ? new UnsignedTransactionJsonService(
          options.unsignedTransactionsJson,
          options.contractAddress,
          options.gasPrice,
          137, // Polygon mainnet chain ID
          0 // Starting nonce (will be fetched from provider)
        )
      : undefined);

  const apiSubmissionService =
    serviceOverrides.apiSubmissionService ??
    (isApiMode && options.domain && options.apiKey && options.oracleKeyId
      ? new ApiSubmissionService(
          options.domain,
          options.apiKey,
          options.oracleKeyId
        )
      : undefined);
  const transactionStatusService =
    serviceOverrides.transactionStatusService ??
    (isApiMode ? new TransactionStatusService(options.rpcUrl) : undefined);

  const transactionStatusReporter =
    serviceOverrides.transactionStatusReporter ??
    (isApiMode
      ? new TransactionStatusReporterService(
          path.join(path.dirname(config.errorCsvPath), 'transaction-status.csv')
        )
      : undefined);
  // Use fromAddress if provided and in unsigned transaction mode, otherwise derive from private key
  let userAddress: string;
  if (
    options.fromAddress &&
    options.unsignedTransactionsJson &&
    options.dryRun
  ) {
    userAddress = options.fromAddress;
    logger.technical(`Using provided from address: ${userAddress}`);
  } else if (isApiMode) {
    // In API mode, we need an address for generating unsigned transactions
    if (options.fromAddress) {
      userAddress = options.fromAddress;
      logger.technical(
        `Using provided from address for API mode: ${userAddress}`
      );
    } else {
      // Generate a dummy address for API mode if none provided
      userAddress = ZERO_ADDRESS;
      logger.warn(
        'No address provided for API mode, using zero address for unsigned transactions'
      );
    }
  } else {
    if (!options.privateKey) {
      const errorMsg =
        'Error: Private key is required when not using --from-address with unsigned transactions or API mode. Provide via --private-key or ELEPHANT_PRIVATE_KEY env var.';
      logger.error(errorMsg);
      console.error(errorMsg);
      throw new Error(errorMsg);
    }
    const wallet = new Wallet(options.privateKey);
    userAddress = wallet.address;
    logger.technical(`User wallet address: ${userAddress}`);
  }

  let progressTracker: SimpleProgress | undefined;
  const startTime = Date.now();

  try {
    await csvReporterService.initialize();
    logger.technical(`Error reports will be saved to: ${config.errorCsvPath}`);
    logger.technical(
      `Warning reports will be saved to: ${config.warningCsvPath}`
    );

    if (transactionStatusReporter) {
      await transactionStatusReporter.initialize();
      logger.technical(
        `Transaction status will be saved to: ${path.join(path.dirname(config.errorCsvPath), 'transaction-status.csv')}`
      );
    }

    // Read and parse CSV file
    let csvContent: string;
    try {
      csvContent = readFileSync(options.csvFile, 'utf-8');
    } catch (error) {
      const errorMessage = `Error reading CSV file ${options.csvFile}: ${error instanceof Error ? error.message : String(error)}`;
      logger.error(errorMessage);
      console.error(errorMessage);
      process.exit(1);
    }

    const records: CsvRecord[] = parse(csvContent, {
      columns: true,
      skip_empty_lines: true,
    });

    if (records.length === 0) {
      logger.warn('No records found in CSV file');

      // Show final report even with 0 records
      await csvReporterService.finalize();
      const endTime = Date.now();
      const duration = endTime - startTime;
      const seconds = (duration / 1000).toFixed(1);

      console.log(chalk.green('\n✅ Contract submission process finished\n'));
      console.log(chalk.bold('📊 Final Report:'));
      console.log(`  Total records in CSV:   0`);
      console.log(`  Items eligible:         0`);
      console.log(`  Items skipped:          0`);

      if (!options.dryRun) {
        console.log(`  Transactions submitted: 0`);
        console.log(`  Total items submitted:  0`);
      } else {
        console.log(
          `  ${chalk.yellow('[DRY RUN]')} Would submit: 0 transactions`
        );
        console.log(`  ${chalk.yellow('[DRY RUN]')} Would process: 0 items`);
      }

      console.log(`  Duration:               ${seconds}s`);
      console.log(`\n  Error report:   ${config.errorCsvPath}`);
      console.log(`  Warning report: ${config.warningCsvPath}`);
      return;
    }

    logger.info(
      `Found ${records.length} record${records.length === 1 ? '' : 's'} in CSV file`
    );

    progressTracker =
      serviceOverrides.progressTracker ||
      new SimpleProgress(1, 'Indexing on-chain data');
    progressTracker.start();

    // Skip expensive blockchain operations when eligibility checks are disabled, in dry-run mode, or API mode
    if (options.checkEligibility && !options.dryRun && !isApiMode) {
      logger.info('Pre-populating on-chain consensus data cache...');
      await chainStateService.prepopulateConsensusCache();
      logger.success('Consensus data cache populated.');
    } else {
      const reason = !options.checkEligibility
        ? 'Eligibility checks disabled'
        : options.dryRun
          ? 'DRY RUN'
          : 'API MODE';
      logger.info(
        `[${reason}] Skipping on-chain consensus data cache population`
      );
    }

    // Check eligibility for each record
    const dataItemsForTransaction: DataItem[] = [];
    const skippedItems: { record: CsvRecord; reason: string }[] = [];

    progressTracker.setPhase(
      options.checkEligibility ? 'Checking Eligibility' : 'Processing Records',
      records.length
    );

    if (options.checkEligibility && !options.dryRun && !isApiMode) {
      await chainStateService.getUserSubmissions(userAddress);
    } else {
      const reason = !options.checkEligibility
        ? 'Eligibility checks disabled'
        : options.dryRun
          ? 'DRY RUN'
          : 'API MODE';
      logger.info(`[${reason}] Skipping user submission history check`);
    }

    const processingPromises = records.map((record) =>
      processRecord(
        record,
        chainStateService,
        userAddress,
        progressTracker!, // progressTracker is initialized before this loop
        csvReporterService,
        options.checkEligibility && !options.dryRun && !isApiMode // Only perform checks if explicitly enabled and not in dry-run/API mode
      )
    );

    const processedResults = await Promise.all(processingPromises);

    for (const result of processedResults) {
      if (result.checkResult.canSubmit && result.checkResult.dataItem) {
        dataItemsForTransaction.push(result.checkResult.dataItem);
      } else {
        skippedItems.push({
          record: result.record,
          reason: result.checkResult.reason || 'Unknown reason',
        });
      }
    }

    logger.success(
      options.checkEligibility
        ? `Eligibility check complete: ${dataItemsForTransaction.length} item${dataItemsForTransaction.length === 1 ? '' : 's'} ready for submission`
        : `Processing complete: ${dataItemsForTransaction.length} item${dataItemsForTransaction.length === 1 ? '' : 's'} ready for submission`
    );

    if (skippedItems.length > 0) {
      logger.warn(
        `${skippedItems.length} item${skippedItems.length === 1 ? '' : 's'} skipped`
      );
    }

    // Submit transactions
    const totalTransactions = Math.ceil(
      dataItemsForTransaction.length / (options.transactionBatchSize || 200)
    );
    progressTracker.setPhase('Submitting Transactions', totalTransactions);
    let submittedTransactionCount = 0;
    let totalItemsSubmitted = 0;
    const submittedTransactions: TransactionRecord[] = [];

    if (!options.dryRun && dataItemsForTransaction.length > 0) {
      if (
        isApiMode &&
        apiSubmissionService &&
        transactionStatusService &&
        transactionStatusReporter
      ) {
        // API submission mode
        try {
          const batches = transactionBatcherService.groupItemsIntoBatches(
            dataItemsForTransaction
          );

          // Generate unsigned transactions using the service
          const unsignedTxService =
            unsignedTransactionJsonService ||
            new UnsignedTransactionJsonService(
              'temp-unsigned.json', // Temporary, we won't write to file
              options.contractAddress,
              options.gasPrice,
              POLYGON_MAINNET_CHAIN_ID,
              0
            );

          // Generate all unsigned transactions
          const unsignedTransactions =
            await unsignedTxService.generateUnsignedTransactions(
              batches,
              options.rpcUrl,
              userAddress
            );

          const apiResults: ApiSubmissionResult[] = [];

          progressTracker.setPhase('Submitting to API', batches.length);

          // Submit each batch to API
          for (let i = 0; i < batches.length; i++) {
            const batch = batches[i];
            try {
              // Submit to API
              const apiResponse = await apiSubmissionService.submitTransaction(
                unsignedTransactions[i],
                i
              );

              apiResults.push({
                batchIndex: i,
                transactionHash: apiResponse.transaction_hash,
                status: {
                  hash: apiResponse.transaction_hash,
                  status: 'pending',
                },
                itemCount: batch.length,
                items: batch,
              });

              progressTracker.increment('processed');
            } catch (error) {
              const errorMsg = `Failed to submit batch ${i + 1}: ${error instanceof Error ? error.message : String(error)}`;
              logger.error(errorMsg);

              apiResults.push({
                batchIndex: i,
                status: { hash: '', status: 'failed', error: errorMsg },
                itemCount: batch.length,
                items: batch,
                error: errorMsg,
              });

              progressTracker.increment('errors');
            }
          }

          // Wait for transaction confirmations
          if (apiResults.some((r) => r.transactionHash)) {
            progressTracker.setPhase(
              'Waiting for Confirmations',
              apiResults.filter((r) => r.transactionHash).length
            );

            for (const result of apiResults) {
              if (result.transactionHash) {
                try {
                  const status =
                    await transactionStatusService.waitForTransaction(
                      result.transactionHash
                    );
                  result.status = status;

                  if (status.status === 'success') {
                    submittedTransactionCount++;
                    totalItemsSubmitted += result.itemCount;
                  }

                  progressTracker.increment('processed');
                } catch (error) {
                  result.status.status = 'failed';
                  result.status.error =
                    error instanceof Error ? error.message : String(error);
                  progressTracker.increment('errors');
                }
              }
            }
          }

          // Log all results to transaction status CSV (including failures)
          for (const result of apiResults) {
            const currentTimestamp = new Date().toISOString();

            await transactionStatusReporter.logTransaction({
              batchIndex: result.batchIndex,
              transactionHash: result.transactionHash || '',
              status: result.status.status,
              blockNumber: result.status.blockNumber,
              gasUsed: result.status.gasUsed,
              itemCount: result.itemCount,
              error: result.status.error,
              timestamp: currentTimestamp,
            });

            if (result.transactionHash) {
              submittedTransactions.push({
                transactionHash: result.transactionHash,
                batchIndex: result.batchIndex,
                itemCount: result.itemCount,
                timestamp: currentTimestamp,
                status: result.status.status,
              });
            }
          }

          logger.success('API submission process completed.');
        } catch (error) {
          const errorMsg = `Error during API submission: ${error instanceof Error ? error.message : String(error)}`;
          logger.error(errorMsg);
          progressTracker.increment('errors');
          await csvReporterService.logError({
            propertyCid: 'N/A',
            dataGroupCid: 'N/A',
            filePath: options.csvFile,
            errorMessage: errorMsg,
            errorPath: 'N/A',
            timestamp: new Date().toISOString(),
          });
        }
      } else {
        // Direct blockchain submission mode
        try {
          let batchIndex = 0;
          for await (const batchResult of transactionBatcherService.submitAll(
            dataItemsForTransaction
          )) {
            logger.info(
              `Batch submitted: TxHash ${batchResult.transactionHash}, Items: ${batchResult.itemsSubmitted}`
            );
            submittedTransactions.push({
              transactionHash: batchResult.transactionHash,
              batchIndex,
              itemCount: batchResult.itemsSubmitted,
              timestamp: new Date().toISOString(),
              status: 'submitted',
            });
            batchIndex++;
            submittedTransactionCount++;
            totalItemsSubmitted += batchResult.itemsSubmitted;
            progressTracker.increment('processed');
          }
          logger.success('All transaction batches submitted successfully.');
        } catch (error) {
          const errorMsg = `Error during transaction submission: ${error instanceof Error ? error.message : String(error)}`;
          logger.error(errorMsg);
          progressTracker.increment('errors');
          await csvReporterService.logError({
            propertyCid: 'N/A',
            dataGroupCid: 'N/A',
            filePath: options.csvFile,
            errorMessage: errorMsg,
            errorPath: 'N/A',
            timestamp: new Date().toISOString(),
          });
        }
      }
    } else if (options.dryRun && dataItemsForTransaction.length > 0) {
      logger.info(
        '[DRY RUN] Would submit the following data items to the blockchain:'
      );
      const batches = transactionBatcherService.groupItemsIntoBatches(
        dataItemsForTransaction
      );
      batches.forEach((batch: DataItem[], index: number) => {
        logger.info(`  Batch ${index + 1}: ${batch.length} items`);
        batch.slice(0, 3).forEach((item: DataItem) => {
          logger.info(
            `    - Property: ${item.propertyCid}, DataGroup: ${item.dataGroupCID}, Data: ${item.dataCID}`
          );
        });
        if (batch.length > 3) {
          logger.info(`    ... and ${batch.length - 3} more items`);
        }
      });

      // Generate unsigned transactions JSON if requested
      if (unsignedTransactionJsonService) {
        try {
          logger.info('Generating unsigned transactions JSON...');
          await unsignedTransactionJsonService.generateUnsignedTransactionsJson(
            batches,
            options.rpcUrl,
            userAddress
          );
          logger.success(
            `Unsigned transactions JSON generated at: ${options.unsignedTransactionsJson}`
          );
        } catch (error) {
          const errorMsg = `Failed to generate unsigned transactions JSON: ${error instanceof Error ? error.message : String(error)}`;
          logger.error(errorMsg);
          await csvReporterService.logError({
            propertyCid: 'N/A',
            dataGroupCid: 'N/A',
            filePath: options.csvFile,
            errorMessage: errorMsg,
            errorPath: 'N/A',
            timestamp: new Date().toISOString(),
          });
        }
      }
    }

    progressTracker.stop();

    // Write transaction IDs CSV if transactions were submitted
    let transactionIdsCsvPath: string | undefined;
    if (submittedTransactions.length > 0 && !options.dryRun) {
      // Generate default filename if not provided
      if (!options.transactionIdsCsv) {
        const timestamp = new Date()
          .toISOString()
          .slice(0, 19)
          .replace(/:/g, '-');
        const reportsDir = path.dirname(config.errorCsvPath);
        transactionIdsCsvPath = path.join(
          reportsDir,
          `transaction-ids-${timestamp}.csv`
        );
      } else {
        transactionIdsCsvPath = options.transactionIdsCsv;
      }

      // Create CSV content
      const csvHeader =
        'transactionHash,batchIndex,itemCount,timestamp,status\n';
      const csvContent = submittedTransactions
        .map(
          (tx) =>
            `${tx.transactionHash},${tx.batchIndex},${tx.itemCount},${tx.timestamp},${tx.status}`
        )
        .join('\n');

      writeFileSync(transactionIdsCsvPath, csvHeader + csvContent);
      logger.success(`Transaction IDs saved to: ${transactionIdsCsvPath}`);

      // Display transaction IDs if less than 5
      if (submittedTransactions.length < 5) {
        console.log(chalk.bold('\n📝 Transaction IDs:'));
        submittedTransactions.forEach((tx) => {
          console.log(`  ${tx.transactionHash}`);
        });
      }
    }

    // Final summary
    await csvReporterService.finalize();
    if (transactionStatusReporter) {
      await transactionStatusReporter.finalize();
    }
    const finalMetrics = progressTracker.getMetrics();

    console.log(chalk.green('\n✅ Contract submission process finished\n'));
    console.log(chalk.bold('📊 Final Report:'));
    console.log(`  Total records in CSV:   ${records.length}`);
    console.log(`  Items eligible:         ${dataItemsForTransaction.length}`);
    console.log(`  Items skipped:          ${skippedItems.length}`);

    if (!options.dryRun) {
      console.log(`  Transactions submitted: ${submittedTransactionCount}`);
      console.log(`  Total items submitted:  ${totalItemsSubmitted}`);
    } else {
      console.log(
        `  [DRY RUN] Would submit: ${dataItemsForTransaction.length} items`
      );
      console.log(
        `  [DRY RUN] In batches:   ${Math.ceil(dataItemsForTransaction.length / (options.transactionBatchSize || 200))}`
      );
      if (options.unsignedTransactionsJson) {
        console.log(
          `  Unsigned transactions:  ${options.unsignedTransactionsJson}`
        );
      }
    }

    const elapsed = Date.now() - finalMetrics.startTime;
    const seconds = Math.floor(elapsed / 1000);
    console.log(`  Duration:               ${seconds}s`);
    console.log(`\n  Error report:   ${config.errorCsvPath}`);
    console.log(`  Warning report: ${config.warningCsvPath}`);
    if (isApiMode) {
      console.log(
        `  Transaction status: ${path.join(path.dirname(config.errorCsvPath), 'transaction-status.csv')}`
      );
    }
    if (transactionIdsCsvPath) {
      console.log(`  Transaction IDs: ${transactionIdsCsvPath}`);
    }
  } catch (error) {
    logger.error(
      `An unhandled error occurred: ${error instanceof Error ? error.message : String(error)}`
    );
    console.error(
      chalk.red(
        `An unhandled error occurred: ${error instanceof Error ? error.message : String(error)}`
      )
    );
    if (progressTracker) {
      progressTracker.stop();
    }
    await csvReporterService.finalize();
    if (transactionStatusReporter) {
      await transactionStatusReporter.finalize();
    }
    process.exit(1);
  }
}
