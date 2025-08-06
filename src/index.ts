#!/usr/bin/env node
import { config } from 'dotenv';
import { Command } from 'commander';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Load environment variables from .env file in current working directory
config({ path: '.env' });
import {
  DEFAULT_RPC_URL,
  DEFAULT_IPFS_GATEWAY,
  DEFAULT_ASSIGNMENTS_CONTRACT_ADDRESS,
} from './config/constants.js';
import { listAssignments } from './commands/list-assignments.js';
// import { registerSubmitFilesCommand } from './commands/submit-files-optimized.js';
import { registerValidateCommand } from './commands/validate.js';
import { registerValidateAndUploadCommand } from './commands/validate-and-upload.js';
import { registerSubmitToContractCommand } from './commands/submit-to-contract.js';
import { registerReconstructDataCommand } from './commands/reconstruct-data.js';
import { registerCheckTransactionStatusCommand } from './commands/check-transaction-status.js';
import { registerHexToCidCommand } from './commands/hex-to-cid.js';
import { registerCidToHexCommand } from './commands/cid-to-hex.js';

// Read version from package.json
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJson = JSON.parse(
  readFileSync(join(__dirname, '../package.json'), 'utf-8')
);

const program = new Command();

program
  .name('elephant-cli')
  .description('CLI tool for Elephant Network on Polygon')
  .version(packageJson.version);

// Register list-assignments command
program
  .command('list-assignments')
  .description('List and download elephant assignments from the blockchain')
  .requiredOption('-o, --oracle <address>', 'Oracle address')
  .option(
    '-c, --contract <address>',
    'Smart contract address',
    DEFAULT_ASSIGNMENTS_CONTRACT_ADDRESS
  )
  .option('-r, --rpc <url>', 'RPC URL', DEFAULT_RPC_URL)
  .option('-g, --gateway <url>', 'IPFS gateway URL', DEFAULT_IPFS_GATEWAY)
  .option('-f, --from-block <number>', 'Starting block number', 'latest')
  .option('-d, --download-dir <path>', 'Download directory', './downloads')
  .action(listAssignments);

// Register submit-files command
// registerSubmitFilesCommand(program);

// Register new split commands
registerValidateCommand(program);
registerValidateAndUploadCommand(program);
registerSubmitToContractCommand(program);
registerCheckTransactionStatusCommand(program);
registerHexToCidCommand(program);
registerCidToHexCommand(program);

// Register reconstruct-data command
registerReconstructDataCommand(program);

program.parse();
