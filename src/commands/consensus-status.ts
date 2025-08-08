import { Command } from 'commander';
import chalk from 'chalk';
import ora, { Ora } from 'ora';
import { BlockchainService } from '../services/blockchain.service.js';
import { ConsensusReporterService } from '../services/consensus-reporter.service.js';
import { CidHexConverterService } from '../services/cid-hex-converter.service.js';
import { IpfsDataComparatorService } from '../services/ipfs-data-comparator.service.js';
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

    // Analyze differences for partial consensus if enabled
    if (options.analyzeDifferences) {
      spinner.start('Analyzing differences for partial consensus cases...');
      await analyzeDifferencesForPartialConsensus(
        analysis,
        options.gatewayUrl || 'https://gateway.pinata.cloud/ipfs',
        spinner
      );
      spinner.succeed('Difference analysis complete');
    }

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
    const submitterData = new Map<string, { hash: string; cid: string }>();
    let maxSubmitters = 0;

    // Convert Sets to Arrays and find consensus
    for (const [dataHash, submitters] of group.submissions) {
      const submittersArray = Array.from(submitters);
      submissionsByDataHash.set(dataHash, submittersArray);

      // Create submitter data mapping
      for (const submitter of submittersArray) {
        try {
          const dataCid = cidConverter.hexToCid(dataHash);
          submitterData.set(submitter, { hash: dataHash, cid: dataCid });
        } catch (error) {
          logger.warn(`Failed to convert dataHash to CID: ${dataHash}`);
          submitterData.set(submitter, { hash: dataHash, cid: '' });
        }
      }

      // Track which dataHash has the most submitters
      if (submittersArray.length > maxSubmitters) {
        maxSubmitters = submittersArray.length;
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
      submissionsByDataHash,
      submitterData,
      totalSubmitters: uniqueSubmittersForGroup.size,
      uniqueDataHashes: group.submissions.size,
    });
  }

  return analyses;
}

async function analyzeDifferencesForPartialConsensus(
  analyses: ConsensusAnalysis[],
  gatewayUrl: string,
  spinner: Ora
): Promise<void> {
  const comparator = new IpfsDataComparatorService(gatewayUrl);
  // Analyze any case with multiple unique hashes where consensus is not full
  // This includes both partial consensus and no consensus cases
  const casesToAnalyze = analyses.filter(
    (a) => a.consensusReached !== true && a.uniqueDataHashes > 1
  );

  logger.info(
    `Found ${casesToAnalyze.length} cases with differences to analyze`
  );

  let analyzed = 0;
  for (const analysis of casesToAnalyze) {
    try {
      // Collect unique CIDs
      const uniqueCids = new Set<string>();
      for (const data of analysis.submitterData.values()) {
        if (data.cid) {
          uniqueCids.add(data.cid);
        }
      }

      if (uniqueCids.size > 1) {
        spinner.text = `Analyzing differences ${++analyzed}/${casesToAnalyze.length}...`;

        const cids = Array.from(uniqueCids);
        const comparisonResult = await comparator.compareMultipleCids(
          cids,
          analysis.propertyHash,
          analysis.dataGroupHash
        );

        analysis.comparisonResult = comparisonResult;

        logger.info(
          `Analyzed property ${analysis.propertyHash.slice(0, 10)}..., found ${comparisonResult.totalDifferences} differences`
        );
      }
    } catch (error) {
      logger.error(
        `Failed to analyze differences for property ${analysis.propertyHash.slice(0, 10)}...: ${error}`
      );
    }
  }

  comparator.clearCache();
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

  // Show cases with differences (partial consensus or no consensus with multiple submissions)
  const casesWithDifferences = analyses.filter(
    (a) => a.comparisonResult && a.comparisonResult.totalDifferences > 0
  );

  if (casesWithDifferences.length > 0) {
    console.log('\n' + chalk.bold('Submission Differences Found:'));
    console.log(chalk.gray('(Showing top 3 cases with most differences)'));

    // Sort by total differences and show top 3
    const topCases = casesWithDifferences
      .sort(
        (a, b) =>
          (b.comparisonResult?.totalDifferences || 0) -
          (a.comparisonResult?.totalDifferences || 0)
      )
      .slice(0, 3);

    for (const analysis of topCases) {
      console.log('\n' + chalk.cyan('─'.repeat(60)));
      console.log(
        chalk.bold(`Property: `) +
          chalk.gray(analysis.propertyHash.slice(0, 10) + '...')
      );
      console.log(
        chalk.bold(`DataGroup: `) +
          chalk.gray(analysis.dataGroupHash.slice(0, 10) + '...')
      );
      console.log(
        chalk.bold(`Consensus: `) +
          (analysis.consensusReached === true
            ? chalk.green('Full')
            : analysis.consensusReached === 'partial'
              ? chalk.yellow('Partial')
              : chalk.red('None'))
      );
      console.log(
        chalk.bold(`Submitters: `) +
          analysis.totalSubmitters +
          chalk.gray(` (${analysis.uniqueDataHashes} unique submissions)`)
      );

      if (analysis.comparisonResult) {
        console.log('\n' + chalk.bold('Difference Analysis:'));
        // Split the summary into lines and format each section
        const summaryLines = analysis.comparisonResult.summary.split('\n');
        let inStatsSection = false;

        for (const line of summaryLines) {
          if (line.includes('DIFFERENCES FOUND:')) {
            inStatsSection = false;
            console.log(chalk.yellow('  ' + line));
          } else if (line.includes('SUMMARY STATISTICS:')) {
            inStatsSection = true;
            console.log(chalk.blue('\n  ' + line));
          } else if (line.startsWith('📍 Path:')) {
            console.log(chalk.magenta('  ' + line));
          } else if (
            line.includes('Values across submissions:') ||
            line.includes('Sample values:')
          ) {
            console.log(chalk.gray('  ' + line));
          } else if (line.includes('• ...')) {
            // Value lines
            console.log(chalk.white('  ' + line));
          } else if (inStatsSection && line.includes('•')) {
            console.log(chalk.cyan('  ' + line));
          } else if (line.trim()) {
            console.log('  ' + line);
          }
        }
      }
    }

    if (casesWithDifferences.length > 3) {
      console.log(
        '\n' +
          chalk.gray(
            `... and ${casesWithDifferences.length - 3} more cases with differences`
          )
      );
      console.log(
        chalk.gray(
          `See the full report in: ${analyses.length > 0 ? 'consensus CSV file' : 'the output CSV'}`
        )
      );
    }
  }

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
    .option(
      '-g, --gateway-url <url>',
      'IPFS gateway URL for fetching data',
      'https://gateway.pinata.cloud/ipfs'
    )
    .option(
      '--analyze-differences',
      'Analyze and report differences for partial consensus cases',
      false
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
          gatewayUrl: options.gatewayUrl,
          analyzeDifferences: options.analyzeDifferences,
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
