import path from 'path';
import { tmpdir } from 'os';
import AdmZip from 'adm-zip';
import { promises as fs } from 'fs';
import { extractZipToTemp } from '../utils/zip.js';
import chalk from 'chalk';
import { PrepareOptions, Request, ProxyUrl, ProxyOptions } from './types.js';
import { withBrowser } from './withBrowser.js';
import { withFetch } from './withFetch.js';
import { withBrowserFlow } from './withBrowserFlow.js';
import { createWorkflowFromTemplate } from './browser-flow/index.js';
import { logger } from '../utils/logger.js';
import { constructUrl, parseUrlToRequest } from './common.js';
import { parse as parseCsvSync } from 'csv-parse/sync';

function parseProxy(proxy: ProxyUrl): ProxyOptions {
  const [, username, password, ip, port] =
    proxy.match(/^(.*?):(.*?)@(.*?):(\d+)$/) || [];
  if (!username || !password || !ip || !port) {
    throw new Error(
      'Invalid proxy format. Expected format: username:password@ip:port'
    );
  }
  logger.info(`Proxy parsed: ${username}:hidden-password@${ip}:${port}`);
  const proxyOptions: ProxyOptions = {
    username,
    password,
    ip,
    port: Number(port),
  };

  logger.info(
    `Proxy parsed: ${JSON.stringify({ ...proxyOptions, password: 'hidden-password' })}`
  );
  return proxyOptions;
}

