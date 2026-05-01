import { promises as fs } from 'fs';
import path from 'path';
import { HTTPResponse, Page } from 'puppeteer';
import { logger } from '../../utils/logger.js';
import { cleanHtml, createStealthBrowserPage } from '../common.js';
import { ProxyOptions, ScrapePermitError, ScrapeResult } from '../types.js';

const PBC_BASE = 'https://pbc.gov/iPZB.Building';
const PERMITS_URL = (pcn: string) =>
  `${PBC_BASE}/guest/pcnpermits/${pcn}?tb=false`;
const DETAIL_URL = (id: string | number) =>
  `${PBC_BASE}/viewapplication/guest/1/PR/${id}`;
const PERMITS_API_PATTERN = 'PermitSearch/GetGuestPermitsRec';

const NAV_TIMEOUT = 60000;
const CONTENT_WAIT_MS = 5000;
const EXPAND_WAIT_MS = 3000;

interface PermitRecord {
  number: string;
  id: string;
}

/**
 * Intercept the XHR API response that contains permit data including internal IDs.
 * Falls back to DOM extraction if the API response isn't captured.
 */
async function collectPermitsFromApi(
  page: Page,
  listUrl: string
): Promise<PermitRecord[]> {
  const records: PermitRecord[] = [];

  const apiPromise = new Promise<HTTPResponse | null>((resolve) => {
    const timeout = setTimeout(() => resolve(null), NAV_TIMEOUT);
    page.on('response', function handler(response: HTTPResponse) {
      if (response.url().includes(PERMITS_API_PATTERN)) {
        clearTimeout(timeout);
        page.off('response', handler);
        resolve(response);
      }
    });
  });

  await page.goto(listUrl, {
    waitUntil: 'domcontentloaded',
    timeout: NAV_TIMEOUT,
  });

  const apiResponse = await apiPromise;
  if (apiResponse) {
    logger.info('Intercepted permits API response');
    const body = await apiResponse.text().catch(() => '');
    const data = JSON.parse(body || '[]');
    const items = Array.isArray(data) ? data : [];
    for (const item of items) {
      const id = String(
        item.permitId ?? item.PermitId ?? item.id ?? item.Id ?? ''
      );
      const number = String(
        item.permitNo ?? item.PermitNo ?? item.permitNumber ?? ''
      );
      if (id && number) records.push({ number, id });
    }
  }

  if (records.length > 0) {
    logger.info(`Extracted ${records.length} permit(s) from API response`);
    return records;
  }

  logger.info(
    'API interception did not yield IDs, falling back to DOM click approach'
  );
  return [];
}

async function waitForPermitLinks(page: Page): Promise<number> {
  logger.info('Waiting for permits list content to load...');

  await page
    .waitForFunction(() => document.querySelector('.pointer-link'), {
      timeout: NAV_TIMEOUT,
    })
    .catch(() => {
      logger.warn('No .pointer-link elements found within timeout');
    });

  await new Promise((resolve) => setTimeout(resolve, CONTENT_WAIT_MS));

  const count = await page.evaluate(
    () => document.querySelectorAll('.pointer-link').length
  );
  logger.info(`Found ${count} .pointer-link element(s) on page`);
  return count;
}

async function extractPermitNumbers(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const elements = document.querySelectorAll('.pointer-link');
    const numbers: string[] = [];
    for (const el of elements) {
      const text = (el.textContent || '').replace(/<!--.*?-->/g, '').trim();
      if (text) numbers.push(text);
    }
    return numbers;
  });
}

async function scrapeDetailByUrl(
  page: Page,
  permit: PermitRecord,
  outputDir: string
): Promise<string> {
  const url = DETAIL_URL(permit.id);
  logger.info(`Navigating directly to permit: ${permit.number} (${url})`);

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });

  await page
    .waitForFunction(
      () =>
        document.body.innerText.includes('Application Date') ||
        document.body.innerText.includes('View Application'),
      { timeout: NAV_TIMEOUT }
    )
    .catch(() => {
      logger.warn('Detail page content not fully detected');
    });

  await new Promise((resolve) => setTimeout(resolve, CONTENT_WAIT_MS));

  await expandAllSections(page);

  return saveDetailHtml(page, permit.number, outputDir);
}

