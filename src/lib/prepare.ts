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
import {
  loadMultiRequestFlow,
  executeMultiRequestFlow,
} from './multi-request-flow/index.js';

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

/**
 * Extract and replace URL from browser workflow with request_identifier
 */
function extractUrlFromWorkflow(
  workflow: { starts_at: string; states: Record<string, unknown> },
  requestId: string
): string | undefined {
  const startState = workflow.states[workflow.starts_at] as {
    type: string;
    input?: { url?: string };
  };
  if (startState?.type === 'open_page' && startState.input?.url) {
    return startState.input.url.replace(
      /[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i,
      requestId
    );
  }
  return undefined;
}

/**
 * Prepare data from an input CSV file containing request identifiers.
 * Processes each row and executes either multi-request or browser flow.
 */
async function prepareFromInputCsv(
  outputZip: string,
  options: PrepareOptions
): Promise<void> {
  if (!options.multiRequestFlowFile && !options.browserFlowFile) {
    throw new Error(
      '--multi-request-flow-file or --browser-flow-file is required when using --input-csv'
    );
  }

  const { parse } = await import('csv-parse/sync');

  const csvContent = await fs.readFile(options.inputCsv!, 'utf-8');
  const rows = parse(csvContent, {
    columns: true,
    skip_empty_lines: true,
  }) as Array<Record<string, string>>;

  if (rows.length === 0) {
    throw new Error('CSV file is empty or has no valid rows');
  }

  if (!rows[0].request_identifier) {
    throw new Error('CSV file must have a request_identifier column');
  }

  logger.info(`Processing ${rows.length} request(s) from CSV`);

  const root = await fs.mkdtemp(path.join(tmpdir(), 'elephant-prepare-csv-'));
  try {
    const flow = options.multiRequestFlowFile
      ? await loadMultiRequestFlow(options.multiRequestFlowFile)
      : undefined;
    const browserWorkflow = options.browserFlowFile
      ? await loadCustomFlow(options.browserFlowFile)
      : undefined;
    const headless = options.headless ?? true;
    const proxy = options.proxy ? parseProxy(options.proxy) : undefined;

    for (const [index, row] of rows.entries()) {
      const requestId = row.request_identifier;
      if (!requestId || !requestId.trim()) {
        logger.warn(`Skipping row ${index + 1}: empty request_identifier`);
        continue;
      }

      logger.info(`[${index + 1}/${rows.length}] Processing: ${requestId}`);

      const prepared = flow
        ? await executeMultiRequestFlow(flow, requestId)
        : await withBrowserFlow(
            browserWorkflow!,
            headless,
            requestId,
            proxy,
            extractUrlFromWorkflow(browserWorkflow!, requestId)
          );

      const name = `${requestId}.${prepared.type}`;
      await fs.writeFile(path.join(root, name), prepared.content, 'utf-8');
    }

    const zip = new AdmZip();
    for (const rel of await fs.readdir(root)) {
      zip.addLocalFile(path.join(root, rel));
    }
    zip.writeZip(outputZip);

    logger.info(`Created output ZIP with ${rows.length} result(s)`);
  } finally {
    try {
      await fs.rm(root, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
}

export async function prepare(
  inputZip: string,
  outputZip: string,
  options: PrepareOptions = {}
) {
  // Handle input CSV mode - batch processing
  if (options.inputCsv) {
    return await prepareFromInputCsv(outputZip, options);
  }

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

    // Check for parcel files - support both new and old formats
    // Read from parcel.json first, fallback to property_seed.json
    let parcelFile: string;
    let parcelFileName: string;
    let hasParcelJson = false;
    let hasPropertySeedJson = false;

    try {
      await fs.access(path.join(dir, 'parcel.json'));
      hasParcelJson = true;
    } catch {
      logger.debug('parcel.json not found, will check for property_seed.json');
    }

    try {
      await fs.access(path.join(dir, 'property_seed.json'));
      hasPropertySeedJson = true;
    } catch {
      logger.debug('property_seed.json not found');
    }

    if (!hasParcelJson && !hasPropertySeedJson) {
      console.error(
        chalk.red(
          'Neither parcel.json nor property_seed.json found in input zip'
        )
      );
      throw new Error(
        'Neither parcel.json nor property_seed.json found in input zip'
      );
    }

    // Read the parcel file (prefer new format)
    if (hasParcelJson) {
      parcelFile = await fs.readFile(path.join(dir, 'parcel.json'), 'utf-8');
      parcelFileName = 'parcel.json';
    } else {
      parcelFile = await fs.readFile(
        path.join(dir, 'property_seed.json'),
        'utf-8'
      );
      parcelFileName = 'property_seed.json';
    }

    // Check for address files - support both new and old formats
    let hasAddressJson = false;
    let hasUnnormalizedAddressJson = false;

    try {
      await fs.access(path.join(dir, 'address.json'));
      hasAddressJson = true;
    } catch {
      logger.debug(
        'address.json not found, will check for unnormalized_address.json'
      );
    }

    try {
      await fs.access(path.join(dir, 'unnormalized_address.json'));
      hasUnnormalizedAddressJson = true;
    } catch {
      logger.debug('unnormalized_address.json not found');
    }

    if (!hasAddressJson && !hasUnnormalizedAddressJson) {
      console.error(
        chalk.red(
          'Neither address.json nor unnormalized_address.json found in input zip'
        )
      );
      throw new Error(
        'Neither address.json nor unnormalized_address.json found in input zip'
      );
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
      logger.debug(
        `Failed to read ${addressPath}, falling back to unnormalized_address.json`
      );
      // Fallback to old format
      addressPath = path.join(dir, 'unnormalized_address.json');
      addressContent = await fs.readFile(addressPath, 'utf-8');
      addressData = JSON.parse(addressContent);
    }
    const isOrangeCounty =
      addressData.county_name === 'Orange' ||
      addressData.county_jurisdiction === 'Orange';

    let prepared;

    if (options.multiRequestFlowFile) {
      const flow = await loadMultiRequestFlow(options.multiRequestFlowFile);
      prepared = await executeMultiRequestFlow(flow, requestId);
    } else if (isOrangeCounty) {
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
      'finalUrl' in prepared &&
      prepared.finalUrl &&
      (options.browserFlowTemplate || options.browserFlowFile)
    ) {
      logger.info(
        'Updating seed files with entry_http_request and new source_http_request'
      );

      // Parse the final URL into a request object
      const finalRequest = parseUrlToRequest(prepared.finalUrl);

      // Update parcel files independently - maintain both if both exist
      // Update parcel.json if it exists
      if (hasParcelJson) {
        const parcelJsonPath = path.join(dir, 'parcel.json');
        const parcelJsonContent = await fs.readFile(parcelJsonPath, 'utf-8');
        const parcelJsonData = JSON.parse(parcelJsonContent);

        parcelJsonData.entry_http_request = parcelJsonData.source_http_request;
        parcelJsonData.source_http_request = finalRequest;

        await fs.writeFile(
          path.join(root, 'parcel.json'),
          JSON.stringify(parcelJsonData, null, 2),
          'utf-8'
        );
      }

      // Update property_seed.json if it exists
      if (hasPropertySeedJson) {
        const propertySeedJsonPath = path.join(dir, 'property_seed.json');
        const propertySeedJsonContent = await fs.readFile(
          propertySeedJsonPath,
          'utf-8'
        );
        const propertySeedJsonData = JSON.parse(propertySeedJsonContent);

        propertySeedJsonData.entry_http_request =
          propertySeedJsonData.source_http_request;
        propertySeedJsonData.source_http_request = finalRequest;

        await fs.writeFile(
          path.join(root, 'property_seed.json'),
          JSON.stringify(propertySeedJsonData, null, 2),
          'utf-8'
        );
      }

      // Update address files independently - maintain both if both exist
      // Update address.json if it exists
      if (hasAddressJson) {
        const addressJsonPath = path.join(dir, 'address.json');
        const addressJsonContent = await fs.readFile(addressJsonPath, 'utf-8');
        const addressJsonData = JSON.parse(addressJsonContent);

        if (addressJsonData.source_http_request) {
          addressJsonData.entry_http_request =
            addressJsonData.source_http_request;
          addressJsonData.source_http_request = finalRequest;
        }

        await fs.writeFile(
          path.join(root, 'address.json'),
          JSON.stringify(addressJsonData, null, 2),
          'utf-8'
        );
      }

      // Update unnormalized_address.json if it exists
      if (hasUnnormalizedAddressJson) {
        const unnormalizedAddressJsonPath = path.join(
          dir,
          'unnormalized_address.json'
        );
        const unnormalizedAddressJsonContent = await fs.readFile(
          unnormalizedAddressJsonPath,
          'utf-8'
        );
        const unnormalizedAddressJsonData = JSON.parse(
          unnormalizedAddressJsonContent
        );

        if (unnormalizedAddressJsonData.source_http_request) {
          unnormalizedAddressJsonData.entry_http_request =
            unnormalizedAddressJsonData.source_http_request;
          unnormalizedAddressJsonData.source_http_request = finalRequest;
        }

        await fs.writeFile(
          path.join(root, 'unnormalized_address.json'),
          JSON.stringify(unnormalizedAddressJsonData, null, 2),
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