export async function prepare(
  inputZip: string,
  outputZip: string,
  options: PrepareOptions = {}
) {
  // Defaults: browser=false (via useBrowser flag only), clickContinue defaults to false (handled below)
  const effectiveBrowser = options.useBrowser ?? false;
  const effectiveClickContinue = options.clickContinue ?? false;
  const headless = options.headless ?? true;
  const proxy = options.proxy ? parseProxy(options.proxy) : undefined;

  // Validate that continueButtonSelector requires browser mode
  if (options.continueButtonSelector && !effectiveBrowser) {
    throw new Error('--continue-button requires --use-browser to be enabled');
  }

  const root = await fs.mkdtemp(path.join(tmpdir(), 'elephant-prepare-'));
  try {
    const dir = await extractZipToTemp(inputZip, root);

    async function fileExists(p: string): Promise<boolean> {
      return fs
        .access(p)
        .then(() => true)
        .catch(() => false);
    }

    const seedPath = path.join(dir, 'property_seed.json');
    const hasSeed = await fileExists(seedPath);

    let req: Request | undefined;
    let requestId: string | undefined;

    if (hasSeed) {
      const seed = await fs.readFile(seedPath, 'utf-8');
      const obj = JSON.parse(seed) as Record<string, unknown>;
      req = obj.source_http_request as Request | undefined;
      requestId = obj.request_identifier as string | undefined;
      if (!req) throw new Error('property_seed.json missing source_http_request');
      if (!requestId)
        throw new Error('property_seed.json missing request_identifier');
    }

    if (!hasSeed) {
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
      if (csvs.length !== 1)
        throw new Error(
          `Input ZIP must contain exactly one CSV file; found ${csvs.length}`
        );
      const csvPath = csvs[0];
      const raw = await fs.readFile(csvPath, 'utf-8');
      const isTsv = raw.split('\n', 1)[0]?.includes('\t');
      const rows = parseCsvSync(raw, {
        columns: true,
        skip_empty_lines: true,
        delimiter: isTsv ? '\t' : ',',
      }) as Record<string, unknown>[];
      const first = rows[0] || {};

      const method = String(
        (first['source_http_request_method'] as string) || 'GET'
      ).toUpperCase() as 'GET' | 'POST';
      const url = String(
        (first['source_http_request_url'] as string) ||
          (first['url'] as string) ||
          (first['URL'] as string) || ''
      ).trim();
      if (!url) throw new Error('CSV missing a URL column');

      const mqsRaw = String(
        (first['source_http_request_multi_value_query_string_json'] as string) ||
          ''
      ).trim();
      const headersRaw = String(
        (first['source_http_request_headers_json'] as string) || ''
      ).trim();
      const jsonRaw = String(
        (first['source_http_request_json'] as string) || ''
      ).trim();
      const body = String(
        (first['source_http_request_body'] as string) || ''
      );

      const parsedMqs = mqsRaw ? JSON.parse(mqsRaw) : {};
      const multiValueQueryString: Record<string, string[]> = {};
      for (const [k, v] of Object.entries(parsedMqs)) {
        if (Array.isArray(v)) multiValueQueryString[k] = v.map((x) => String(x));
        else if (v == null) multiValueQueryString[k] = [];
        else multiValueQueryString[k] = [String(v)];
      }
      const headers = headersRaw ? JSON.parse(headersRaw) : undefined;
      const json = jsonRaw ? JSON.parse(jsonRaw) : undefined;

      const request: Request = { url, method, multiValueQueryString };
      if (headers) request.headers = headers;
      if (json) {
        request.json = json;
        if (!request.headers) request.headers = { 'content-type': 'application/json' };
        else request.headers['content-type'] = 'application/json';
      }
      if (!json && body) request.body = body;

      req = request;
      requestId = String(
        (first['id'] as string) || (first['source_identifier'] as string) || 'request'
      );
    }

    if (!req) {
      throw new Error('Unable to construct source_http_request from input');
    }
    if (!requestId || requestId.trim() === '') {
      requestId = 'request';
    }
    const reqObj: Request = req;
    const reqId: string = requestId;

    let prepared;

    // Check if browser flow template is specified
    if (options.browserFlowTemplate && options.browserFlowParameters) {
      const url = constructUrl(reqObj);
      const templateWorkflow = createWorkflowFromTemplate(
        options.browserFlowTemplate,
        options.browserFlowParameters,
        { requestId, url }
      );
      if (!templateWorkflow) {
        throw new Error('Failed to create workflow from template');
      }
      prepared = await withBrowserFlow(
        templateWorkflow,
        headless,
        requestId,
        proxy
      );
    } else if (req.method === 'GET' && effectiveBrowser) {
      prepared = await withBrowser(
        reqObj,
        effectiveClickContinue,
        headless,
        options.errorPatterns,
        options.continueButtonSelector,
        options.ignoreCaptcha,
        proxy
      );
    } else {
      prepared = await withFetch(reqObj);
    }

    const name = `${reqId}.${prepared.type}`;
    await fs.writeFile(path.join(root, name), prepared.content, 'utf-8');

    // If browser flow was used and we have a final URL, update the seed files
    if (prepared.finalUrl && options.browserFlowTemplate && hasSeed) {
      logger.info(
        'Updating seed files with entry_http_request and new source_http_request'
      );

      // Parse the final URL into a request object
      const finalRequest = parseUrlToRequest(prepared.finalUrl);

      // Update property_seed.json
      const seedPathOut = path.join(root, 'property_seed.json');
      const seedContent = await fs.readFile(seedPath, 'utf-8');
      const seedData = JSON.parse(seedContent);

      // Rename source_http_request to entry_http_request and add new source_http_request
      seedData.entry_http_request = seedData.source_http_request;
      seedData.source_http_request = finalRequest;

      await fs.writeFile(seedPathOut, JSON.stringify(seedData, null, 2), 'utf-8');

      // Also update unnormalized_address.json to include the entry_http_request info
      const addrIn = path.join(dir, 'unnormalized_address.json');
      const addrExists = await fileExists(addrIn);
      if (addrExists) {
        const addressContent = await fs.readFile(addrIn, 'utf-8');
        const addressData = JSON.parse(addressContent);
        if (addressData.source_http_request) {
          addressData.entry_http_request = addressData.source_http_request;
          addressData.source_http_request = finalRequest;
        }
        await fs.writeFile(
          path.join(root, 'unnormalized_address.json'),
          JSON.stringify(addressData, null, 2),
          'utf-8'
        );
      }
    }

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
