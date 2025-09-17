import path from 'path';
import { tmpdir } from 'os';
import AdmZip from 'adm-zip';
import { promises as fs } from 'fs';
import { extractZipToTemp } from '../utils/zip.js';
import chalk from 'chalk';
import { PrepareOptions, Request } from './types.js';
import { withBrowser } from './withBrowser.js';
import { withFetch } from './withFetch.js';
import { withBrowserFlow } from './withBrowserFlow.js';
import { workflow } from './workflow.js';

export async function prepare(
  inputZip: string,
  outputZip: string,
  options: PrepareOptions = {}
) {
  // Caller (CLI/service) passes options.
  // Defaults: browser=false (via useBrowser flag only), fast=true, clickContinue defaults to true (handled below)
  const effectiveBrowser = options.useBrowser;
  const effectiveClickContinue = options.clickContinue;
  const effectiveFast = options.fast;
  const headless = options.headless ?? true;
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
    const requestId = obj.request_identifier as string | undefined;
    if (!req) throw new Error('property_seed.json missing source_http_request');
    if (!requestId)
      throw new Error('property_seed.json missing request_identifier');

    const prepared = process.env.WEIRED_COUNTY
      ? await withBrowserFlow(workflow, headless, requestId)
      : req.method === 'GET' && effectiveBrowser
        ? await withBrowser(
            req,
            effectiveClickContinue,
            effectiveFast,
            requestId,
            headless
          )
        : await withFetch(req);

    const name = `${requestId}.${prepared.type}`;
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
