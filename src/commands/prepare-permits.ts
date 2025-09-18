import { Command } from 'commander';
import chalk from 'chalk';
import path from 'path';
import { tmpdir } from 'os';
import { promises as fs } from 'fs';
import { createSpinner } from '../utils/progress.js';
import { logger } from '../utils/logger.js';
import { extractZipToTemp } from '../utils/zip.js';
import { parse as parseCsvSync } from 'csv-parse/sync';
import AdmZip from 'adm-zip';

const START_SEL = '#ctl00_PlaceHolderMain_generalSearchForm_txtGSStartDate';
const END_SEL = '#ctl00_PlaceHolderMain_generalSearchForm_txtGSEndDate';
const SEARCH_SEL = '#ctl00_PlaceHolderMain_btnNewSearch';
const TABLE_SEL = '#ctl00_PlaceHolderMain_dgvPermitList_gdvPermitList';
const PANEL_SEL = '#ctl00_PlaceHolderMain_dgvPermitList_updatePanel';
const ROW_LINKS = `${TABLE_SEL} a[href*="CapDetail.aspx"]`;

const dateRe = /^\d{2}\/\d{2}\/\d{4}$/;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function normalizeOutputZip(outArg: string | undefined) {
  const base = (outArg || 'output-permits.zip').trim();
  const abs = path.resolve(process.cwd(), base);
  return abs.endsWith('.zip') ? abs : abs + '.zip';
}

async function readUrlFromZip(zipPath: string, csvName?: string): Promise<string> {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'elephant-prepare-permits-'));
  try {
		const dir = await extractZipToTemp(zipPath, root);
		async function listCsvs(d: string): Promise<string[]> {
			const out: string[] = [];
			const items = await fs.readdir(d, { withFileTypes: true });
			for (const it of items) {
				const p = path.join(d, it.name);
				if (it.isDirectory()) {
					const inner = await listCsvs(p);
					for (const x of inner) out.push(x);
				}
				if (it.isFile() && it.name.toLowerCase().endsWith('.csv')) out.push(p);
			}
			return out;
		}
		const csvs = await listCsvs(dir);
		if (csvs.length !== 1) throw new Error(`Input ZIP must contain exactly one CSV file; found ${csvs.length}`);
		const filePath = csvs[0];
		if (csvName && path.basename(filePath) !== csvName) throw new Error(`CSV file must be named ${csvName}`);
    const raw = await fs.readFile(filePath, 'utf-8');
    const rows = parseCsvSync(raw, { columns: true, skip_empty_lines: true }) as Array<Record<string, string>>;
    const first = rows[0];
    if (!first) throw new Error('CSV is empty');
    const url = first.url || first.URL || first.link || first.Link;
    if (!url) throw new Error('CSV must contain a column named "url" with the target URL');
    return String(url).trim();
  } finally {
    await fs.rm(root, { recursive: true, force: true }).catch(() => {});
  }
}

async function launchBrowser() {
  if (process.platform === 'linux') {
    const puppeteer = await import('puppeteer');
    const { default: Chromium } = await import('@sparticuz/chromium');
    return puppeteer.launch({
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
  }
  if (process.platform === 'darwin') {
    const puppeteer = await import('puppeteer');
    return puppeteer.launch({ headless: true, timeout: 30000 });
  }
  const msg = 'Unsupported platform. Only Linux and macOS are supported.';
  console.log(chalk.red(msg));
  throw new Error(msg);
}

async function withPage<T>(run: (page: import('puppeteer').Page) => Promise<T>) {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36'
    );
    return await run(page);
  } finally {
    await browser.close();
  }
}

