import path from 'path';
import { tmpdir } from 'os';
import AdmZip from 'adm-zip';
import { promises as fs } from 'fs';
import { extractZipToTemp } from '../utils/zip.js';
import { PREPARE_DEFAULT_ERROR_HTML_PATTERNS } from '../config/constants.js';
import { logger } from '../utils/logger.js';
import chalk from 'chalk';
import { Browser as PuppeteerBrowser } from 'puppeteer';
import { TimeoutError } from 'puppeteer';

export type PrepareOptions = {
  clickContinue?: boolean;
  fast?: boolean;
  useBrowser?: boolean;
  errorPatterns?: string[];
};

type Prepared = { content: string; type: 'json' | 'html' };

type Request = {
  url: string;
  method: 'GET' | 'POST';
  multiValueQueryString: Record<string, string[]>;
  headers?: Record<string, string>;
  json?: unknown;
  body?: string;
};

export async function prepare(
  inputZip: string,
  outputZip: string,
  options: PrepareOptions = {}
) {
  // Caller (CLI/service) passes options.
  // Defaults: browser=false (via useBrowser flag only), fast=true, clickContinue defaults to true (handled below)
  const effectiveBrowser = options.useBrowser === true;
  const effectiveClickContinue = options.clickContinue;
  const effectiveFast = options.fast !== false;
  const root = await fs.mkdtemp(path.join(tmpdir(), 'elephant-prepare-'));
  try {
    const dir = await extractZipToTemp(inputZip, root);

    const seed = await fs.readFile(
      path.join(dir, 'property_seed.json'),
      'utf-8'
    );
    try {
      await fs.access(path.join(dir, 'unnormalized_address.json'));
    } catch {
      console.error(
        chalk.red('unnormalized_address.json is missing in the input zip')
      );
      throw new Error('unnormalized_address.json is missing in the input zip');
    }

    const obj = JSON.parse(seed) as Record<string, unknown>;
    const req = obj.source_http_request as Request | undefined;
    const id = obj.request_identifier as string | undefined;
    if (!req) throw new Error('property_seed.json missing source_http_request');
    if (!id) throw new Error('property_seed.json missing request_identifier');

    const prepared =
      req.method === 'GET' && effectiveBrowser
        ? await withBrowser(
            req,
            effectiveClickContinue !== false,
            effectiveFast === true,
            options.errorPatterns
          )
        : await withFetch(req);

    const name = `${id}.${prepared.type}`;
    await fs.writeFile(path.join(root, name), prepared.content, 'utf-8');

    const zip = new AdmZip();
    for (const rel of await fs.readdir(root))
      zip.addLocalFile(path.join(root, rel));
    zip.writeZip(outputZip);
  } finally {
    try {
      await fs.rm(root, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
}

async function withFetch(req: Request): Promise<Prepared> {
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

async function withBrowser(
  req: Request,
  clickContinue = true,
  fast = false,
  errorPatterns?: string[]
): Promise<Prepared> {
  logger.info('Preparing with browser...');
  let browser: PuppeteerBrowser;
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
      ],
      timeout: 30000,
    });
  } else if (process.platform === 'darwin') {
    const puppeteer = await import('puppeteer');
    logger.info('Launching browser...');
    browser = await puppeteer.launch({
      headless: true,
      timeout: 30000,
    });
  } else {
    const errorMessage =
      'Unsupported platform. Only Linux and macOS are supported.';
    console.log(chalk.red(errorMessage));
    throw new Error(errorMessage);
  }
  try {
    logger.info('Creating page...');
    const page = await browser.newPage();
    if (fast) {
      await page.setRequestInterception(true);
      page.on('request', (req) => {
        const type = req.resourceType();
        const blocked = ['image', 'stylesheet', 'font', 'media', 'websocket'];
        if (blocked.includes(type)) req.abort();
        else req.continue();
      });
    }
    const startMs = Date.now();
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });
    await page.setUserAgent(
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36'
    );
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
      Accept: 'text/html,application/xhtml+xml',
    });
    logger.info('Navigating to URL...');
    try {
      const url = constructUrl(req);
      logger.info(`Navigating to URL: ${url}`);
      const navRes = await page.goto(url, {
        waitUntil: fast ? 'domcontentloaded' : 'networkidle2',
        timeout: fast ? 15000 : 60000,
      });
      assertNavigationOk(navRes, 'initial navigation');
    } catch (e) {
      logger.error(`Error navigating to URL: ${e}`);
      if (e instanceof TimeoutError) {
        console.error(
          chalk.red(
            'TimeoutError: Try changing the geolocation of your IP address to avoid geo-restrictions.'
          )
        );
      }
      throw e;
    }

    await Promise.race([
      page
        .waitForSelector('#pnlIssues', { visible: true, timeout: 8000 })
        .catch(() => {}),
      page
        .waitForFunction(
          () =>
            document.querySelector('#parcelLabel') ||
            document.querySelector('.sectionTitle') ||
            document.querySelector('table.detailsTable') ||
            document.querySelector('.textPanel') ||
            document.querySelector('[id*="Property"]'),
          { timeout: 15000 }
        )
        .catch(() => {}),
    ]);

    if (clickContinue) {
      const info = await page.evaluate(() => {
        const modal = document.getElementById('pnlIssues');
        if (!modal) return null as null | { buttonSelector: string };
        const s = window.getComputedStyle(modal);
        const vis =
          s.display !== 'none' &&
          s.visibility !== 'hidden' &&
          Number(s.zIndex) > 0;
        if (!vis) return null;
        const btn =
          (modal.querySelector('#btnContinue') as
            | HTMLInputElement
            | HTMLButtonElement
            | null) ||
          (modal.querySelector(
            'input[name="btnContinue"]'
          ) as HTMLInputElement | null) ||
          (modal.querySelector(
            'input[value="Continue"]'
          ) as HTMLInputElement | null) ||
          (modal.querySelector(
            'button[value="Continue"]'
          ) as HTMLButtonElement | null);
        if (!btn) return null;
        const sel = btn.name
          ? `input[name="${btn.name}"]`
          : btn.id === 'btnContinue'
            ? '#btnContinue'
            : 'input[value="Continue"]';
        return { buttonSelector: sel };
      });

      if (info) {
        try {
          await page.waitForSelector(info.buttonSelector, {
            visible: true,
            timeout: 5000,
          });
          await page.click(info.buttonSelector);
          logger.info(`Clicked continue button: ${info.buttonSelector}`);
          try {
            const contRes = await page.waitForNavigation({
              waitUntil: 'networkidle2',
              timeout: 30000,
            });
            assertNavigationOk(contRes, 'after continue');
          } catch {
            logger.warn('No navigation after continue; waiting for content');
          }
        } catch {
          logger.warn('Failed to wait for continue button');
        }
      }
    } else {
      logger.info('Skipping Continue modal click by flag');
    }

    if (fast) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    } else {
      await Promise.race([
        page
          .waitForFunction(() => document.readyState === 'complete', {
            timeout: 15000,
          })
          .catch(() => null),
        page
          .waitForSelector('#parcelLabel', { visible: true, timeout: 15000 })
          .catch(() => null),
        page
          .waitForFunction(
            () =>
              document.querySelector('#valueGrid') ||
              document.querySelector('#PropertyDetails') ||
              document.querySelector('#PropertyDetailsCurrent') ||
              document.querySelector('#divDisplayParcelOwner') ||
              document.querySelector('#divDisplayParcelPhoto'),
            { timeout: 15000 }
          )
          .catch(() => null),
      ]);

      await page
        .waitForFunction(
          () =>
            document.querySelector('#valueGrid') ||
            document.querySelector('#PropertyDetails') ||
            document.querySelector('#PropertyDetailsCurrent') ||
            document.querySelector('#divDisplayParcelOwner') ||
            document.querySelector('#divDisplayParcelPhoto'),
          { timeout: 30000 }
        )
        .catch(() => {
          logger.warn('Deep content not detected; proceeding with current DOM');
        });
    }

    const html = await page.content();
    const bad = detectErrorHtml(html, errorPatterns);
    if (bad) {
      logger.error(`Detected error HTML in browser content: ${bad}`);
      throw new Error(`Browser returned error page: ${bad}`);
    }
    const elapsedMs = Date.now() - startMs;
    logger.info(`Captured page HTML in ${elapsedMs}ms`);
    return { content: html, type: 'html' } as Prepared;
  } finally {
    await browser.close();
  }
}

function constructUrl(req: Request) {
  const url = new URL(req.url);
  const query = new URLSearchParams();
  for (const [key, values] of Object.entries(req.multiValueQueryString)) {
    for (const value of values) query.append(key, value);
  }
  url.search = query.toString();
  return url.toString();
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

function detectErrorHtml(html: string, extra?: string[]): string | null {
  const lowered = html.toLowerCase();
  const base = PREPARE_DEFAULT_ERROR_HTML_PATTERNS;
  const add = extra || [];
  for (const p of [...base, ...add]) {
    const q = p.trim().toLowerCase();
    if (!q) continue;
    if (lowered.includes(q)) return q;
  }
  return null;
}

function assertNavigationOk(
  res: import('puppeteer').HTTPResponse | null,
  phase: string
) {
  if (!res) return;
  const status = res.status();
  if (status >= 400) {
    const statusText = res.statusText();
    logger.error(`HTTP error ${phase}: ${status} ${statusText}`);
    throw new Error(`HTTP error ${status}: ${statusText}`);
  }
}
