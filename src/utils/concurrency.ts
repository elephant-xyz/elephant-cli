import { execSync } from 'child_process';
import * as os from 'os';
import { logger } from './logger.js';

export interface EffectiveConcurrency {
  value: number;
  reason: string;
}

export function determineEffectiveConcurrency(
  userSpecified: number | undefined,
  {
    fallback = 10,
    windowsFactor = 4,
  }: { fallback?: number; windowsFactor?: number } = {}
): EffectiveConcurrency {
  const FALLBACK_LOCAL_CONCURRENCY = fallback;
  const WINDOWS_DEFAULT_CONCURRENCY_FACTOR = windowsFactor;

  let effectiveConcurrency: number;
  let concurrencyLogReason = '';
  let calculatedOsCap: number | undefined = undefined;

  if (process.platform !== 'win32') {
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
    logger.info(
      "Windows system detected. 'ulimit -n' based concurrency capping is not applicable."
    );
    if (userSpecified === undefined) {
      const numCpus = os.cpus().length;
      calculatedOsCap = Math.max(
        1,
        numCpus * WINDOWS_DEFAULT_CONCURRENCY_FACTOR
      );
      logger.info(
        `Using CPU count (${numCpus}) * ${WINDOWS_DEFAULT_CONCURRENCY_FACTOR} as a heuristic for concurrency cap on Windows: ${calculatedOsCap}. This will be used if no user value is provided.`
      );
    }
  }

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
    if (calculatedOsCap !== undefined) {
      effectiveConcurrency = calculatedOsCap;
      concurrencyLogReason = `Derived from OS/heuristic limit (${effectiveConcurrency}), as no user value was provided.`;
    } else {
      effectiveConcurrency = FALLBACK_LOCAL_CONCURRENCY;
      concurrencyLogReason = `Using fallback value (${effectiveConcurrency}), as no user value was provided and OS/heuristic limit could not be determined.`;
    }
  }

  if (!effectiveConcurrency || effectiveConcurrency <= 0) {
    logger.error(
      `Error: Effective concurrency is invalid (${effectiveConcurrency}). This should not happen. Defaulting to ${FALLBACK_LOCAL_CONCURRENCY}.`
    );
    effectiveConcurrency = FALLBACK_LOCAL_CONCURRENCY;
    concurrencyLogReason += ` Corrected to fallback due to invalid calculation.`;
  }

  return { value: effectiveConcurrency, reason: concurrencyLogReason };
}
