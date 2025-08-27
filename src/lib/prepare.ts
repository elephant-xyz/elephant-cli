import path from 'path';
import { tmpdir } from 'os';
import AdmZip from 'adm-zip';
import { promises as fs } from 'fs';
import { extractZipToTemp } from '../utils/zip.js';
import { logger } from '../utils/logger.js';
import chalk from 'chalk';

export type PrepareOptions = { noBrowser?: boolean };

type Prepared = { content: string; type: 'json' | 'html' };

type Requset = {
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
  const root = await fs.mkdtemp(path.join(tmpdir(), 'elephant-prepare-'));
  try {
    const dir = await extractZipToTemp(inputZip, root, 'input');

    const seed = await fs.readFile(
      path.join(dir, 'property_seed.json'),
      'utf-8'
    );
    await fs.access(path.join(dir, 'unnormalized_address.json'));

    const obj = JSON.parse(seed) as Record<string, unknown>;
    const req = obj.source_http_request as Requset | undefined;
    const id = obj.request_identifier as string | undefined;
    if (!req) throw new Error('property_seed.json missing source_http_request');
    if (!id) throw new Error('property_seed.json missing request_identifier');

    const noBrowser = options.noBrowser ?? false;
    const prepared =
      req.method === 'GET' && !noBrowser
        ? await withBrowser(req)
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

async function withFetch(req: Requset): Promise<Prepared> {
  const res = await fetch(constructUrl(req), {
    method: req.method,
    headers: req.headers,
    body: req.body,
  });
  if (!res.ok) throw new Error(`HTTP error ${res.status}: ${res.statusText}`);
  const txt = await res.text();
  const type = res.headers.get('content-type')?.includes('html')
    ? 'html'
    : 'json';
  return { content: txt, type };
}

async function withBrowser(req: Requset): Promise<Prepared> {
  logger.info('Preparing with browser...');
  const puppeteer = await import('puppeteer-core');
  const { default: Chromium } = await import('@sparticuz/chromium');
  logger.info('Launching browser...');
  const browser = await puppeteer.launch({
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
  try {
    logger.info('Creating page...');
    const page = await browser.newPage();
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
      await page.goto(constructUrl(req), {
        waitUntil: 'networkidle2',
        timeout: 60000,
      });
    } catch (e) {
      logger.error(`Error navigating to URL: ${e}`);
      if (e instanceof puppeteer.TimeoutError) {
        console.error(
          chalk.red(
            'TimeoutError: Try changing the gelocation of your IP address to avoid geo-restrictions.'
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
        try {
          await Promise.race([
            page.waitForNavigation({
              waitUntil: 'networkidle2',
              timeout: 30000,
            }),
            page
              .waitForFunction(
                () => {
                  const modal = document.getElementById('pnlIssues');
                  if (!modal) return true;
                  const style = window.getComputedStyle(modal);
                  return (
                    style.display === 'none' || style.visibility === 'hidden'
                  );
                },
                { timeout: 30000 }
              )
              .catch(() => {}),
          ]);
        } catch {
          // ignore
        }
        await page
          .waitForFunction(
            () =>
              document.querySelector('#parcelLabel') ||
              document.querySelector('.sectionTitle') ||
              document.querySelector('[id*="Property"]'),
            { timeout: 15000 }
          )
          .catch(() => {});
      } catch {
        // ignore
      }
    }

    await page
      .waitForFunction(
        () =>
          document.querySelector('#parcelLabel') ||
          document.querySelector('.sectionTitle') ||
          document.querySelector('table.detailsTable') ||
          document.querySelector('.textPanel') ||
          document.querySelector('[id*="Property"]'),
        { timeout: 5000 }
      )
      .catch(() => {});

    const html = await page.content();
    return { content: html, type: 'html' } as Prepared;
  } finally {
    await browser.close();
  }
}

function constructUrl(req: Requset) {
  const url = new URL(req.url);
  const query = new URLSearchParams();
  for (const [key, values] of Object.entries(req.multiValueQueryString)) {
    for (const value of values) query.append(key, value);
  }
  url.search = query.toString();
  return url.toString();
}
