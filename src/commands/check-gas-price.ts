import { Command } from 'commander';
import chalk from 'chalk';
import { DEFAULT_RPC_URL } from '../config/constants.js';
import { GasPriceService } from '../services/gas-price.service.js';
import { logger } from '../utils/logger.js';

export interface CheckGasPriceOptions {
  rpcUrl: string;
}

export function registerCheckGasPriceCommand(program: Command) {
  program
    .command('check-gas-price')
    .description('Check current gas prices on the blockchain network')
    .option(
      '--rpc-url <url>',
      'RPC URL for the blockchain network',
      process.env.RPC_URL || DEFAULT_RPC_URL
    )
    .action(async (options) => {
      const commandOptions: CheckGasPriceOptions = {
        rpcUrl: options.rpcUrl,
      };

      await handleCheckGasPrice(commandOptions);
    });
}

async function handleCheckGasPrice(options: CheckGasPriceOptions) {
  console.log(chalk.bold.blue('🐘 Elephant Network CLI - Check Gas Price'));
  console.log();

  const service = new GasPriceService(options.rpcUrl);

  try {
    const gasPriceInfo = await service.getGasPrice();

    console.log(chalk.bold('📊 Current Gas Prices\n'));

    if (gasPriceInfo.blockNumber) {
      console.log(`Block Number: ${chalk.cyan(gasPriceInfo.blockNumber)}\n`);
    }

    if (gasPriceInfo.legacy) {
      console.log(chalk.bold('Legacy (Type 0) Transaction:'));
      console.log(
        `  Gas Price: ${chalk.green(gasPriceInfo.legacy.gasPrice)} Gwei\n`
      );
    }

    if (gasPriceInfo.eip1559) {
      console.log(chalk.bold('EIP-1559 (Type 2) Transaction:'));
      console.log(
        `  Max Fee Per Gas: ${chalk.green(
          gasPriceInfo.eip1559.maxFeePerGas
        )} Gwei`
      );
      console.log(
        `  Max Priority Fee (Tip): ${chalk.green(
          gasPriceInfo.eip1559.maxPriorityFeePerGas
        )} Gwei`
      );

      if (gasPriceInfo.eip1559.baseFeePerGas) {
        console.log(
          `  Base Fee Per Gas: ${chalk.cyan(
            gasPriceInfo.eip1559.baseFeePerGas
          )} Gwei`
        );
      }
      console.log();
    }

    if (!gasPriceInfo.legacy && !gasPriceInfo.eip1559) {
      console.log(chalk.yellow('No gas price data available from provider'));
    }

    console.log(chalk.green('✅ Gas price check complete'));
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`check-gas-price command failed: ${errorMessage}`);
    console.error(chalk.red(`Error: ${errorMessage}`));
    process.exit(1);
  }
}
