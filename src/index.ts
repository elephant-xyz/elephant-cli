#!/usr/bin/env node
import { config } from 'dotenv';
import { Command } from 'commander';

// Load environment variables from .env file in current working directory
config({ path: '.env' });
import {
  DEFAULT_CONTRACT_ADDRESS,
  DEFAULT_RPC_URL,
  DEFAULT_IPFS_GATEWAY,
} from './config/constants.js';
import { listAssignments } from './commands/list-assignments.js';
import { registerSubmitFilesCommand } from './commands/submit-files.js';

const program = new Command();

program
  .name('elephant-cli')
  .description('CLI tool for Elephant Network on Polygon')
  .version('1.0.0');

// Register list-assignments command
program
  .command('list-assignments')
  .description('List and download elephant assignments from the blockchain')
  .requiredOption('-o, --oracle <address>', 'Oracle address')
  .option(
    '-c, --contract <address>',
    'Smart contract address',
    DEFAULT_CONTRACT_ADDRESS
  )
  .option('-r, --rpc <url>', 'RPC URL', DEFAULT_RPC_URL)
  .option('-g, --gateway <url>', 'IPFS gateway URL', DEFAULT_IPFS_GATEWAY)
  .option('-f, --from-block <number>', 'Starting block number', '0')
  .option('-d, --download-dir <path>', 'Download directory', './downloads')
  .action(listAssignments);

// Register submit-files command
registerSubmitFilesCommand(program);

program.parse();
