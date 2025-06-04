import { Command } from 'commander';
import { readFileSync } from 'fs';
import path from 'path';
import chalk from 'chalk';
import { parse } from 'csv-parse/sync';
import {
  DEFAULT_RPC_URL,
  DEFAULT_CONTRACT_ADDRESS,
  SUBMIT_CONTRACT_ABI_FRAGMENTS,
} from '../config/constants.js';
import { createSubmitConfig } from '../config/submit.config.js';
import { logger } from '../utils/logger.js';
import { ChainStateService } from '../services/chain-state.service.js';
import { TransactionBatcherService } from '../services/transaction-batcher.service.js';
import { CsvReporterService } from '../services/csv-reporter.service.js';
import { SimpleProgress } from '../utils/simple-progress.js';
import { DataItem } from '../types/contract.types.js';
import { Wallet } from 'ethers';

export interface SubmitToContractCommandOptions {
  rpcUrl: string;
  contractAddress: string;
  privateKey: string;
  csvFile: string;
  transactionBatchSize?: number;
  dryRun: boolean;
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
      '--dry-run',
      'Perform all checks without submitting transactions.',
      false
    )
    .action(async (csvFile, options) => {
      options.privateKey =
        options.privateKey || process.env.ELEPHANT_PRIVATE_KEY;

      if (!options.privateKey) {
        logger.error(
          'Error: Private key is required. Provide via --private-key or ELEPHANT_PRIVATE_KEY env var.'
        );
        process.exit(1);
      }

      options.transactionBatchSize =
        parseInt(options.transactionBatchSize, 10) || 200;

      const commandOptions: SubmitToContractCommandOptions = {
        ...options,
        csvFile: path.resolve(csvFile),
      };

      await handleSubmitToContract(commandOptions);
    });
}

async function checkSubmissionEligibility(
  record: CsvRecord,
  chainStateService: ChainStateService,
  userAddress: string
): Promise<SubmissionCheckResult> {
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
  progressTracker?: SimpleProgress;
}

async function processRecord(
  record: CsvRecord,
  chainStateService: ChainStateService,
  userAddress: string,
  progressTracker: SimpleProgress,
  csvReporterService: CsvReporterService
): Promise<{ record: CsvRecord; checkResult: SubmissionCheckResult }> {
  const checkResult = await checkSubmissionEligibility(
    record,
    chainStateService,
    userAddress
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

  if (options.dryRun) {
    logger.warn('DRY RUN MODE: No transactions will be sent');
  }

  logger.technical(`CSV file: ${options.csvFile}`);
  logger.technical(`RPC URL: ${options.rpcUrl}`);
  logger.technical(`Contract: ${options.contractAddress}`);
  logger.technical(`Transaction batch size: ${options.transactionBatchSize}`);

  const config = createSubmitConfig({
    transactionBatchSize: options.transactionBatchSize,
  });

  const chainStateService =
    serviceOverrides.chainStateService ??
    new ChainStateService(
      options.rpcUrl,
      options.contractAddress,
      options.contractAddress,
      SUBMIT_CONTRACT_ABI_FRAGMENTS,
      SUBMIT_CONTRACT_ABI_FRAGMENTS
    );
  const transactionBatcherService =
    serviceOverrides.transactionBatcherService ??
    new TransactionBatcherService(
      options.rpcUrl,
      options.contractAddress,
      options.privateKey,
      config
    );
  const csvReporterService =
    serviceOverrides.csvReporterService ??
    new CsvReporterService(config.errorCsvPath, config.warningCsvPath);

  const wallet = new Wallet(options.privateKey);
  const userAddress = wallet.address;
  logger.technical(`User wallet address: ${userAddress}`);

  let progressTracker: SimpleProgress | undefined;
  const startTime = Date.now();

  try {
    await csvReporterService.initialize();
    logger.technical(`Error reports will be saved to: ${config.errorCsvPath}`);
    logger.technical(
      `Warning reports will be saved to: ${config.warningCsvPath}`
    );

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
      serviceOverrides.progressTracker || new SimpleProgress(records.length);
    progressTracker.setPhase('Checking Eligibility');
    progressTracker.start();

    // Check eligibility for each record
    const dataItemsForTransaction: DataItem[] = [];
    const skippedItems: { record: CsvRecord; reason: string }[] = [];

    const processingPromises = records.map((record) =>
      processRecord(
        record,
        chainStateService,
        userAddress,
        progressTracker!, // progressTracker is initialized before this loop
        csvReporterService
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
      `Eligibility check complete: ${dataItemsForTransaction.length} item${dataItemsForTransaction.length === 1 ? '' : 's'} ready for submission`
    );

    if (skippedItems.length > 0) {
      logger.warn(
        `${skippedItems.length} item${skippedItems.length === 1 ? '' : 's'} skipped`
      );
    }

    // Submit transactions
    progressTracker.setPhase('Submitting Transactions');
    let submittedTransactionCount = 0;
    let totalItemsSubmitted = 0;

    if (!options.dryRun && dataItemsForTransaction.length > 0) {
      try {
        for await (const batchResult of transactionBatcherService.submitAll(
          dataItemsForTransaction
        )) {
          logger.info(
            `Batch submitted: TxHash ${batchResult.transactionHash}, Items: ${batchResult.itemsSubmitted}`
          );
          submittedTransactionCount++;
          totalItemsSubmitted += batchResult.itemsSubmitted;
        }
        logger.success('All transaction batches submitted successfully.');
      } catch (error) {
        const errorMsg = `Error during transaction submission: ${error instanceof Error ? error.message : String(error)}`;
        logger.error(errorMsg);
        await csvReporterService.logError({
          propertyCid: 'N/A',
          dataGroupCid: 'N/A',
          filePath: options.csvFile,
          error: errorMsg,
          timestamp: new Date().toISOString(),
        });
      }
    } else if (options.dryRun && dataItemsForTransaction.length > 0) {
      logger.info(
        '[DRY RUN] Would submit the following data items to the blockchain:'
      );
      const batches = transactionBatcherService.groupItemsIntoBatches(
        dataItemsForTransaction
      );
      batches.forEach((batch, index) => {
        logger.info(`  Batch ${index + 1}: ${batch.length} items`);
        batch.slice(0, 3).forEach((item) => {
          logger.info(
            `    - Property: ${item.propertyCid}, DataGroup: ${item.dataGroupCID}, Data: ${item.dataCID}`
          );
        });
        if (batch.length > 3) {
          logger.info(`    ... and ${batch.length - 3} more items`);
        }
      });
    }

    progressTracker.stop();

    // Final summary
    await csvReporterService.finalize();
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
    }

    const elapsed = Date.now() - finalMetrics.startTime;
    const seconds = Math.floor(elapsed / 1000);
    console.log(`  Duration:               ${seconds}s`);
    console.log(`\n  Error report:   ${config.errorCsvPath}`);
    console.log(`  Warning report: ${config.warningCsvPath}`);
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
    process.exit(1);
  }
}
