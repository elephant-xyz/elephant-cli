import { existsSync } from 'fs';
import chalk from 'chalk';
import { logger } from '../../utils/logger.js';
import { runAIAgent } from '../../utils/ai-agent.js';

export interface LegacyTransformOptions {
  outputZip?: string;
  [key: string]: any;
}

export async function handleLegacyTransform(options: LegacyTransformOptions) {
  try {
    logger.info('Running AI-agent transformer...');

    const outputZip = options.outputZip || 'transformed-data.zip';
    const aiAgentArgs = buildAIAgentArgs(options, outputZip);

    try {
      const exitCode = runAIAgent(aiAgentArgs);
      if (exitCode !== 0) {
        throw new Error(`AI-agent exited with code ${exitCode}`);
      }
      logger.success('AI-agent transformer completed successfully');
    } catch (execError) {
      logger.error('AI-agent transformer failed');
      throw execError;
    }

    if (!existsSync(outputZip)) {
      throw new Error(`Expected output ZIP file not found: ${outputZip}`);
    }

    logger.success(`Transformation complete! Output saved to: ${outputZip}`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(chalk.red(`Error during transform: ${errorMessage}`));
    if (error instanceof Error && error.stack) {
      logger.debug(error.stack);
    }
    process.exit(1);
  }
}

function buildAIAgentArgs(
  options: LegacyTransformOptions,
  outputZip: string
): string[] {
  const args: string[] = ['--transform'];

  for (const [key, value] of Object.entries(options)) {
    if (key === 'outputZip') continue;
    if (key === 'legacyMode') continue;
    const argName = key.replace(/([A-Z])/g, '-$1').toLowerCase();
    if (typeof value === 'boolean') {
      if (value) args.push(`--${argName}`);
    } else if (value !== undefined && value !== null) {
      args.push(`--${argName}`, String(value));
    }
  }

  args.push('--output-zip', outputZip);

  const processArgs = process.argv.slice(3);
  const outputZipIndex = processArgs.findIndex((arg) => arg === '--output-zip');
  for (let i = 0; i < processArgs.length; i++) {
    const arg = processArgs[i];
    if (i === outputZipIndex || i === outputZipIndex + 1) continue;
    const cleanArg = arg.replace(/^--/, '').replace(/-/g, '');
    const inOptions = Object.keys(options).some(
      (key) => key.toLowerCase().replace(/-/g, '') === cleanArg.toLowerCase()
    );
    if (!inOptions && arg.startsWith('--')) {
      args.push(arg);
      if (i + 1 < processArgs.length && !processArgs[i + 1].startsWith('--')) {
        args.push(processArgs[i + 1]);
        i++;
      }
    } else if (!inOptions && !arg.startsWith('--')) {
      args.push(arg);
    }
  }

  return args;
}
