import { Request } from './types.js';
import { Browser } from 'puppeteer';
import * as prettier from 'prettier';
import * as cheerio from 'cheerio';
import { logger } from '../utils/logger.js';
import chalk from 'chalk';

export function constructUrl(req: Request) {
  const url = new URL(req.url);
  const query = new URLSearchParams();
  for (const [key, values] of Object.entries(req.multiValueQueryString)) {
    for (const value of values) query.append(key, value);
  }
  url.search = query.toString();
  return url.toString();
}

export function parseUrlToRequest(urlString: string): Request {
  const url = new URL(urlString);
  const multiValueQueryString: Record<string, string[]> = {};

  // Group query parameters by key (support multiple values per key)
  url.searchParams.forEach((value, key) => {
    if (!multiValueQueryString[key]) {
      multiValueQueryString[key] = [];
    }
    multiValueQueryString[key].push(value);
  });

  return {
    url: `${url.protocol}//${url.host}${url.pathname}`,
    method: 'GET',
    multiValueQueryString,
  };
}

/**
 * Strips embedded JS & CSS from raw HTML while preserving structure and classes.
 * - Removes: <script>, <style>, <noscript>, <link rel="stylesheet">
 * - Removes inline CSS (style="...")
 * - Preserves all other tags and attributes like class, id, data-*
 * - Keeps/normalizes DOCTYPE if present
 */
export async function cleanHtml(rawHtml: string): Promise<string> {
  // Preserve original doctype if present
  const doctypeMatch = rawHtml.match(/<!DOCTYPE[^>]*>/i);
  const doctype = doctypeMatch?.[0] ?? '<!DOCTYPE html>';

  const $ = cheerio.load(rawHtml, {
    xmlMode: false,
    scriptingEnabled: false,
  });

  $('script, style, noscript').remove();

  $('link[rel~="stylesheet"]').remove();

  $('[style]').each((_, el) => {
    $(el).removeAttr('style');
  });

  const cleaned = $.root().children().toString();
  return await prettierFormat(`${doctype}\n${cleaned}`);
}

async function prettierFormat(content: string): Promise<string> {
  return prettier.format(content, { parser: 'html' });
}

export async function createBrowser(headless: boolean): Promise<Browser> {
  if (process.env.AWS_EXECUTION_ENV) {
    const puppeteer = await import('puppeteer');
    const { default: Chromium } = await import('@sparticuz/chromium');
    logger.info('Launching browser...');
    return await puppeteer.launch({
      ignoreDefaultArgs: ['--disable-extensions'],
      executablePath: await Chromium.executablePath(),
      headless: 'shell',
      args: [
        ...Chromium.args,
        '--hide-scrollbars',
        '--disable-web-security',
        '--no-sandbox',
      ],
      timeout: 30000,
    });
  } else if (process.platform === 'linux') {
    const puppeteer = await import('puppeteer');

    const bundledExec =
      typeof (puppeteer as any).executablePath === 'function'
        ? (puppeteer as any).executablePath()
        : undefined;

    const execPath = process.env.CHROME_PATH || bundledExec;

    logger.info(
      `Launching browser (Linux/Colab) with execPath=${execPath || '<bundled>'} ...`
    );

    // Optional light diagnostics (kept minimal to avoid noisy output)
    logger.info(`Node.js: ${process.versions.node}`);

    return await puppeteer.launch({
      headless: true, // headless required in Colab
      executablePath: execPath,
      // CRITICAL: avoid spamming Colab output
      dumpio: false,
      // Prefer a pipe over a TCP port in notebook containers
      pipe: true,
      args: [
        '--remote-debugging-pipe',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--no-zygote',
        '--no-first-run',
        '--hide-scrollbars',
        '--disable-gpu',
        '--disable-software-rasterizer',
      ],
      timeout: 60_000, // give Chrome a bit more time on first run
    });
  } else if (process.platform === 'darwin') {
    const puppeteer = await import('puppeteer');
    logger.info('Launching browser...');
    return await puppeteer.launch({
      headless: headless,
      timeout: 30000,
    });
  } else {
    const errorMessage =
      'Unsupported platform. Only Linux and macOS are supported.';
    console.log(chalk.red(errorMessage));
    throw new Error(errorMessage);
  }
}
