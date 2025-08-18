import { logger } from '../../../../utils/logger.js';

export type RetryOptions = {
  attempts?: number; // total attempts including the first
  baseDelayMs?: number; // initial delay
  maxDelayMs?: number; // cap delay
};

const DEFAULT_OPTS: Required<RetryOptions> = {
  attempts: 3,
  baseDelayMs: 500,
  maxDelayMs: 4000,
};

function isTransientOpenAIError(error: unknown): boolean {
  const msg =
    error instanceof Error
      ? `${error.message}\n${error.stack ?? ''}`
      : String(error);
  if (/streaming\.mjs/i.test(msg)) return true;
  if (/The server had an error while processing your request/i.test(msg))
    return true;
  if (/ECONNRESET|ETIMEDOUT|ENETUNREACH|ECONNREFUSED/i.test(msg)) return true;
  if (/5\d\d\s*(Server Error|Internal Server Error)?/i.test(msg)) return true;
  return false;
}

function backoff(attempt: number, base: number, max: number): number {
  const delay = Math.min(max, Math.round(base * Math.pow(2, attempt - 1)));
  // jitter +/- 20%
  const jitter = delay * (Math.random() * 0.4 - 0.2);
  return Math.max(0, Math.round(delay + jitter));
}

export async function invokeWithLocalRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {}
): Promise<T> {
  const { attempts, baseDelayMs, maxDelayMs } = { ...DEFAULT_OPTS, ...opts };
  let lastErr: unknown;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isTransientOpenAIError(err) || i === attempts) break;
      const delay = backoff(i, baseDelayMs, maxDelayMs);
      logger.warn(
        `Transient LLM error (attempt ${i}/${attempts}). Retrying in ${delay}ms...`
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
