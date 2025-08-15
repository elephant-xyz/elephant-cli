import { existsSync } from 'fs';
import { spawnSync, execSync } from 'child_process';
import { logger } from './logger.js';

// Environment variables for configuration
const AI_AGENT_REF = process.env.ELEPHANT_AI_AGENT_REF || 'main';

/**
 * Find the test-evaluator-agent binary in the system
 * @returns Path to the binary or null if not found
 */
function findBinary(): string | null {
  // First check if explicitly specified via environment variable
  const explicitPath = process.env.ELEPHANT_AI_AGENT_PATH;
  if (explicitPath && existsSync(explicitPath)) {
    return explicitPath;
  }

  // Try to find it in PATH using 'which'
  try {
    const binaryPath = execSync('which test-evaluator-agent', {
      encoding: 'utf8',
      stdio: 'pipe',
    }).trim();

    if (binaryPath && existsSync(binaryPath)) {
      return binaryPath;
    }
  } catch {
    // 'which' failed, binary not in PATH
  }

  // Check common installation location as last resort
  const defaultPath = '/opt/elephant/bin/test-evaluator-agent';
  if (existsSync(defaultPath)) {
    return defaultPath;
  }

  return null;
}

/**
 * Run the AI-Agent with the given arguments
 * First tries to use a locally installed binary (via PATH or common locations), then falls back to uvx
 *
 * @param args - Arguments to pass to the AI-Agent
 * @returns Exit code from the AI-Agent process
 */
export function runAIAgent(args: string[]): number {
  // Try to find locally installed binary
  const localBinary = findBinary();

  if (localBinary) {
    logger.debug(`Using local AI-Agent binary at: ${localBinary}`);

    const result = spawnSync(localBinary, args, {
      stdio: ['inherit', 'pipe', 'inherit'], // Suppress stdout, show stderr
      cwd: process.cwd(),
    });

    if (result.error) {
      logger.error(`Failed to execute local AI-Agent: ${result.error.message}`);
      throw result.error;
    }

    return result.status ?? 1;
  }

  // Fallback for development environments: use uvx with pinned ref
  logger.debug(`AI-Agent binary not found locally, falling back to uvx`);
  logger.debug(`Using AI-Agent ref: ${AI_AGENT_REF}`);

  const uvxArgs = [
    '--from',
    `git+https://github.com/elephant-xyz/AI-Agent@${AI_AGENT_REF}`,
    'test-evaluator-agent',
    ...args,
  ];

  const result = spawnSync('uvx', uvxArgs, {
    stdio: ['inherit', 'pipe', 'inherit'], // Suppress stdout, show stderr
    cwd: process.cwd(),
  });

  if (result.error) {
    // Check if uvx is not installed
    if ((result.error as any).code === 'ENOENT') {
      logger.error(
        'uvx is not installed. Please install it with: pip install uv'
      );
      logger.error(
        'Or set ELEPHANT_AI_AGENT_PATH to point to a pre-installed test-evaluator-agent binary'
      );
    } else {
      logger.error(`Failed to execute uvx: ${result.error.message}`);
    }
    throw result.error;
  }

  return result.status ?? 1;
}
