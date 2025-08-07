import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { BlockchainService } from '../services/blockchain.service.js';
import { ConsensusReporterService } from '../services/consensus-reporter.service.js';
import { CidHexConverterService } from '../services/cid-hex-converter.service.js';
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
  const cidConverter = new CidHexConverterService();

  for (const group of state.groups.values()) {
    const submissionsByDataHash = new Map<string, string[]>();
    const submissionsByDataCid = new Map<string, string[]>();
    let consensusDataHash: string | undefined;
    let consensusDataCid: string | undefined;
    let maxSubmitters = 0;

    // Convert Sets to Arrays and find consensus
    for (const [dataHash, submitters] of group.submissions) {
      const submittersArray = Array.from(submitters);
      submissionsByDataHash.set(dataHash, submittersArray);

      // Convert hash to CID
      try {
        const dataCid = cidConverter.hexToCid(dataHash);
        submissionsByDataCid.set(dataCid, submittersArray);

        // Track which dataHash has the most submitters
        if (submittersArray.length > maxSubmitters) {
          maxSubmitters = submittersArray.length;
          consensusDataHash = dataHash;
          consensusDataCid = dataCid;
        }
      } catch (error) {
        logger.warn(`Failed to convert dataHash to CID: ${dataHash}`);
        // Still track the hash even if CID conversion fails
        if (submittersArray.length > maxSubmitters) {
          maxSubmitters = submittersArray.length;
          consensusDataHash = dataHash;
          consensusDataCid = undefined;
        }
      }
    }

    // Count unique submitters for this group
    const uniqueSubmittersForGroup = new Set<string>();
    for (const submitters of submissionsByDataHash.values()) {
      submitters.forEach((s) => uniqueSubmittersForGroup.add(s));
    }

    // Determine consensus status based on the new rules
    let consensusReached: boolean | 'partial';
    if (maxSubmitters >= 3) {
      consensusReached = true;
    } else if (maxSubmitters === 2) {
      consensusReached = 'partial';
    } else {
      consensusReached = false;
    }

    analyses.push({
      propertyHash: group.propertyHash,
      dataGroupHash: group.dataGroupHash,
      consensusReached,
      consensusDataHash:
        consensusReached === true || consensusReached === 'partial'
          ? consensusDataHash
          : undefined,
      consensusDataCid:
        consensusReached === true || consensusReached === 'partial'
          ? consensusDataCid
          : undefined,
      submissionsByDataHash,
      submissionsByDataCid,
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
  const fullConsensusCount = analyses.filter(
    (a) => a.consensusReached === true
  ).length;
  const partialConsensusCount = analyses.filter(
    (a) => a.consensusReached === 'partial'
  ).length;
  const noConsensusCount = analyses.filter(
    (a) => a.consensusReached === false
  ).length;

  // Count unique property hashes
  const uniquePropertyHashes = new Set(analyses.map((a) => a.propertyHash));

  const fullConsensusPercentage =
    totalGroups > 0 ? Math.round((fullConsensusCount / totalGroups) * 100) : 0;
  const partialConsensusPercentage =
    totalGroups > 0
      ? Math.round((partialConsensusCount / totalGroups) * 100)
      : 0;

  console.log(`Unique properties: ${chalk.magenta(uniquePropertyHashes.size)}`);
  console.log(
    `Total property-datagroup combinations: ${chalk.cyan(totalGroups)}`
  );
  console.log(
    `Full consensus (3+ agree): ${chalk.green(fullConsensusCount)} (${fullConsensusPercentage}%)`
  );
  console.log(
    `Partial consensus (2 agree): ${chalk.yellow(partialConsensusCount)} (${partialConsensusPercentage}%)`
  );
  console.log(`No consensus: ${chalk.red(noConsensusCount)}`);

  // Show top disputed groups
  const disputedGroups = analyses
    .filter((a) => a.consensusReached === false && a.uniqueDataHashes > 1)
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
    .requiredOption('-r, --rpc-url <url>', 'RPC URL')
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
