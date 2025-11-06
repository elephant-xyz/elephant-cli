#!/usr/bin/env node
import { config } from 'dotenv';
import { Command } from 'commander';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

config({ path: '.env' });
import { registerValidateCommand } from './commands/validate.js';
import { registerValidateAndUploadCommand } from './commands/validate-and-upload.js';
import { registerSubmitToContractCommand } from './commands/submit-to-contract.js';
import { registerFetchDataCommand } from './commands/fetch-data.js';
import { registerCheckTransactionStatusCommand } from './commands/check-transaction-status.js';
import { registerHexToCidCommand } from './commands/hex-to-cid.js';
import { registerCidToHexCommand } from './commands/cid-to-hex.js';
import { registerHashCommand } from './commands/hash.js';
import { registerUploadCommand } from './commands/upload.js';
import { registerTransformCommand } from './commands/transform/index.js';
import { registerGenerateTransformCommand } from './commands/generate-transform/index.js';
import { registerPrepareCommand } from './commands/prepare/index.js';
import { createKeystoreCommand } from './commands/create-keystore.js';
import { registerMirrorValidateCommand } from './commands/mirror-validate/index.js';

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

registerValidateCommand(program);
registerValidateAndUploadCommand(program);
registerSubmitToContractCommand(program);
registerCheckTransactionStatusCommand(program);
registerHexToCidCommand(program);
registerCidToHexCommand(program);
registerHashCommand(program);
registerUploadCommand(program);
registerFetchDataCommand(program);
registerTransformCommand(program);
registerGenerateTransformCommand(program);
registerPrepareCommand(program);
registerMirrorValidateCommand(program);
createKeystoreCommand(program);

program.parse();

export { CidHexConverterService } from './services/index.js';
