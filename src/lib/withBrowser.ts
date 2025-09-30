import { logger } from '../utils/logger.js';
import chalk from 'chalk';
import {
  Browser as PuppeteerBrowser,
  TimeoutError,
  Page,
  HTTPResponse,
} from 'puppeteer';
import { constructUrl, createBrowser } from './common.js';
import { Prepared, Request } from './types.js';
import { PREPARE_DEFAULT_ERROR_HTML_PATTERNS } from '../config/constants.js';

const DEFAULT_ERROR_PATTERNS_LOWER = PREPARE_DEFAULT_ERROR_HTML_PATTERNS.map(
  (p) => p.trim().toLowerCase()
).filter((p) => p.length > 0);

const BUTTON_CLICK_DELAY_MS = 1000;

export async function withBrowser(
  req: Request,
  clickContinue: boolean = false,
  fast: boolean = true,
  requestId: string,
  headless: boolean,
  errorPatterns?: string[],
  continueButtonSelector?: string,
  ignoreCaptcha: boolean = false
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

    // Check if we landed on a reCAPTCHA page and wait for redirect
    const hasRecaptcha = await checkForRecaptcha(page);

    if (hasRecaptcha) {
      if (ignoreCaptcha) {
        logger.info('CAPTCHA detected but ignoring due to ignoreCaptcha flag');
      } else {
        await handleRecaptchaRedirect(page);
      }
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

    if (continueButtonSelector) {
      await clickCustomContinueButton(page, continueButtonSelector);
    } else if (clickContinue) {
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

    // Don't treat reCAPTCHA success pages as errors
    const url = await page.url();
    const isRecaptchaSuccess = url.toLowerCase().includes('recaptchatoken=');

    const bad = detectErrorHtml(
      html,
      errorPatterns,
      isRecaptchaSuccess || ignoreCaptcha
    );
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

async function checkForRecaptcha(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const url = window.location.href;
    const hasRecaptchaElement =
      !!document.querySelector('.g-recaptcha') ||
      !!document.querySelector('[id*="recaptcha"]') ||
      !!document.querySelector('[class*="recaptcha"]');
    return url.toLowerCase().includes('recaptchatoken=') || hasRecaptchaElement;
  });
}

async function handleRecaptchaRedirect(page: Page): Promise<void> {
  logger.info('Detected reCAPTCHA page, waiting for redirect...');
  const startUrl = await page.url();
  const redirectCompleted = await page
    .waitForFunction(
      (startUrl) => {
        const currentUrl = window.location.href;
        return (
          currentUrl !== startUrl &&
          !currentUrl.toLowerCase().includes('recaptchatoken=')
        );
      },
      { timeout: 60000 },
      startUrl
    )
    .then(() => {
      logger.info('reCAPTCHA redirect completed');
      return true;
    })
    .catch((e) => {
      logger.warn(`reCAPTCHA redirect timeout: ${e}`);
      return false;
    });

  if (redirectCompleted) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
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

async function clickCustomContinueButton(page: Page, selector: string) {
  try {
    logger.info(`Looking for continue button with selector: ${selector}`);
    await page.waitForSelector(selector, { timeout: 15000, visible: true });
    await page.click(selector);
    logger.info(`Successfully clicked continue button: ${selector}`);
    // Wait a bit for any page changes after clicking
    await new Promise((resolve) => setTimeout(resolve, BUTTON_CLICK_DELAY_MS));
  } catch (error) {
    logger.warn(
      `Failed to click continue button ${selector}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
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

function detectErrorHtml(
  html: string,
  extra?: string[],
  skipCaptchaCheck?: boolean
): string | null {
  const lowered = html.toLowerCase();
  for (const q of DEFAULT_ERROR_PATTERNS_LOWER) {
    if (skipCaptchaCheck && q === 'captcha') continue;
    if (lowered.includes(q)) return q;
  }
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
