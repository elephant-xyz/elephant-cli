import { Request } from './types.js';
import { Browser, Page } from 'puppeteer';
import * as prettier from 'prettier';
import * as cheerio from 'cheerio';
import { logger } from '../utils/logger.js';
import { ProxyOptions } from './types.js';
import chalk from 'chalk';

interface AsyncDisposablePage extends Page {
  [Symbol.asyncDispose](): Promise<void>;
}

export function constructUrl(req: {
  url: string;
  multiValueQueryString?: Record<string, string[]>;
}) {
  const url = new URL(req.url);
  if (req.multiValueQueryString) {
    const query = new URLSearchParams();
    for (const [key, values] of Object.entries(req.multiValueQueryString)) {
      for (const value of values) query.append(key, value);
    }
    url.search = query.toString();
  }
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

  const pathname =
    url.pathname === '/'
      ? ''
      : url.pathname.endsWith('/')
        ? url.pathname.slice(0, -1)
        : url.pathname;
  return {
    url: `${url.protocol}//${url.host}${pathname}`,
    method: 'GET',
    multiValueQueryString,
  };
}

/**
 * Executes an HTTP request with logging and error handling.
 * This is a shared implementation used by withFetch and multi-request flow executor.
 *
 * @param url - The full URL to request
 * @param method - HTTP method
 * @param headers - Optional headers
 * @param body - Optional request body
 * @returns Response object and response text
 */
export async function executeFetch(
  url: string,
  method: string,
  headers?: Record<string, string>,
  body?: string
): Promise<{ response: Response; responseText: string }> {
  logger.info(`Making ${method} request to: ${url}`);

  logger.debug(`Request headers: ${JSON.stringify(headers)}`);
  if (body) {
    logger.debug(
      `Request body: ${body.substring(0, 200)}${body.length > 200 ? '...' : ''}`
    );
  }

  const startMs = Date.now();
  let response: Response;

  try {
    response = await fetch(url, {
      method,
      headers,
      body,
    });
  } catch (error) {
    logger.error(
      `Network error: ${error instanceof Error ? error.message : String(error)}`
    );
    throw error;
  }

  logger.info(`Response status: ${response.status} ${response.statusText}`);
  logger.debug(
    `Response headers: ${JSON.stringify(Object.fromEntries(response.headers.entries()))}`
  );

  if (!response.ok) {
    const errorText = await response
      .text()
      .catch(() => 'Unable to read error response');
    logger.error(`HTTP error response body: ${errorText}`);
    throw new Error(`HTTP error ${response.status}: ${response.statusText}`);
  }

  const responseText = await response.text();
  const elapsedMs = Date.now() - startMs;
  logger.info(
    `Downloaded response body in ${elapsedMs}ms (${responseText.length} bytes)`
  );

  return { response, responseText };
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
  const html = `${doctype}\n${cleaned}`;
  try {
    return await prettierFormat(html);
  } catch (error) {
    return html;
  }
}

async function prettierFormat(content: string): Promise<string> {
  try {
    return prettier.format(content, { parser: 'html' });
  } catch (error) {
    logger.warn(
      'Failed to format HTML with prettier, returning unformatted content'
    );
    return content;
  }
}

export async function createBrowserPage(
  headless: boolean,
  proxy?: ProxyOptions
): Promise<AsyncDisposablePage> {
  const additionalArgs = proxy
    ? ['--proxy-server=' + proxy.ip + ':' + proxy.port]
    : [];
  let browser: Browser;
  if (process.platform === 'linux') {
    const puppeteer = await import('puppeteer');
    const { default: Chromium } = await import('@sparticuz/chromium');
    logger.info('Launching browser...');
    browser = await puppeteer.launch({
      ignoreDefaultArgs: ['--disable-extensions'],
      executablePath: await Chromium.executablePath(),
      headless: 'shell',
      args: [
        ...Chromium.args,
        '--hide-scrollbars',
        '--disable-web-security',
        '--no-sandbox',
        '--disable-features=site-per-process',
        ...additionalArgs,
      ],
      timeout: 30000,
    });
  } else if (process.platform === 'darwin') {
    const puppeteer = await import('puppeteer');
    logger.info('Launching browser...');
    browser = await puppeteer.launch({
      headless: headless,
      timeout: 30000,
      args: ['--no-sandbox', '--disable-web-security', ...additionalArgs],
    });
  } else {
    const errorMessage =
      'Unsupported platform. Only Linux and macOS are supported.';
    console.log(chalk.red(errorMessage));
    throw new Error(errorMessage);
  }
  const page = await browser.newPage();
  (page as AsyncDisposablePage)[Symbol.asyncDispose] = async () => {
    await browser.close();
  };
  if (proxy) {
    await page.authenticate({
      username: proxy.username,
      password: proxy.password,
    });
  }
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const type = req.resourceType();
    const blocked = ['image', 'stylesheet', 'font', 'media', 'websocket'];
    if (blocked.includes(type)) req.abort();
    else req.continue();
  });
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });
  await page.setUserAgent(
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36'
  );
  await page.setExtraHTTPHeaders({
    'Accept-Language': 'en-US,en;q=0.9',
  });
  return page as AsyncDisposablePage;
}
