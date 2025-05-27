import { Command, Option } from 'commander';
import { promises as fsPromises, existsSync } from 'fs';
import path from 'path';
import { DEFAULT_RPC_URL, DEFAULT_CONTRACT_ADDRESS } from '../config/constants'; // Assuming submit contract address might be different
import {
  createSubmitConfig,
  SubmitConfig,
  DEFAULT_SUBMIT_CONFIG,
} from '../config/submit.config';
import { logger } from '../utils/logger';
import { FileScannerService } from '../services/file-scanner.service';
// ... import other services as they are integrated

// Define command options interface
export interface SubmitFilesCommandOptions {
  rpcUrl: string;
  contractAddress: string; // This will be the submit-specific contract
  privateKey: string;
  pinataJwt: string;
  inputDir: string;
  maxConcurrentUploads?: number;
  transactionBatchSize?: number;
  // ... other config overrides
  dryRun: boolean;
  // TODO: Add checkpoint path option
}

export function registerSubmitFilesCommand(program: Command) {
  program
    .command('submit-files <inputDir>')
    .description(
      'Validate, process, upload, and submit data files to the Elephant Network.'
    )
    .requiredOption(
      '-k, --private-key <key>',
      'Private key for the submitting wallet. (Or set ELEPHANT_PRIVATE_KEY env var)'
    )
    .requiredOption(
      '-j, --pinata-jwt <jwt>',
      'Pinata JWT for IPFS uploads. (Or set PINATA_JWT env var)'
    )
    .option(
      '--rpc-url <url>',
      'RPC URL for the blockchain network.',
      process.env.RPC_URL || DEFAULT_RPC_URL
    )
    .option(
      '--contract-address <address>',
      'Address of the submit smart contract.',
      process.env.SUBMIT_CONTRACT_ADDRESS ||
        DEFAULT_CONTRACT_ADDRESS /* Placeholder - update if different */
    )
    .option(
      '--max-concurrent-uploads <number>',
      'Maximum concurrent IPFS uploads.',
      (val) => parseInt(val, 10)
    )
    .option(
      '--transaction-batch-size <number>',
      'Number of items per blockchain transaction.',
      (val) => parseInt(val, 10)
    )
    .option(
      '--dry-run',
      'Perform all checks without uploading or submitting transactions.',
      false
    )
    // TODO: Add more options from SubmitConfig as needed (e.g., retries, timeouts)
    .action(async (inputDir, options) => {
      // Resolve environment variables for required options if not provided directly
      options.privateKey =
        options.privateKey || process.env.ELEPHANT_PRIVATE_KEY;
      options.pinataJwt = options.pinataJwt || process.env.PINATA_JWT;

      if (!options.privateKey) {
        logger.error(
          'Error: Private key is required. Provide via --private-key or ELEPHANT_PRIVATE_KEY env var.'
        );
        process.exit(1);
      }
      if (!options.pinataJwt) {
        logger.error(
          'Error: Pinata JWT is required. Provide via --pinata-jwt or PINATA_JWT env var.'
        );
        process.exit(1);
      }

      // Construct full options object including resolved inputDir
      const commandOptions: SubmitFilesCommandOptions = {
        ...options,
        inputDir: path.resolve(inputDir), // Ensure absolute path
      };

      await handleSubmitFiles(commandOptions);
    });
}

