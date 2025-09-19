import { Request } from './types.js';
import { constructUrl } from './common.js';
import { logger } from '../utils/logger.js';
import chalk from 'chalk';
import { Prepared } from './types.js';

export async function withFetch(req: Request): Promise<Prepared> {
  logger.info('Preparing with fetch...');
  const url = constructUrl(req);
  logger.info(`Making ${req.method} request to: ${url}`);

  const startMs = Date.now();
  let res: Response;
  try {
    const body = req.json ? JSON.stringify(req.json) : req.body;
    logger.debug(`Request body: ${body}`);
    logger.debug(`Request headers: ${JSON.stringify(req.headers)}`);

    res = await fetch(url, {
      method: req.method,
      headers: req.headers,
      body: body,
    });
  } catch (e) {
    const code = undiciErrorCode(e);
    if (code === 'UND_ERR_CONNECT_TIMEOUT') {
      console.error(
        chalk.red(
          'TimeoutError: Try changing the geolocation of your IP address to avoid geo-restrictions.'
        )
      );
    }

    logger.error(
      `Network error: ${e instanceof Error ? e.message : String(e)}`
    );
    throw e;
  }

  logger.info(`Response status: ${res.status} ${res.statusText}`);
  logger.debug(
    `Response headers: ${JSON.stringify(Object.fromEntries(res.headers.entries()))}`
  );

  if (!res.ok) {
    const errorText = await res
      .text()
      .catch(() => 'Unable to read error response');
    logger.error(`HTTP error response body: ${errorText}`);
    throw new Error(`HTTP error ${res.status}: ${res.statusText}`);
  }

  const txt = await res.text();
  const type = res.headers.get('content-type')?.includes('html')
    ? 'html'
    : 'json';
  const elapsedMs = Date.now() - startMs;
  logger.info(`Downloaded response body in ${elapsedMs}ms`);
  logger.info(`Response type: ${type}, content length: ${txt.length}`);
  return { content: txt, type };
}

function undiciErrorCode(e: unknown): string | undefined {
  // Direct
  if (
    typeof e === 'object' &&
    e &&
    'code' in e &&
    typeof (e as any).code === 'string'
  ) {
    return (e as any).code;
  }
  // Cause chain
  const cause = (e as any)?.cause;
  if (
    typeof cause === 'object' &&
    cause &&
    'code' in cause &&
    typeof cause.code === 'string'
  ) {
    return cause.code;
  }
  // AggregateError (sometimes Undici wraps connection errors)
  if (e instanceof AggregateError) {
    for (const inner of e.errors ?? []) {
      const c = undiciErrorCode(inner);
      if (c) return c;
    }
  }
  return undefined;
}
