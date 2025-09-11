import { Command } from 'commander';
import { Wallet } from 'ethers';
import { writeFileSync, existsSync } from 'fs';
import { logger } from '../utils/logger.js';
import chalk from 'chalk';
import path from 'path';

export function createKeystoreCommand(program: Command) {
  program
    .command('create-keystore')
    .description('Create an encrypted JSON keystore file from a private key')
    .requiredOption(
      '-k, --private-key <key>',
      'Private key to encrypt (with or without 0x prefix)'
    )
    .requiredOption(
      '-p, --password <password>',
      'Password for encrypting the keystore'
    )
    .option(
      '-o, --output <path>',
      'Output file path for the encrypted keystore',
      'keystore.json'
    )
    .option('-f, --force', 'Overwrite output file if it already exists', false)
    .action(async (options) => {
      console.log(chalk.bold.blue('🔐 Elephant Network CLI - Create Keystore'));
      console.log();

      try {
        // Validate private key
        let wallet: Wallet;
        try {
          wallet = new Wallet(options.privateKey.trim());
          logger.technical(`Wallet loaded with address: ${wallet.address}`);
        } catch (error) {
          const errorMsg = `Invalid private key: ${error instanceof Error ? error.message : String(error)}`;
          logger.error(errorMsg);
          console.error(chalk.red(`❌ ${errorMsg}`));
          process.exit(1);
        }

        // Validate password
        if (options.password.length < 8) {
          const errorMsg = 'Password must be at least 8 characters long';
          logger.error(errorMsg);
          console.error(chalk.red(`❌ ${errorMsg}`));
          process.exit(1);
        }

        // Check if output file exists
        const outputPath = path.resolve(options.output);
        if (existsSync(outputPath) && !options.force) {
          const errorMsg = `Output file already exists: ${outputPath}. Use --force to overwrite.`;
          logger.error(errorMsg);
          console.error(chalk.red(`❌ ${errorMsg}`));
          process.exit(1);
        }

        // Encrypt the wallet
        console.log(
          chalk.yellow('🔄 Encrypting wallet... (this may take a few seconds)')
        );

        let lastReportedPercent = 0;
        const progressCallback = (progress: number) => {
          const percent = Math.round(progress * 100);
          if (percent >= 25 && lastReportedPercent < 25) {
            console.log(chalk.gray('  25% complete...'));
            lastReportedPercent = 25;
          } else if (percent >= 50 && lastReportedPercent < 50) {
            console.log(chalk.gray('  50% complete...'));
            lastReportedPercent = 50;
          } else if (percent >= 75 && lastReportedPercent < 75) {
            console.log(chalk.gray('  75% complete...'));
            lastReportedPercent = 75;
          } else if (percent >= 100 && lastReportedPercent < 100) {
            console.log(chalk.gray('  100% complete...'));
            lastReportedPercent = 100;
          }
        };

        const encryptedJson = await wallet.encrypt(
          options.password,
          progressCallback
        );
        logger.technical('Wallet encryption completed');

        // Save to file
        writeFileSync(outputPath, encryptedJson);
        logger.success(`Encrypted keystore saved to: ${outputPath}`);

        console.log();
        console.log(chalk.green(`✅ Encrypted wallet saved to: ${outputPath}`));
        console.log();
        console.log(chalk.bold('📋 Wallet Details:'));
        console.log(`  Address: ${wallet.address}`);
        console.log(`  Output:  ${outputPath}`);
        console.log();
        console.log(chalk.yellow('⚠️  IMPORTANT:'));
        console.log('  - Keep your keystore file safe and secure');
        console.log('  - Remember your password - it cannot be recovered');
        console.log('  - Never share your keystore file or password');
        console.log();
        console.log(chalk.cyan('💡 Usage with submit-to-contract:'));
        console.log(`  elephant-cli submit-to-contract data.csv \\`);
        console.log(`    --keystore-json ${options.output} \\`);
        console.log(`    --keystore-password "YOUR_PASSWORD"`);
        console.log();
      } catch (error) {
        const errorMsg = `Failed to create keystore: ${error instanceof Error ? error.message : String(error)}`;
        logger.error(errorMsg);
        console.error(chalk.red(`❌ ${errorMsg}`));
        process.exit(1);
      }
    });
}
