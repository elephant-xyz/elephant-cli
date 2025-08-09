import { execSync } from 'child_process';
import * as os from 'os';
import { logger } from './logger.js';

export interface ConcurrencyConfig {
  userSpecified?: number;
  fallback?: number;
  windowsFactor?: number;
}

export interface ConcurrencyResult {
  effectiveConcurrency: number;
  reason: string;
}

/**
 * Calculate the effective concurrency limit based on OS capabilities and user preferences.
 *
 * @param config - Configuration for concurrency calculation
 * @returns The effective concurrency limit and reason
 */
export function calculateEffectiveConcurrency(
  config: ConcurrencyConfig = {}
): ConcurrencyResult {
  const { userSpecified, fallback = 10, windowsFactor = 4 } = config;

  let effectiveConcurrency: number;
  let concurrencyLogReason = '';
  let calculatedOsCap: number | undefined = undefined;

  // Calculate OS-based cap
  if (process.platform !== 'win32') {
    // Unix-like systems: use ulimit
    try {
      const ulimitOutput = execSync('ulimit -n', {
        encoding: 'utf8',
        stdio: 'pipe',
      }).trim();
      const osMaxFiles = parseInt(ulimitOutput, 10);
      if (!isNaN(osMaxFiles) && osMaxFiles > 0) {
        calculatedOsCap = Math.max(1, Math.floor(osMaxFiles * 0.75));
        logger.info(
          `Unix-like system detected. System maximum open files (ulimit -n): ${osMaxFiles}. Calculated concurrency cap (0.75 * OS limit): ${calculatedOsCap}.`
        );
      } else {
        logger.warn(
          `Unix-like system detected, but could not determine a valid OS open file limit from 'ulimit -n' output: "${ulimitOutput}". OS-based capping will not be applied.`
        );
      }
    } catch (error) {
      logger.warn(
        `Unix-like system detected, but failed to check OS open file limit via 'ulimit -n'. OS-based capping will not be applied. Error: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  } else {
    // Windows: use CPU-based heuristic
    logger.info(
      "Windows system detected. 'ulimit -n' based concurrency capping is not applicable."
    );
    if (userSpecified === undefined) {
      const numCpus = os.cpus().length;
      calculatedOsCap = Math.max(1, numCpus * windowsFactor);
      logger.info(
        `Using CPU count (${numCpus}) * ${windowsFactor} as a heuristic for concurrency cap on Windows: ${calculatedOsCap}. This will be used if no user value is provided.`
      );
    }
  }

  // Determine effective concurrency
  if (userSpecified !== undefined) {
    concurrencyLogReason = `User specified: ${userSpecified}.`;
    if (calculatedOsCap !== undefined) {
      if (userSpecified > calculatedOsCap) {
        effectiveConcurrency = calculatedOsCap;
        concurrencyLogReason += ` Capped by OS/heuristic limit to ${effectiveConcurrency}.`;
      } else {
        effectiveConcurrency = userSpecified;
        concurrencyLogReason += ` Within OS/heuristic limit of ${calculatedOsCap}.`;
      }
    } else {
      effectiveConcurrency = userSpecified;
      concurrencyLogReason += ` OS/heuristic limit not determined or applicable, using user value.`;
    }
  } else {
    // User did not specify concurrency
    if (calculatedOsCap !== undefined) {
      effectiveConcurrency = calculatedOsCap;
      concurrencyLogReason = `Derived from OS/heuristic limit (${effectiveConcurrency}), as no user value was provided.`;
    } else {
      effectiveConcurrency = fallback;
      concurrencyLogReason = `Using fallback value (${effectiveConcurrency}), as no user value was provided and OS/heuristic limit could not be determined.`;
    }
  }

  // Validate the result
  if (
    effectiveConcurrency === undefined ||
    effectiveConcurrency === null ||
    effectiveConcurrency <= 0
  ) {
    logger.error(
      `Error: Effective concurrency is invalid (${effectiveConcurrency}). This should not happen. Defaulting to ${fallback}.`
    );
    effectiveConcurrency = fallback;
    concurrencyLogReason += ` Corrected to fallback due to invalid calculation.`;
  }

  logger.technical(
    `Effective max concurrent tasks: ${effectiveConcurrency}. Reason: ${concurrencyLogReason}`
  );

  return {
    effectiveConcurrency,
    reason: concurrencyLogReason,
  };
}
