import { logger } from '../utils/logger.js';
import chalk from 'chalk';
import { Browser as PuppeteerBrowser, Page } from 'puppeteer';
import { TimeoutError } from 'puppeteer';
import { constructUrl } from './common.js';
import { Prepared, Request } from './types.js';

export async function withBrowser(
  req: Request,
  clickContinue = true,
  fast = false
): Promise<Prepared> {
  logger.info('Preparing with browser...');
  const browser: PuppeteerBrowser = await createBrowser();

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
      await page.goto(url, {
        waitUntil: fast ? 'domcontentloaded' : 'networkidle2',
        timeout: fast ? 15000 : 60000,
      });
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
    const elapsedMs = Date.now() - startMs;
    logger.info(`Captured page HTML in ${elapsedMs}ms`);
    return { content: html, type: 'html' } as Prepared;
  } finally {
    await browser.close();
  }
}

async function createBrowser(): Promise<PuppeteerBrowser> {
  if (process.platform === 'linux') {
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
  } else if (process.platform === 'darwin') {
    const puppeteer = await import('puppeteer');
    logger.info('Launching browser...');
    return await puppeteer.launch({
      headless: true,
      timeout: 30000,
    });
  } else {
    const errorMessage =
      'Unsupported platform. Only Linux and macOS are supported.';
    console.log(chalk.red(errorMessage));
    throw new Error(errorMessage);
  }
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
        await page.waitForNavigation({
          waitUntil: 'networkidle2',
          timeout: 30000,
        });
      } catch {
        logger.warn('No navigation after continue; waiting for content');
      }
    } catch {
      logger.warn('Failed to wait for continue button');
    }
  }
}