async function scrapePermits(url: string, start: string, end: string) {
  return withPage(async (page) => {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

    async function setMaskedDate(sel: string, val: string) {
      await page.waitForSelector(sel, { visible: true, timeout: 30000 });
      await page.$eval(
        sel,
        (el, v) => {
          (el as HTMLInputElement).focus();
          (el as HTMLInputElement).value = '';
          el.dispatchEvent(new Event('input', { bubbles: true }));
          (el as HTMLInputElement).value = v as string;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          (el as HTMLInputElement).blur();
          el.dispatchEvent(new Event('change', { bubbles: true }));
        },
        val
      );
    }

    await setMaskedDate(START_SEL, start);
    await setMaskedDate(END_SEL, end);
    await page.waitForSelector(SEARCH_SEL, { visible: true, timeout: 30000 });
    await Promise.all([
      page.waitForNetworkIdle({ idleTime: 700, timeout: 90000 }),
      page.click(SEARCH_SEL),
    ]);

    try {
      await page.waitForSelector(PANEL_SEL, { timeout: 20000 });
      await page.waitForNetworkIdle({ idleTime: 500, timeout: 30000 });
    } catch {}
    await page.waitForSelector(TABLE_SEL, { timeout: 30000 });

    async function scrapePage() {
      return page.$$eval(ROW_LINKS, (links) =>
        links
          .map((a) => {
            const name = (a.textContent || '').trim();
            const href = a.getAttribute('href') || '';
            if (!href || href.startsWith('javascript:')) return null;
            const u = new URL(href, location.origin).toString();
            return { name, url: u };
          })
          .filter(Boolean as unknown as (x: unknown) => x is { name: string; url: string })
      );
    }

    async function clickNextPager() {
      const clicked = await page.evaluate((tableSel) => {
        const tbl = document.querySelector(tableSel);
        const scope = tbl ? (tbl.closest('form') || document) : document;
        const anchors = Array.from(scope.querySelectorAll('a[href^="javascript:__doPostBack"]'));
        const isVisible = (el: Element) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        };
        let next = anchors.find((a) => {
          const t = (a.textContent || '').trim();
          return ['Next', '›', '»'].includes(t) && isVisible(a);
        });
        if (next) {
          (next as HTMLAnchorElement).click();
          return true;
        }
        const nums = anchors
          .map((a) => {
            const t = (a.textContent || '').trim();
            const n = parseInt(t, 10);
            return Number.isFinite(n) ? { a, n } : null;
          })
          .filter((x): x is { a: HTMLAnchorElement; n: number } => Boolean(x))
          .sort((x, y) => x.n - y.n);
        for (let i = nums.length - 1; i >= 0; i--) {
          const cand = nums[i].a;
          if (isVisible(cand)) {
            cand.click();
            return true;
          }
        }
        return false;
      }, TABLE_SEL);
      if (!clicked) return false;
      await page.waitForNetworkIdle({ idleTime: 700, timeout: 90000 }).catch(() => {});
      await page.waitForSelector(TABLE_SEL, { timeout: 30000 }).catch(() => {});
      await page.waitForNetworkIdle({ idleTime: 400, timeout: 30000 }).catch(() => {});
      return true;
    }

    const out: Array<{ name: string; url: string }> = [];
    let lastFirst: string | null = null;
    let maxPages = 999;
    try {
      const pageCountAttr = await page.$eval(
        TABLE_SEL,
        (tbl) => parseInt((tbl as HTMLElement).getAttribute('pagecount') || '0', 10)
      );
      if (Number.isFinite(pageCountAttr) && pageCountAttr > 0) maxPages = pageCountAttr;
    } catch {}

    for (let pageIdx = 1; pageIdx <= maxPages; pageIdx++) {
      const items = await scrapePage();
      logger.info(`Page ${pageIdx}: scraped ${items.length} records`);
      out.push(...items);
      const currentFirst = items[0]?.name || '';
      const moved = await clickNextPager();
      if (!moved) break;
      await page.waitForSelector(ROW_LINKS, { timeout: 30000 }).catch(() => {});
      let newFirst = '';
      try {
        newFirst = await page.$eval(ROW_LINKS, (a) => (a.textContent || '').trim());
      } catch {}
      if (!newFirst || newFirst === currentFirst || newFirst === lastFirst) break;
      lastFirst = newFirst;
      await sleep(250);
    }

    const seen = new Set<string>();
    const dedup = out.filter((r) => {
      const k = `${r.name}::${r.url}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    return dedup;
  });
}

export interface PreparePermitsOptions {
  start: string;
  end: string;
  output?: string;
  urlCsv?: string;
}

export type PreparePermitsResult = {
  success: boolean;
  outputZip: string;
  count: number;
};

export function registerPreparePermitsCommand(program: Command) {
  program
    .command('prepare-permits <inputZip>')
    .description('Scrape permit record links for a date range (pre-prepare step)')
    .requiredOption('--start <MM/DD/YYYY>', 'Start date (MM/DD/YYYY)')
    .requiredOption('--end <MM/DD/YYYY>', 'End date (MM/DD/YYYY)')
    .option('-o, --output <path>', 'Output ZIP containing per-record CSV files', 'output-permits.zip')
    .option('--url-csv <name>', 'CSV file name inside ZIP containing a "url" column')
    .action(async (inputZip: string, options: PreparePermitsOptions) => {
      await handlePreparePermits(inputZip, options);
    });
}

export async function handlePreparePermits(inputZip: string, options: PreparePermitsOptions) {
  const spinner = createSpinner('Scraping permits...');
  try {
    if (!dateRe.test(options.start) || !dateRe.test(options.end)) {
      console.error('Usage: --start MM/DD/YYYY --end MM/DD/YYYY');
      process.exit(1);
    }
    const res = await executePreparePermits(inputZip, options);
    const outZip = res.outputZip;
    const resultsLen = res.count;
    spinner.succeed('Saved.');
    console.log(chalk.green(`Saved ${resultsLen} permits`));
    console.log(chalk.blue(`ZIP: ${outZip}`));
  } catch (e) {
    spinner.fail('Failed');
    const msg = e instanceof Error ? e.message : String(e);
    logger.error(msg);
    if (e instanceof Error && e.stack) logger.debug(e.stack);
    // Echo failure to console for immediate visibility
    console.error(chalk.red(`ERROR: ${msg}`));
    process.exit(1);
  }
}

// Programmatic API (no process.exit)
export async function executePreparePermits(
  inputZip: string,
  options: PreparePermitsOptions
): Promise<PreparePermitsResult> {
  if (!dateRe.test(options.start) || !dateRe.test(options.end)) {
    throw new Error('Invalid dates. Use --start MM/DD/YYYY --end MM/DD/YYYY');
  }
  const outZip = normalizeOutputZip(options.output);
  const url = await readUrlFromZip(inputZip, options.urlCsv);
  const results = await scrapePermits(url, options.start, options.end);
  const zip = new AdmZip();
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const idx = String(i + 1).padStart(4, '0');
    const safeBase = (r.name || 'record')
      .replace(/[\n\r\t]/g, ' ')
      .replace(/[^a-zA-Z0-9 _.-]/g, '')
      .trim()
      .slice(0, 80) || 'record';
    const file = `${idx}-${safeBase}.csv`;
    const content = `name,url\n"${r.name.replace(/"/g, '""')}","${r.url}"\n`;
    zip.addFile(file, Buffer.from(content, 'utf-8'));
  }
  zip.writeZip(outZip);
  return { success: true, outputZip: outZip, count: results.length };
}


