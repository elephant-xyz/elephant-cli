import { Command } from 'commander';
import chalk from 'chalk';
import path from 'path';
import { tmpdir } from 'os';
import { promises as fs } from 'fs';
import AdmZip from 'adm-zip';
import { extractZipToTemp } from '../utils/zip.js';
import { createSpinner } from '../utils/progress.js';
import { logger } from '../utils/logger.js';
import { parse as parseCsvSync } from 'csv-parse/sync';

function normalizeOutputZip(outArg: string | undefined) {
	const base = (outArg || 'permit-pages.zip').trim();
	const abs = path.resolve(process.cwd(), base);
	return abs.endsWith('.zip') ? abs : abs + '.zip';
}

async function readCsvFromZip(zipPath: string, csvName?: string): Promise<Array<{ name: string; url: string }>> {
	const root = await fs.mkdtemp(path.join(tmpdir(), 'elephant-permit-pages-'));
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
		const out: Array<{ name: string; url: string }> = [];
		for (const r of rows) {
			const name = (r.name || r.Name || '').trim();
			const url = (r.url || r.URL || r.link || r.Link || '').trim();
			if (name && url) out.push({ name, url });
		}
		if (out.length === 0) throw new Error('CSV has no valid rows (requires columns: name,url)');
		return out;
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
			defaultViewport: { width: 1440, height: 900 },
		});
	}
	if (process.platform === 'darwin') {
		const puppeteer = await import('puppeteer');
		return puppeteer.launch({ headless: true, timeout: 30000, defaultViewport: { width: 1440, height: 900 } });
	}
	const msg = 'Unsupported platform. Only Linux and macOS are supported.';
	console.log(chalk.red(msg));
	throw new Error(msg);
}

function delay(ms: number) {
	return new Promise((r) => setTimeout(r, ms));
}

async function waitForGlobalIdle(page: import('puppeteer').Page, timeout = 60000) {
	await page.waitForFunction(
		() => {
			const mask = document.getElementById('divGlobalLoadingMask');
			const win = document.getElementById('divGlobalLoading');
			const maskHidden = !mask || (mask as HTMLElement).style.display === 'none';
			const winHidden = !win || (win as HTMLElement).style.display === 'none';
			return maskHidden && winHidden;
		},
		{ timeout }
	);
	await delay(600);
}

async function expandAllSectionsOnTab(page: import('puppeteer').Page) {
	const headers = await page.$$('[enableexpand="Y"], .ACA_SectionHeaderTemp h1, .ACA_Title_Bar h1');
	for (const h of headers) {
		const needs = await h.evaluate((el) => {
			const section = el.closest('.ACA_SectionHeaderTemp');
			if (!section) return false;
			const next = section.nextElementSibling as HTMLElement | null;
			const byClass = !!next && next.classList.contains('ACA_Hide');
			const byStyle = !!next && getComputedStyle(next).display === 'none';
			return byClass || byStyle;
		});
		if (needs) {
			try {
				await h.click();
			} catch {}
			await waitForGlobalIdle(page);
		}
	}
	const hidden = await page.$$('[style*="display:none"]');
	for (const row of hidden) {
		try {
			const toggle = await row.evaluateHandle((r) => {
				let prev = r.previousElementSibling as HTMLElement | null;
				while (prev && prev.tagName !== 'TR' && prev.tagName !== 'DIV') prev = prev.previousElementSibling as HTMLElement | null;
				if (prev) {
					const a = prev.querySelector('a, button, [role="button"], .ACA_SmButton, .ACA_ALeft, .ACA_Title_Bar') as HTMLElement | null;
					return a || prev;
				}
				return null;
			});
			if (toggle) {
				try {
					await (toggle as unknown as import('puppeteer').ElementHandle<Element>).click();
				} catch {}
				await waitForGlobalIdle(page);
			}
		} catch {}
	}
}

async function expandInPageToggles(page: import('puppeteer').Page) {
	// Click likely in-page expanders (e.g., "More Details", "Show", "View") available without tab navigation
	const selectors = [
		'a',
		'button',
		'[role="button"]',
		'.ACA_SmButton',
		'.ACA_ALeft',
		'.ACA_Title_Bar',
	];
	const handles = await page.$$(selectors.join(','));
	for (const h of handles) {
		try {
			const text = (await h.evaluate((el) => (el.textContent || '').trim())).toLowerCase();
			const match = text.includes('more') || text.includes('detail') || text.includes('show') || text.includes('view');
			if (!match) continue;
			await h.click();
			await waitForGlobalIdle(page);
		} catch {}
	}
}

