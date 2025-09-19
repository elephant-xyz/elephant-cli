import { logger } from '../utils/logger.js';
import chalk from 'chalk';
import {
  Browser as PuppeteerBrowser,
  TimeoutError,
  Page,
  HTTPResponse,
} from 'puppeteer';
import { constructUrl, cleanHtml, createBrowser } from './common.js';
import { Prepared, Request } from './types.js';
import { PREPARE_DEFAULT_ERROR_HTML_PATTERNS } from '../config/constants.js';

const DEFAULT_ERROR_PATTERNS_LOWER = PREPARE_DEFAULT_ERROR_HTML_PATTERNS.map(
  (p) => p.trim().toLowerCase()
).filter((p) => p.length > 0);

export async function withBrowser(
  req: Request,
  clickContinue: boolean = false,
  fast: boolean = true,
  requestId: string,
  headless: boolean,
  errorPatterns?: string[]
): Promise<Prepared> {
  logger.info('Preparing with browser...');
  const browser: PuppeteerBrowser = await createBrowser(headless);

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
    if (process.env.WEIRED_COUNTY)
      return await loadWeiredConty(page, requestId);

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
      await clickContinueButton(page);
    } else {
      logger.info('Skipping Continue modal click by flag');
    }

    if (fast) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    } else {
      await waitForContent(page);
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

async function loadWeiredConty(
  page: Page,
  requestId: string
): Promise<Prepared> {
  await page.waitForSelector('.btn.btn-primary.button-1', {
    visible: true,
    timeout: 8000,
  });
  await page.click('.btn.btn-primary.button-1');
  await page.type('#ctlBodyPane_ctl03_ctl01_txtParcelID', requestId, {
    delay: 100,
  });
  await page.keyboard.press('Enter');
  await page.waitForSelector(
    '#ctlBodyPane_ctl10_ctl01_lstBuildings_ctl00_dynamicBuildingDataRightColumn_divSummary',
    { visible: true }
  );
  const rawContent = await page.content();
  return { content: await cleanHtml(rawContent), type: 'html' };
}

async function waitForContent(page: Page) {
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

async function clickContinueButton(page: Page) {
  const info = await page.evaluate(() => {
    const modal = document.getElementById('pnlIssues');
    if (!modal) return null as null | { buttonSelector: string };
    const s = window.getComputedStyle(modal);
    const vis =
      s.display !== 'none' && s.visibility !== 'hidden' && Number(s.zIndex) > 0;
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
}

function detectErrorHtml(html: string, extra?: string[]): string | null {
  const lowered = html.toLowerCase();
  for (const q of DEFAULT_ERROR_PATTERNS_LOWER)
    if (lowered.includes(q)) return q;
  const add = extra || [];
  const addLower = add
    .map((p) => p.trim().toLowerCase())
    .filter((q) => q.length > 0);
  for (const q of addLower) if (lowered.includes(q)) return q;
  return null;
}

function assertNavigationOk(res: HTTPResponse | null, phase: string) {
  if (!res) return;
  const status = res.status();
  if (status >= 400) {
    const statusText = res.statusText();
    logger.error(`HTTP error ${phase}: ${status} ${statusText}`);
    throw new Error(`HTTP error ${status}: ${statusText}`);
  }
}
