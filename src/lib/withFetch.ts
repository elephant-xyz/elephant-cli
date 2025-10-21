import { Request } from './types.js';
import { constructUrl, executeFetch } from './common.js';
import { logger } from '../utils/logger.js';
import chalk from 'chalk';
import { Prepared } from './types.js';

export async function withFetch(req: Request): Promise<Prepared> {
  logger.info('Preparing with fetch...');
  const url = constructUrl(req);
  const body = req.json ? JSON.stringify(req.json) : req.body;

  let response: Response;
  let responseText: string;

  try {
    const result = await executeFetch(url, req.method, req.headers, body);
    response = result.response;
    responseText = result.responseText;
  } catch (e) {
    const code = undiciErrorCode(e);
    if (code === 'UND_ERR_CONNECT_TIMEOUT') {
      console.error(
        chalk.red(
          'TimeoutError: Try changing the geolocation of your IP address to avoid geo-restrictions.'
        )
      );
    }
    throw e;
  }

  const type = response.headers.get('content-type')?.includes('html')
    ? 'html'
    : 'json';
  logger.info(`Response type: ${type}, content length: ${responseText.length}`);
  return { content: responseText, type };
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
