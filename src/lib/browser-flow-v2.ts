import AdmZip from 'adm-zip';
import path from 'path';
import { pathToFileURL } from 'url';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { Page } from 'puppeteer';
import { cleanHtml, createBrowserPage } from './common.js';
import { ProxyOptions, Request } from './types.js';
import { logger } from '../utils/logger.js';

export interface BrowserFlowV2Input {
  request_identifier: string;
  url: string;
  source_http_request: Request;
  parcel: Record<string, unknown>;
  address: Record<string, unknown>;
}

export interface BrowserFlowV2Capture {
  name: string;
  path: string;
  type: 'html';
}

export interface BrowserFlowV2Manifest {
  version: 2;
  request_identifier: string;
  sourceUrl: string;
  captures: BrowserFlowV2Capture[];
}

export interface SaveHtmlOptions {
  name: string;
  html?: string;
}

export interface BrowserFlowV2Context {
  page: Page;
  input: BrowserFlowV2Input;
  saveHtml(options: SaveHtmlOptions): Promise<void>;
  saveSourceUrl(url: string): Promise<void>;
  logger: typeof logger;
}

interface BrowserFlowV2Module {
  handler: (context: BrowserFlowV2Context) => Promise<void>;
}

interface BrowserFlowV2Options {
  flowZip: string;
  inputDir: string;
  outputZip: string;
  input: BrowserFlowV2Input;
  headless: boolean;
  proxy?: ProxyOptions;
  timeoutMs?: number;
}

const CAPTURE_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

async function addToZip(zip: AdmZip, root: string, current: string) {
  const entries = await fs.readdir(current, { withFileTypes: true });

  for (const entry of entries) {
    const full = path.join(current, entry.name);
    const rel = path.relative(root, full);
    if (entry.isDirectory()) {
      await addToZip(zip, root, full);
      continue;
    }
    zip.addLocalFile(
      full,
      path.dirname(rel) === '.' ? undefined : path.dirname(rel)
    );
  }
}

async function loadHandler(flowZip: string, root: string) {
  const dir = path.join(root, 'flow');
  await fs.mkdir(dir, { recursive: true });
  new AdmZip(flowZip).extractAllTo(dir, true);

  const handlerPath = path.join(dir, 'handler.js');
  await fs.access(handlerPath);

  const mod = (await import(
    `${pathToFileURL(handlerPath).href}?t=${Date.now()}`
  )) as Partial<BrowserFlowV2Module>;

  if (typeof mod.handler !== 'function') {
    throw new Error('Browser flow v2 package must export a handler function');
  }

  return mod.handler;
}

function validateCaptureName(name: string) {
  if (!CAPTURE_NAME_PATTERN.test(name)) {
    throw new Error(
      `Invalid capture name "${name}". Capture names must be kebab-case.`
    );
  }
}

async function withTimeout(action: Promise<void>, timeoutMs: number) {
  let timeout: NodeJS.Timeout | undefined;
  const timer = new Promise<never>((_, reject) => {
    timeout = setTimeout(
      () => reject(new Error(`Browser flow v2 timed out after ${timeoutMs}ms`)),
      timeoutMs
    );
  });

  try {
    await Promise.race([action, timer]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function executeBrowserFlowV2(options: BrowserFlowV2Options) {
  const root = await fs.mkdtemp(
    path.join(tmpdir(), 'elephant-browser-flow-v2-')
  );
  try {
    await using page = await createBrowserPage(options.headless, options.proxy);
    const handler = await loadHandler(options.flowZip, root);
    const captures = new Map<string, BrowserFlowV2Capture>();
    let sourceUrl: string | undefined;

    const capturesDir = path.join(options.inputDir, 'captures');
    await fs.mkdir(capturesDir, { recursive: true });

    const saveHtml = async ({ name, html }: SaveHtmlOptions) => {
      validateCaptureName(name);
      if (captures.has(name)) {
        throw new Error(`Duplicate capture name: ${name}`);
      }

      const content = await cleanHtml(html ?? (await page.content()));
      const capturePath = `captures/${name}.html`;
      await fs.writeFile(
        path.join(options.inputDir, capturePath),
        content,
        'utf-8'
      );
      captures.set(name, {
        name,
        path: capturePath,
        type: 'html',
      });
    };

    const saveSourceUrl = async (url: string) => {
      if (sourceUrl) {
        throw new Error('saveSourceUrl may only be called once');
      }
      sourceUrl = url;
    };

    await withTimeout(
      handler({
        page,
        input: options.input,
        saveHtml,
        saveSourceUrl,
        logger,
      }),
      options.timeoutMs ?? 300000
    );

    if (!sourceUrl) {
      throw new Error('Browser flow v2 handler must call saveSourceUrl');
    }
    if (captures.size === 0) {
      throw new Error('Browser flow v2 handler must save at least one capture');
    }

    const manifest: BrowserFlowV2Manifest = {
      version: 2,
      request_identifier: options.input.request_identifier,
      sourceUrl,
      captures: [...captures.values()].sort((a, b) =>
        a.name.localeCompare(b.name)
      ),
    };
    await fs.writeFile(
      path.join(options.inputDir, 'captures.json'),
      JSON.stringify(manifest, null, 2),
      'utf-8'
    );

    const zip = new AdmZip();
    await addToZip(zip, options.inputDir, options.inputDir);
    zip.writeZip(options.outputZip);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}