async function triggerHiddenPostbacks(page: import('puppeteer').Page) {
    const inputs = await page.$$('input[id$="_btnSearch"]');
    for (const input of inputs) {
        const shouldClick = await input.evaluate((el) => {
            const header = el.closest('.ACA_SectionHeaderTemp') as HTMLElement | null;
            const next = header?.nextElementSibling as HTMLElement | null;
            return !!next && (next.classList.contains('ACA_Hide') || getComputedStyle(next).display === 'none');
        });
        if (shouldClick) {
            try {
                await input.click();
                await waitForGlobalIdle(page);
            } catch {}
        }
    }
}

async function expandMoreDetailsAndTrees(page: import('puppeteer').Page) {
    // Click explicit "More Details" link if present
    const lnk = await page.$('#lnkMoreDetail, a#lnkMoreDetail');
    if (lnk) {
        try { await lnk.click(); } catch {}
        await waitForGlobalIdle(page);
    }
    // Click any toggle images that indicate collapsed state (plus/caret)
    const imgs = await page.$$('img[src*="plus_expand"], img[src*="caret_collapsed"]');
    for (const img of imgs) {
        try {
            const anchor = await img.evaluateHandle((el) => {
                const a = el.closest('a') as HTMLElement | null;
                return a || el;
            });
            await (anchor as unknown as import('puppeteer').ElementHandle<Element>).click();
            await waitForGlobalIdle(page);
        } catch {}
    }

    // Force-open known More Details containers and common sub-panels by ID
    await page.evaluate(() => {
        const ids = [
            { id: 'TRMoreDetail', display: 'table-row' },
            { id: 'trASIList', display: 'table-row' },
            { id: 'trASITList', display: 'table-row' },
            { id: 'trParcelList', display: 'table-row' },
        ];
        for (const { id, display } of ids) {
            const el = document.getElementById(id) as HTMLElement | null;
            if (el) el.style.display = display as 'table-row';
        }
        const imgIds = ['imgMoreDetail', 'imgASI', 'imgASIT', 'imgParcel'];
        for (const imgId of imgIds) {
            const img = document.getElementById(imgId) as HTMLImageElement | null;
            if (!img) continue;
            if (imgId === 'imgMoreDetail') img.src = img.src.replace('caret_collapsed', 'caret_expanded');
            if (imgId === 'imgASI' || imgId === 'imgASIT' || imgId === 'imgParcel') img.src = img.src.replace('plus_expand', 'minus_collapse');
        }
    });
    await waitForGlobalIdle(page);
}

async function expandUntilStable(page: import('puppeteer').Page, maxIters = 4) {
    let prevHidden = -1;
    let prevLen = -1;
    for (let i = 0; i < maxIters; i++) {
        // Scroll through page to trigger any lazy renders
        await page.evaluate(async () => {
            const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
            const total = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
            let y = 0;
            while (y < total) {
                window.scrollTo(0, y);
                await sleep(100);
                y += 800;
            }
            window.scrollTo(0, 0);
        });
        const [hiddenCount, len] = await page.evaluate(() => {
            const panels = Array.from(document.querySelectorAll('.ACA_Hide')) as HTMLElement[];
            return [panels.length, document.body.innerText.length] as const;
        });
        if (hiddenCount === prevHidden && len === prevLen) return;
        prevHidden = hiddenCount;
        prevLen = len;
        await expandAllSectionsOnTab(page);
        await expandInPageToggles(page);
        await triggerHiddenPostbacks(page);
    }
}

// Removed tab traversal helpers; we only expand the main page content now

export interface PreparePermitPagesOptions {
	output?: string;
	urlCsv?: string;
	limit?: number;
}

export type PreparePermitPagesResult = {
  success: boolean;
  outputZip: string;
  processed: number;
};

export function registerPreparePermitPagesCommand(program: Command) {
	program
		.command('prepare-permit-pages <inputZip>')
		.description('Download expanded HTML for each record URL in the CSV (zip-in, zip-out)')
		.option('-o, --output <path>', 'Output ZIP path', 'permit-pages.zip')
		.option('--url-csv <name>', 'CSV file name inside input ZIP')
		.option('--limit <n>', 'Limit number of records to process', (v) => parseInt(v, 10), undefined as unknown as number)
		.action(async (inputZip: string, options: PreparePermitPagesOptions) => {
			await handlePreparePermitPages(inputZip, options);
		});
}