async function handleSubmitFiles(options: SubmitFilesCommandOptions) {
  logger.info('Starting submit-files process...');
  logger.info(`Input directory: ${options.inputDir}`);
  logger.info(`RPC URL: ${options.rpcUrl}`);
  logger.info(`Submit Contract Address: ${options.contractAddress}`);
  if (options.dryRun) {
    logger.warn(
      'DRY RUN active: No files will be uploaded, no transactions will be sent.'
    );
  }

  // 1. Validate input directory
  try {
    const stats = await fsPromises.stat(options.inputDir);
    if (!stats.isDirectory()) {
      logger.error(`Input path ${options.inputDir} is not a directory.`);
      process.exit(1);
    }
  } catch (error) {
    logger.error(
      `Error accessing input directory ${options.inputDir}: ${error instanceof Error ? error.message : String(error)}`
    );
    process.exit(1);
  }

  // Create submit configuration by overriding defaults with command options
  const submitConfigOverrides: Partial<SubmitConfig> = {};
  if (options.maxConcurrentUploads)
    submitConfigOverrides.maxConcurrentUploads = options.maxConcurrentUploads;
  if (options.transactionBatchSize)
    submitConfigOverrides.transactionBatchSize = options.transactionBatchSize;
  // ... map other options to configOverrides

  const config = createSubmitConfig(submitConfigOverrides);
  logger.debug('Submit configuration:', config);

  // Initialize services
  const fileScannerService = new FileScannerService();
  // const schemaCacheService = new SchemaCacheService(...);
  // const jsonValidatorService = new JsonValidatorService(...);
  // const jsonCanonicalizerService = new JsonCanonicalizerService();
  // const cidCalculatorService = new CidCalculatorService();
  // const chainStateService = new ChainStateService(...);
  // const pinataService = new PinataService(options.pinataJwt, undefined, config.maxConcurrentUploads);
  // const transactionBatcherService = new TransactionBatcherService(options.rpcUrl, options.contractAddress, options.privateKey, config);
  // const csvReporterService = new CsvReporterService(config.errorCsvPath, config.warningCsvPath);
  // await csvReporterService.initialize();

  // --- Phase 1: Discovery (Task 12.2) ---
  logger.info('Phase 1: Discovery - Scanning files...');
  const initialValidation = await fileScannerService.validateStructure(
    options.inputDir
  );
  if (!initialValidation.isValid) {
    logger.error('Input directory structure is invalid. Errors:');
    initialValidation.errors.forEach((err) => logger.error(`- ${err}`));
    // await csvReporterService.finalize(); // Close CSV streams if open
    process.exit(1);
  }
  logger.info('Directory structure validation passed.');

  // const totalFiles = await fileScannerService.countTotalFiles(options.inputDir);
  // logger.info(`Found ${totalFiles} potential files to process.`);
  // Initialize progress tracker here
  // Initialize CSV reporters here

  // --- Phase 2: Validation (Task 12.3) ---
  logger.info('Phase 2: Validation - Validating JSON files against schemas...');
  // Iterate through files using fileScannerService.scanDirectory()
  // For each file:
  //   - Read file content
  //   - Get schema (SchemaCacheService)
  //   - Validate (JsonValidatorService)
  //   - Log errors to CSVReporterService
  //   - Update progress

  // --- Phase 3: Processing (Task 12.4) ---
  logger.info(
    'Phase 3: Processing - Canonicalizing, calculating CIDs, checking chain state...'
  );
  // For each valid file:
  //   - Canonicalize (JsonCanonicalizerService)
  //   - Calculate CID (CidCalculatorService)
  //   - Check chain state (ChainStateService - getCurrentDataCid, getSubmittedParticipants)
  //   - Log warnings (e.g. duplicate, already submitted by user) to CSVReporterService
  //   - Collect files for upload

  // --- Phase 4: Upload (Task 12.5) ---
  logger.info('Phase 4: Upload - Uploading files to IPFS...');
  // If not dryRun:
  //   - Use PinataService.uploadBatch()
  //   - Track uploaded CIDs
  //   - Update progress
  // Else (dryRun):
  //   - Log what would be uploaded

  // --- Phase 5: Transaction (Task 12.6) ---
  logger.info('Phase 5: Transaction - Submitting data to blockchain...');
  // If not dryRun:
  //   - Use TransactionBatcherService.submitAll()
  //   - Monitor completion
  //   - Update progress
  // Else (dryRun):
  //   - Log what transactions would be made

  // --- Final Summary & Cleanup (Task 12.7) ---
  logger.info('Submit process finished.');
  // const reportSummary = await csvReporterService.finalize();
  // logger.info('Report summary:', reportSummary);
  // Handle checkpoint saving / cleanup
}
