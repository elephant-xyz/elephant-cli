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
import { loadCustomFlow } from './browser-flow/customFlow.js';
import { logger } from '../utils/logger.js';
import { constructUrl, parseUrlToRequest } from './common.js';
import { fetchOrangeCountyData } from './county-specific-prepare/orange.js';

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

    // Try parcel.json first, fallback to property_seed.json for backward compatibility
    let parcelFile: string;
    let parcelFileName: string;
    try {
      parcelFile = await fs.readFile(path.join(dir, 'parcel.json'), 'utf-8');
      parcelFileName = 'parcel.json';
    } catch {
      parcelFile = await fs.readFile(
        path.join(dir, 'property_seed.json'),
        'utf-8'
      );
      parcelFileName = 'property_seed.json';
    }

    try {
      await fs.access(path.join(dir, 'address.json'));
    } catch {
      console.error(chalk.red('address.json is missing in the input zip'));
      throw new Error('address.json is missing in the input zip');
    }

    const obj = JSON.parse(parcelFile) as Record<string, unknown>;
    const req = obj.source_http_request as Request | undefined;
    const requestId = obj.request_identifier as string | undefined;
    if (!req) throw new Error(`${parcelFileName} missing source_http_request`);
    if (!requestId)
      throw new Error(`${parcelFileName} missing request_identifier`);

    // Check for Orange County hardcoded flow
    // Try new address.json first, fallback to old unnormalized_address.json
    let addressPath = path.join(dir, 'address.json');
    let addressContent: string;
    let addressData: Record<string, unknown>;
    try {
      addressContent = await fs.readFile(addressPath, 'utf-8');
      addressData = JSON.parse(addressContent);
    } catch {
      // Fallback to old format
      addressPath = path.join(dir, 'unnormalized_address.json');
      addressContent = await fs.readFile(addressPath, 'utf-8');
      addressData = JSON.parse(addressContent);
    }
    const isOrangeCounty =
      addressData.county_name === 'Orange' ||
      addressData.county_jurisdiction === 'Orange';

    let prepared;

    if (isOrangeCounty) {
      prepared = await fetchOrangeCountyData(requestId);
    } else if (options.browserFlowFile) {
      const url = constructUrl(req);
      const customWorkflow = await loadCustomFlow(options.browserFlowFile);
      prepared = await withBrowserFlow(
        customWorkflow,
        headless,
        requestId,
        proxy,
        url
      );
    } else if (options.browserFlowTemplate && options.browserFlowParameters) {
      const url = constructUrl(req);
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
        req,
        effectiveClickContinue,
        headless,
        options.errorPatterns,
        options.continueButtonSelector,
        options.ignoreCaptcha,
        proxy
      );
    } else {
      prepared = await withFetch(req);
    }

    const name = `${requestId}.${prepared.type}`;
    await fs.writeFile(path.join(root, name), prepared.content, 'utf-8');

    // If browser flow was used and we have a final URL, update the seed files
    if (
      prepared.finalUrl &&
      (options.browserFlowTemplate || options.browserFlowFile)
    ) {
      logger.info(
        'Updating seed files with entry_http_request and new source_http_request'
      );

      // Parse the final URL into a request object
      const finalRequest = parseUrlToRequest(prepared.finalUrl);

      // Update parcel files (parcel.json and/or property_seed.json)
      const parcelData = JSON.parse(parcelFile);

      // Rename source_http_request to entry_http_request and add new source_http_request
      parcelData.entry_http_request = parcelData.source_http_request;
      parcelData.source_http_request = finalRequest;

      // Update parcel.json if it exists
      try {
        await fs.writeFile(
          path.join(root, 'parcel.json'),
          JSON.stringify(parcelData, null, 2),
          'utf-8'
        );
      } catch {
        // File may not exist, that's ok
      }

      // Update property_seed.json if it exists
      try {
        await fs.writeFile(
          path.join(root, 'property_seed.json'),
          JSON.stringify(parcelData, null, 2),
          'utf-8'
        );
      } catch {
        // File may not exist, that's ok
      }

      // Also update address files to include the entry_http_request info
      // If address file has source_http_request, rename it to entry_http_request
      if (addressData.source_http_request) {
        addressData.entry_http_request = addressData.source_http_request;
        addressData.source_http_request = finalRequest;
      }

      // Update address.json (new format)
      try {
        await fs.writeFile(
          path.join(root, 'address.json'),
          JSON.stringify(addressData, null, 2),
          'utf-8'
        );
      } catch {
        // File may not exist, that's ok
      }

      // Update unnormalized_address.json (old format) if it exists
      try {
        await fs.writeFile(
          path.join(root, 'unnormalized_address.json'),
          JSON.stringify(addressData, null, 2),
          'utf-8'
        );
      } catch {
        // File may not exist, that's ok
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
