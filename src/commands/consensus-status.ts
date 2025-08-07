import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { BlockchainService } from '../services/blockchain.service.js';
import { ConsensusReporterService } from '../services/consensus-reporter.service.js';
import {
  ConsensusStatusOptions,
  ConsensusState,
  ConsensusAnalysis,
  DataSubmittedEvent,
} from '../types/index.js';
import {
  DEFAULT_RPC_URL,
  DEFAULT_CONTRACT_ADDRESS,
  SUBMIT_CONTRACT_ABI_FRAGMENTS,
} from '../config/constants.js';
import { logger } from '../utils/logger.js';
import { isValidAddress } from '../utils/validation.js';

export async function consensusStatusCommand(
  options: ConsensusStatusOptions
): Promise<void> {
  const spinner = ora('Initializing consensus status check...').start();

  try {
    // Validate inputs
    if (options.contractAddress && !isValidAddress(options.contractAddress)) {
      throw new Error(`Invalid contract address: ${options.contractAddress}`);
    }

    // Initialize blockchain service
    const blockchainService = new BlockchainService(
      options.rpcUrl || DEFAULT_RPC_URL,
      options.contractAddress || DEFAULT_CONTRACT_ADDRESS,
      SUBMIT_CONTRACT_ABI_FRAGMENTS
    );

    // Get current block if toBlock not specified
    const currentBlock = await blockchainService.getCurrentBlock();
    const toBlock = options.toBlock || currentBlock;

    spinner.text = `Fetching DataSubmitted events from block ${options.fromBlock} to ${toBlock}...`;

    // Initialize consensus state
    const consensusState: ConsensusState = {
      groups: new Map(),
      allSubmitters: new Set(),
    };

    let processedEvents = 0;
    let processedBlocks = 0;
    const totalBlocks = toBlock - options.fromBlock;

    // Stream and process events
    for await (const eventBatch of blockchainService.getDataSubmittedEventsStream(
      options.fromBlock,
      toBlock,
      {
        blockChunkSize: options.blockChunkSize || 2500,
        eventBatchSize: options.eventBatchSize || 500,
        retryAttempts: 3,
        retryDelay: 2000,
      }
    )) {
      // Update consensus state incrementally
      updateConsensusState(consensusState, eventBatch);

      processedEvents += eventBatch.length;

      // Update progress
      if (eventBatch.length > 0) {
        const lastBlock = eventBatch[eventBatch.length - 1].blockNumber;
        processedBlocks = lastBlock - options.fromBlock;
        spinner.text = `Processed ${processedEvents} events, ${processedBlocks}/${totalBlocks} blocks (${Math.round((processedBlocks / totalBlocks) * 100)}%)`;
      }

      // Log memory usage periodically
      if (processedEvents % 10000 === 0 && processedEvents > 0) {
        const usage = process.memoryUsage();
        logger.debug(
          `Memory usage: ${Math.round(usage.heapUsed / 1024 / 1024)}MB`
        );
      }
    }

    spinner.succeed(
      `Processed ${processedEvents} total events from ${totalBlocks} blocks`
    );

    // Analyze consensus
    spinner.start('Analyzing consensus status...');
    const analysis = analyzeConsensusStatus(consensusState);
    spinner.succeed(
      `Analyzed ${analysis.length} property-datagroup combinations`
    );

    // Generate CSV report
    spinner.start(`Writing CSV report to ${options.outputCsv}...`);
    await ConsensusReporterService.generateCSV(analysis, options.outputCsv);
    spinner.succeed(`CSV report written to ${options.outputCsv}`);

    // Display summary
    displayConsensusSummary(analysis);
  } catch (error) {
    spinner.fail('Failed to check consensus status');
    logger.error(`Error in consensus status command: ${error}`);
    throw error;
  }
}

function updateConsensusState(
  state: ConsensusState,
  events: DataSubmittedEvent[]
): void {
  for (const event of events) {
    const groupKey = `${event.propertyHash}-${event.dataGroupHash}`;

    // Track submitter globally
    state.allSubmitters.add(event.submitter);

    // Update group
    if (!state.groups.has(groupKey)) {
      state.groups.set(groupKey, {
        propertyHash: event.propertyHash,
        dataGroupHash: event.dataGroupHash,
        submissions: new Map(),
      });
    }

    const group = state.groups.get(groupKey)!;

    // Track submissions by dataHash
    if (!group.submissions.has(event.dataHash)) {
      group.submissions.set(event.dataHash, new Set());
    }

    group.submissions.get(event.dataHash)!.add(event.submitter);
  }
}

