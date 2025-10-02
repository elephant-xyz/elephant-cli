import path from 'path';
import { tmpdir } from 'os';
import AdmZip from 'adm-zip';
import { promises as fs } from 'fs';
import { extractZipToTemp } from '../utils/zip.js';
import chalk from 'chalk';
import {
  PrepareOptions,
  Request,
  ProxyUrl,
  ProxyOptions,
  Prepared,
} from './types.js';
import { withBrowser } from './withBrowser.js';
import { withFetch } from './withFetch.js';
import { withBrowserFlow } from './withBrowserFlow.js';
import { createWorkflowFromTemplate } from './browser-flow/index.js';
import { logger } from '../utils/logger.js';
import { constructUrl, parseUrlToRequest } from './common.js';

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

async function fetchOrangeCountyData(requestId: string): Promise<Prepared> {
  logger.info('Orange County detected - using hardcoded API flow');

  const cleanRequestId = requestId.replace(/-/g, '');

  // First, fetch the quick search to get the parcelId
  const quickSearchUrl = `https://ocpa-mainsite-afd-standard.azurefd.net/api/QuickSearch/GetSearchInfoByParcel?pid=${cleanRequestId}`;
  const quickSearchResponse = await fetch(quickSearchUrl);
  if (!quickSearchResponse.ok) {
    throw new Error(
      `API request to ${quickSearchUrl} failed with status ${quickSearchResponse.status}`
    );
  }
  const quickSearchData = await quickSearchResponse.json();
  const parcelId = quickSearchData[0]?.parcelId;
  if (!parcelId) {
    throw new Error('Failed to retrieve parcelId from quick search response');
  }

  // Use the parcelId for subsequent requests
  const endpoints = [
    {
      url: `https://ocpa-mainsite-afd-standard.azurefd.net/api/PRC/GetPRCStats?PID=${parcelId}`,
      key: 'parcelValuationStats',
    },
    {
      url: `https://ocpa-mainsite-afd-standard.azurefd.net/api/PRC/GetPRCGeneralInfo?pid=${parcelId}`,
      key: 'parcelGeneralProfile',
    },
    {
      url: `https://ocpa-mainsite-afd-standard.azurefd.net/api/PRC/GetPRCPropertyValues?PID=${parcelId}&TaxYear=0&ShowAllFlag=1`,
      key: 'parcelPropertyValuesByYear',
    },
    {
      url: `https://ocpa-mainsite-afd-standard.azurefd.net/api/PRC/GetPRCCertifiedTaxes?PID=${parcelId}&TaxYear=0`,
      key: 'parcelCertifiedTaxesByAuthority',
    },
    {
      url: `https://ocpa-mainsite-afd-standard.azurefd.net/api/PRC/GetPRCNonAdValorem?PID=${parcelId}&TaxYear=0`,
      key: 'parcelNonAdValoremAssessments',
    },
    {
      url: `https://ocpa-mainsite-afd-standard.azurefd.net/api/PRC/GetPRCTotalTaxes?PID=${parcelId}&TaxYear=0`,
      key: 'parcelTotalTaxesSummary',
    },
  ];

  const responses = await Promise.all(
    endpoints.map(async ({ url, key }) => {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(
          `API request to ${url} failed with status ${response.status}`
        );
      }
      const data = await response.json();
      return { key, data };
    })
  );

  const combinedData = {
    parcelQuickSearchSummary: quickSearchData,
    ...responses.reduce(
      (acc, { key, data }) => {
        acc[key] = data;
        return acc;
      },
      {} as Record<string, unknown>
    ),
  };

  return {
    type: 'json',
    content: JSON.stringify(combinedData, null, 2),
  };
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

    // Check for Orange County hardcoded flow
    const addressPath = path.join(dir, 'unnormalized_address.json');
    const addressContent = await fs.readFile(addressPath, 'utf-8');
    const addressData = JSON.parse(addressContent);
    const isOrangeCounty = addressData.county_jurisdiction === 'Orange';

    let prepared;

    if (isOrangeCounty) {
      prepared = await fetchOrangeCountyData(requestId);
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
      // If address file has source_http_request, rename it to entry_http_request
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
