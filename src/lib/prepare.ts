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
import { createWorkflowFromTemplate } from './browser-flow/index.js';
import { logger } from '../utils/logger.js';
import { constructUrl, parseUrlToRequest } from './common.js';

export async function prepare(
  inputZip: string,
  outputZip: string,
  options: PrepareOptions = {}
) {
  // Caller (CLI/service) passes options.
  // Defaults: browser=false (via useBrowser flag only), fast=true, clickContinue defaults to true (handled below)
  const effectiveBrowser = options.useBrowser ?? false;
  const effectiveClickContinue = options.clickContinue ?? false;
  const effectiveFast = options.fast ?? true;
  const headless = options.headless ?? true;

  // Validate that continueButtonSelector requires browser mode
  if (options.continueButtonSelector && !effectiveBrowser) {
    throw new Error('--continue-button requires --use-browser to be enabled');
  }

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

    let prepared;

    // Check if browser flow template is specified
    if (options.browserFlowTemplate && options.browserFlowParameters) {
      const url = constructUrl(req);
      const templateWorkflow = createWorkflowFromTemplate(
        options.browserFlowTemplate,
        options.browserFlowParameters,
        { requestId, url }
      );
      if (!templateWorkflow) {
        throw new Error('Failed to create workflow from template');
      }
      console.log(`/n ${JSON.stringify(templateWorkflow, null, 2)}`);
      prepared = await withBrowserFlow(templateWorkflow, headless, requestId);
    } else if (req.method === 'GET' && effectiveBrowser) {
      prepared = await withBrowser(
        req,
        effectiveClickContinue,
        effectiveFast,
        requestId,
        headless,
        options.errorPatterns,
        options.continueButtonSelector,
        options.ignoreCaptcha
      );
    } else {
      prepared = await withFetch(req);
    }

    const name = `${requestId}.${prepared.type}`;
    await fs.writeFile(path.join(root, name), prepared.content, 'utf-8');

    // If browser flow was used and we have a final URL, update the seed files
    if (prepared.finalUrl && options.browserFlowTemplate) {
      logger.info(
        'Updating seed files with entry_http_request and new source_http_request'
      );

      // Parse the final URL into a request object
      const finalRequest = parseUrlToRequest(prepared.finalUrl);

      // Update property_seed.json
      const seedPath = path.join(root, 'property_seed.json');
      const seedContent = await fs.readFile(seedPath, 'utf-8');
      const seedData = JSON.parse(seedContent);

      // Rename source_http_request to entry_http_request and add new source_http_request
      seedData.entry_http_request = seedData.source_http_request;
      seedData.source_http_request = finalRequest;

      await fs.writeFile(seedPath, JSON.stringify(seedData, null, 2), 'utf-8');

      // Also update unnormalized_address.json to include the entry_http_request info
      const addressPath = path.join(root, 'unnormalized_address.json');
      const addressContent = await fs.readFile(addressPath, 'utf-8');
      const addressData = JSON.parse(addressContent);

      // If address file has source_http_request, rename it to entry_http_request
      if (addressData.source_http_request) {
        addressData.entry_http_request = addressData.source_http_request;
        addressData.source_http_request = finalRequest;
      }

      await fs.writeFile(
        addressPath,
        JSON.stringify(addressData, null, 2),
        'utf-8'
      );
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