function analyzeConsensusStatus(state: ConsensusState): ConsensusAnalysis[] {
  const analyses: ConsensusAnalysis[] = [];

  for (const group of state.groups.values()) {
    const submissionsByDataHash = new Map<string, string[]>();
    let totalSubmitters = 0;
    let consensusDataHash: string | undefined;
    let maxSubmitters = 0;

    // Convert Sets to Arrays and find consensus
    for (const [dataHash, submitters] of group.submissions) {
      const submittersArray = Array.from(submitters);
      submissionsByDataHash.set(dataHash, submittersArray);
      totalSubmitters += submittersArray.length;

      // Track which dataHash has the most submitters
      if (submittersArray.length > maxSubmitters) {
        maxSubmitters = submittersArray.length;
        consensusDataHash = dataHash;
      }
    }

    // Consensus is reached if one dataHash has more than 50% of unique submitters
    const uniqueSubmittersForGroup = new Set<string>();
    for (const submitters of submissionsByDataHash.values()) {
      submitters.forEach((s) => uniqueSubmittersForGroup.add(s));
    }

    const consensusReached = maxSubmitters > uniqueSubmittersForGroup.size / 2;

    analyses.push({
      propertyHash: group.propertyHash,
      dataGroupHash: group.dataGroupHash,
      consensusReached,
      consensusDataHash: consensusReached ? consensusDataHash : undefined,
      submissionsByDataHash,
      totalSubmitters: uniqueSubmittersForGroup.size,
      uniqueDataHashes: group.submissions.size,
    });
  }

  return analyses;
}

function displayConsensusSummary(analyses: ConsensusAnalysis[]): void {
  console.log('\n' + chalk.bold('Consensus Status Summary'));
  console.log('='.repeat(50));

  const totalGroups = analyses.length;
  const consensusReachedCount = analyses.filter(
    (a) => a.consensusReached
  ).length;
  const consensusPercentage =
    totalGroups > 0
      ? Math.round((consensusReachedCount / totalGroups) * 100)
      : 0;

  console.log(
    `Total property-datagroup combinations: ${chalk.cyan(totalGroups)}`
  );
  console.log(
    `Consensus reached: ${chalk.green(consensusReachedCount)} (${consensusPercentage}%)`
  );
  console.log(
    `No consensus: ${chalk.yellow(totalGroups - consensusReachedCount)}`
  );

  // Show top disputed groups
  const disputedGroups = analyses
    .filter((a) => !a.consensusReached && a.uniqueDataHashes > 1)
    .sort((a, b) => b.uniqueDataHashes - a.uniqueDataHashes)
    .slice(0, 5);

  if (disputedGroups.length > 0) {
    console.log('\n' + chalk.bold('Top Disputed Groups:'));
    for (const group of disputedGroups) {
      console.log(`  Property: ${group.propertyHash.slice(0, 10)}...`);
      console.log(`  DataGroup: ${group.dataGroupHash.slice(0, 10)}...`);
      console.log(`  Unique submissions: ${chalk.red(group.uniqueDataHashes)}`);
      console.log(`  Total submitters: ${group.totalSubmitters}`);
      console.log('  ---');
    }
  }
}

export function registerConsensusStatusCommand(program: Command): void {
  program
    .command('consensus-status')
    .description('Check consensus status by analyzing DataSubmitted events')
    .requiredOption('-f, --from-block <number>', 'Starting block number')
    .option(
      '-t, --to-block <number>',
      'Ending block number (defaults to latest)'
    )
    .option('-r, --rpc-url <url>', 'RPC URL', DEFAULT_RPC_URL)
    .requiredOption('-o, --output-csv <path>', 'Output CSV file path')
    .option(
      '-c, --contract-address <address>',
      'Contract address',
      DEFAULT_CONTRACT_ADDRESS
    )
    .option(
      '--block-chunk-size <number>',
      'Number of blocks to query at once',
      '2500'
    )
    .option(
      '--event-batch-size <number>',
      'Number of events to process at once',
      '500'
    )
    .action(async (options) => {
      try {
        // Parse and validate options
        const consensusOptions: ConsensusStatusOptions = {
          fromBlock: parseInt(options.fromBlock, 10),
          toBlock: options.toBlock ? parseInt(options.toBlock, 10) : undefined,
          rpcUrl: options.rpcUrl,
          outputCsv: options.outputCsv,
          contractAddress: options.contractAddress,
          blockChunkSize: parseInt(options.blockChunkSize, 10),
          eventBatchSize: parseInt(options.eventBatchSize, 10),
        };

        // Validate block numbers
        if (
          isNaN(consensusOptions.fromBlock) ||
          consensusOptions.fromBlock < 0
        ) {
          throw new Error('Invalid from-block number');
        }

        if (
          consensusOptions.toBlock !== undefined &&
          (isNaN(consensusOptions.toBlock) ||
            consensusOptions.toBlock < consensusOptions.fromBlock)
        ) {
          throw new Error('Invalid to-block number');
        }

        await consensusStatusCommand(consensusOptions);
      } catch (error) {
        console.error(
          chalk.red('Error:'),
          error instanceof Error ? error.message : String(error)
        );
        process.exit(1);
      }
    });
}
