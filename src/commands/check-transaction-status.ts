import { Command } from 'commander';
import { readFileSync, writeFileSync } from 'fs';
import { parse } from 'csv-parse/sync';
import path from 'path';
import chalk from 'chalk';
import { SimpleProgress } from '../utils/simple-progress.js';
import { logger } from '../utils/logger.js';
import { DEFAULT_RPC_URL } from '../config/constants.js';
import {
  TransactionStatusCheckerService,
  TransactionRecord,
  TransactionStatusResult,
} from '../services/transaction-status-checker.service.js';

export interface CheckTransactionStatusOptions {
  csvFile: string;
  rpcUrl: string;
  outputCsv?: string;
  maxConcurrent: number;
}

export function registerCheckTransactionStatusCommand(program: Command) {
  program
    .command('check-transaction-status <csvFile>')
    .description('Check the status of transactions from a CSV file')
    .option(
      '--rpc-url <url>',
      'RPC URL for the blockchain network',
      process.env.RPC_URL || DEFAULT_RPC_URL
    )
    .option(
      '--output-csv <path>',
      'Output CSV file (default: transaction-status-checked-{timestamp}.csv)'
    )
    .option(
      '--max-concurrent <number>',
      'Maximum concurrent status checks (default: 10)',
      '10'
    )
    .action(async (csvFile, options) => {
      const commandOptions: CheckTransactionStatusOptions = {
        csvFile: path.resolve(csvFile),
        rpcUrl: options.rpcUrl,
        outputCsv: options.outputCsv
          ? path.resolve(options.outputCsv)
          : undefined,
        maxConcurrent: parseInt(options.maxConcurrent, 10),
      };

      await handleCheckTransactionStatus(commandOptions);
    });
}

async function handleCheckTransactionStatus(
  options: CheckTransactionStatusOptions
) {
  console.log(
    chalk.bold.blue('🐘 Elephant Network CLI - Check Transaction Status')
  );
  console.log();

  const progressTracker = new SimpleProgress(1, 'Reading CSV');
  progressTracker.start();

  try {
    // Read CSV
    const csvContent = readFileSync(options.csvFile, 'utf-8');
    const records: TransactionRecord[] = parse(csvContent, {
      columns: true,
      skip_empty_lines: true,
    });

    if (records.length === 0) {
      progressTracker.stop();
      console.log(chalk.yellow('No transactions found in CSV file'));
      return;
    }

    // Set up progress for checking phase
    progressTracker.setPhase('Checking Status', records.length);

    // Check statuses in parallel with concurrency limit
    const checkerService = new TransactionStatusCheckerService(
      options.rpcUrl,
      options.maxConcurrent
    );

    const results = await checkerService.checkTransactionStatuses(
      records,
      () => {
        progressTracker.increment('processed');
      }
    );

    progressTracker.stop();

    // Write results to CSV
    const outputPath = await writeResultsCsv(results, options.outputCsv);

    // Show summary
    showSummary(results, outputPath);
  } catch (error) {
    progressTracker.stop();
    console.error(
      chalk.red(
        `Error: ${error instanceof Error ? error.message : String(error)}`
      )
    );
    process.exit(1);
  }
}

async function writeResultsCsv(
  results: TransactionStatusResult[],
  outputPath?: string
): Promise<string> {
  // Generate default filename if not provided
  if (!outputPath) {
    const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
    outputPath = `transaction-status-checked-${timestamp}.csv`;
  }

  const csvHeader =
    'transactionHash,batchIndex,itemCount,timestamp,status,blockNumber,gasUsed,checkTimestamp,error\n';
  const csvContent = results
    .map(
      (r) =>
        `${r.transactionHash},${r.batchIndex},${r.itemCount},${r.timestamp},${r.status},${r.blockNumber || ''},${r.gasUsed || ''},${r.checkTimestamp},${r.error || ''}`
    )
    .join('\n');

  writeFileSync(outputPath, csvHeader + csvContent);
  logger.success(`Transaction status results saved to: ${outputPath}`);

  return outputPath;
}

function showSummary(results: TransactionStatusResult[], outputPath?: string) {
  const summary = {
    total: results.length,
    success: results.filter((r) => r.status === 'success').length,
    failed: results.filter((r) => r.status === 'failed').length,
    pending: results.filter((r) => r.status === 'pending').length,
    notFound: results.filter((r) => r.status === 'not_found').length,
  };

  console.log(chalk.green('\n✅ Transaction Status Check Complete\n'));
  console.log(chalk.bold('📊 Summary:'));
  console.log(`  Total transactions:     ${summary.total}`);
  console.log(`  Successful:            ${chalk.green(summary.success)}`);
  console.log(`  Failed:                ${chalk.red(summary.failed)}`);
  console.log(`  Still pending:         ${chalk.yellow(summary.pending)}`);
  console.log(`  Not found:             ${chalk.gray(summary.notFound)}`);

  if (outputPath) {
    console.log(`\n  Output saved to:       ${outputPath}`);
  }
}
