#!/usr/bin/env node
import { Command } from 'commander';
import {
  DEFAULT_CONTRACT_ADDRESS,
  DEFAULT_RPC_URL,
  DEFAULT_IPFS_GATEWAY,
} from './config/constants';
import { listAssignments } from './commands/list-assignments';

const program = new Command();

program
  .name('elephant-cli')
  .description('CLI tool for Elephant Network on Polygon')
  .version('1.0.0');

program
  .command('list-assignments')
  .description('List and download elephant assignments from the blockchain')
  .requiredOption('-e, --elephant <address>', 'Elephant address')
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

program.parse();