export async function handlePreparePermitPages(inputZip: string, options: PreparePermitPagesOptions) {
	const spinner = createSpinner('Preparing permit pages...');
	const outZip = normalizeOutputZip(options.output);
	const rows = await readCsvFromZip(inputZip, options.urlCsv);
	const take = typeof options.limit === 'number' && Number.isFinite(options.limit) && options.limit! > 0 ? Math.min(options.limit!, rows.length) : rows.length;
	spinner.start(`Launching browser for ${take} record(s)...`);
	const browser = await launchBrowser();
	const root = await fs.mkdtemp(path.join(tmpdir(), 'elephant-permit-pages-out-'));
	try {
		for (let i = 0; i < take; i++) {
			const row = rows[i];
			spinner.text = `Processing ${i + 1}/${take}: ${row.name}`;
			const page = await browser.newPage();
			page.on('dialog', async (d) => {
				try {
					await d.dismiss();
				} catch {}
			});
			await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36');
			await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9', Accept: 'text/html,application/xhtml+xml' });
			await page.goto(row.url, { waitUntil: 'domcontentloaded', timeout: 120000 });
			await waitForGlobalIdle(page);
			const dirBase = row.name.replace(/[^\w\-]+/g, '_') || `record_${String(i + 1).padStart(4, '0')}`;
			const recDir = path.join(root, dirBase);
			await fs.mkdir(recDir, { recursive: true });
			await expandAllSectionsOnTab(page);
			await expandInPageToggles(page);
			await expandMoreDetailsAndTrees(page);
			await triggerHiddenPostbacks(page);
			await expandUntilStable(page);
			await fs.writeFile(path.join(recDir, `${dirBase}__Expanded.html`), await page.content(), 'utf-8');
			await page.close();
		}
		const zip = new AdmZip();
		const names = await fs.readdir(root);
		for (const n of names) zip.addLocalFolder(path.join(root, n), n);
		zip.writeZip(outZip);
		spinner.succeed('Saved.');
		console.log(chalk.green(`Saved ${take} record(s)`));
		console.log(chalk.blue(`ZIP: ${outZip}`));
	} catch (e) {
		spinner.fail('Failed');
		const msg = e instanceof Error ? e.message : String(e);
		logger.error(msg);
		if (e instanceof Error && e.stack) logger.debug(e.stack);
		console.error(chalk.red(`ERROR: ${msg}`));
		process.exit(1);
	} finally {
		await browser.close();
		await fs.rm(root, { recursive: true, force: true }).catch(() => {});
	}
}

// Programmatic API (no process.exit)
export async function executePreparePermitPages(
  inputZip: string,
  options: PreparePermitPagesOptions
): Promise<PreparePermitPagesResult> {
  const outZip = normalizeOutputZip(options.output);
  const rows = await readCsvFromZip(inputZip, options.urlCsv);
  const take = typeof options.limit === 'number' && Number.isFinite(options.limit) && options.limit! > 0 ? Math.min(options.limit!, rows.length) : rows.length;
  const browser = await launchBrowser();
  const root = await fs.mkdtemp(path.join(tmpdir(), 'elephant-permit-pages-out-'));
  try {
    for (let i = 0; i < take; i++) {
      const row = rows[i];
      const page = await browser.newPage();
      page.on('dialog', async (d) => { try { await d.dismiss(); } catch {} });
      await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36');
      await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9', Accept: 'text/html,application/xhtml+xml' });
      await page.goto(row.url, { waitUntil: 'domcontentloaded', timeout: 120000 });
      await waitForGlobalIdle(page);
      const dirBase = row.name.replace(/[^\w\-]+/g, '_') || `record_${String(i + 1).padStart(4, '0')}`;
      const recDir = path.join(root, dirBase);
      await fs.mkdir(recDir, { recursive: true });
      await expandAllSectionsOnTab(page);
      await expandInPageToggles(page);
      await expandMoreDetailsAndTrees(page);
      await triggerHiddenPostbacks(page);
      await expandUntilStable(page);
      await fs.writeFile(path.join(recDir, `${dirBase}__Expanded.html`), await page.content(), 'utf-8');
      await page.close();
    }
    const zip = new AdmZip();
    const names = await fs.readdir(root);
    for (const n of names) zip.addLocalFolder(path.join(root, n), n);
    zip.writeZip(outZip);
    return { success: true, outputZip: outZip, processed: take };
  } finally {
    await browser.close();
    await fs.rm(root, { recursive: true, force: true }).catch(() => {});
  }
}