async function scrapeDetailByClick(
  page: Page,
  index: number,
  permitNumber: string,
  outputDir: string
): Promise<string> {
  logger.info(`Clicking permit link at index ${index}: ${permitNumber}`);

  await page.evaluate((idx: number) => {
    const links = document.querySelectorAll('.pointer-link');
    if (links[idx]) (links[idx] as HTMLElement).click();
  }, index);

  await page
    .waitForFunction(
      () =>
        document.body.innerText.includes('Application Date') ||
        document.body.innerText.includes('View Application'),
      { timeout: NAV_TIMEOUT }
    )
    .catch(() => {
      logger.warn('Detail page content not detected after click');
    });

  await new Promise((resolve) => setTimeout(resolve, CONTENT_WAIT_MS));

  await expandAllSections(page);

  const filepath = await saveDetailHtml(page, permitNumber, outputDir);

  logger.info('Navigating back to permits list...');
  const clicked = await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find((el) =>
      (el.textContent || '').trim().toLowerCase().includes('go back')
    ) as HTMLElement | undefined;
    if (btn) {
      btn.click();
      return true;
    }
    return false;
  });

  if (!clicked) {
    logger.info('"Go Back" button not found, using browser back');
    await page.goBack({ waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
  }

  await waitForPermitLinks(page);

  return filepath;
}

async function expandAllSections(page: Page): Promise<void> {
  const expanded = await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button, a, span')).find(
      (el) => (el.textContent || '').trim().toLowerCase().includes('expand all')
    ) as HTMLElement | undefined;
    if (btn) {
      btn.click();
      return true;
    }
    return false;
  });

  if (expanded) {
    logger.info('Clicked "Expand All" on detail page');
    await new Promise((resolve) => setTimeout(resolve, EXPAND_WAIT_MS));
  }
}

async function saveDetailHtml(
  page: Page,
  permitNumber: string,
  outputDir: string
): Promise<string> {
  const raw = await page.content();
  const content = await cleanHtml(raw);

  const safe = permitNumber.replace(/[^a-zA-Z0-9_-]/g, '_');
  const base = `${safe}.html`;
  const candidate = path.join(outputDir, base);
  const exists = await fs.access(candidate).then(
    () => true,
    () => false
  );
  const filename = exists ? `${safe}_${Date.now()}.html` : base;
  const filepath = path.join(outputDir, filename);
  await fs.writeFile(filepath, content, 'utf-8');
  logger.info(`Saved permit detail: ${filepath}`);
  return filepath;
}

export async function scrapePalmBeachPermits(
  pcn: string,
  outputDir: string,
  headless: boolean,
  proxy?: ProxyOptions
): Promise<ScrapeResult> {
  await fs.mkdir(outputDir, { recursive: true });

  await using page = await createStealthBrowserPage(headless, proxy);

  const listUrl = PERMITS_URL(pcn);
  logger.info(`Navigating to permits list: ${listUrl}`);

  const apiRecords = await collectPermitsFromApi(page, listUrl);
  const useDirectNav = apiRecords.length > 0;

  if (!useDirectNav) {
    await waitForPermitLinks(page);
  }

  const listHtml = await cleanHtml(await page.content());
  const listPath = path.join(outputDir, `${pcn}_permits_list.html`);
  await fs.writeFile(listPath, listHtml, 'utf-8');
  logger.info(`Saved permits list page: ${listPath}`);

  const permitNumbers = useDirectNav
    ? apiRecords.map((r) => r.number)
    : await extractPermitNumbers(page);

  logger.info(
    `${permitNumbers.length} permit(s) to scrape: ${permitNumbers.join(', ')}`
  );

  if (permitNumbers.length === 0) {
    const msg = headless
      ? 'No permits found. This site may block headless browsers via reCAPTCHA. Try --no-headless if you expect permits.'
      : 'No permits found. The PCN may have no permits on file.';
    logger.warn(msg);
    return {
      pcn,
      county: 'palm-beach',
      files: [listPath],
      permitCount: 0,
      errors: [],
    };
  }

  const files = [listPath];
  const errors: ScrapePermitError[] = [];

  for (const [idx, number] of permitNumbers.entries()) {
    logger.info(
      `[${idx + 1}/${permitNumbers.length}] Scraping permit ${number}...`
    );

    try {
      const filepath = useDirectNav
        ? await scrapeDetailByUrl(page, apiRecords[idx], outputDir)
        : await scrapeDetailByClick(page, idx, number, outputDir);
      files.push(filepath);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`Failed to scrape permit ${number}: ${message}`);
      errors.push({ permitNumber: number, error: message });
    }
  }

  if (errors.length > 0) {
    logger.warn(
      `Completed with ${errors.length} error(s) out of ${permitNumbers.length} permit(s)`
    );
  }

  return {
    pcn,
    county: 'palm-beach',
    files,
    permitCount: permitNumbers.length,
    errors,
  };
}
