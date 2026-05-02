import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import AdmZip from 'adm-zip';
import { prepare } from '../../../src/lib/prepare.js';

const { page, frame } = vi.hoisted(() => {
  const frame = {
    content: vi.fn(),
    url: vi.fn().mockReturnValue('https://example.com/frame-details'),
  };
  return {
    frame,
    page: {
      goto: vi.fn().mockResolvedValue({}),
      goBack: vi.fn().mockResolvedValue({}),
      content: vi.fn(),
      waitForSelector: vi.fn().mockResolvedValue({}),
      $: vi.fn().mockResolvedValue({
        contentFrame: vi.fn().mockResolvedValue(frame),
      }),
      click: vi.fn().mockResolvedValue(undefined),
      url: vi.fn().mockReturnValue('https://example.com/details'),
      setRequestInterception: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
      evaluateOnNewDocument: vi.fn().mockResolvedValue(undefined),
      setUserAgent: vi.fn().mockResolvedValue(undefined),
      setExtraHTTPHeaders: vi.fn().mockResolvedValue(undefined),
      [Symbol.asyncDispose]: vi.fn().mockResolvedValue(undefined),
    },
  };
});

vi.mock('../../../src/lib/common.js', async () => {
  const actual = await vi.importActual('../../../src/lib/common.js');
  return {
    ...actual,
    createBrowserPage: vi.fn().mockResolvedValue(page),
  };
});

describe('prepare browser flow captures', () => {
  let tempDir: string;
  let inputZipPath: string;
  let outputZipPath: string;
  let browserFlowPath: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    page.goto.mockResolvedValue({});
    page.goBack.mockResolvedValue({});
    page.waitForSelector.mockResolvedValue({});
    page.$.mockResolvedValue({
      contentFrame: vi.fn().mockResolvedValue(frame),
    });
    frame.content.mockResolvedValue('<html><body>Iframe Details</body></html>');
    frame.url.mockReturnValue('https://example.com/frame-details');
    page.content
      .mockResolvedValueOnce('<html><body>Search Results</body></html>')
      .mockResolvedValueOnce('<html><body>Property Details</body></html>');

    tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'prepare-browser-captures-')
    );
    inputZipPath = path.join(tempDir, 'input.zip');
    outputZipPath = path.join(tempDir, 'output.zip');
    browserFlowPath = path.join(tempDir, 'browser-flow.json');

    const inputZip = new AdmZip();
    inputZip.addFile(
      'parcel.json',
      Buffer.from(
        JSON.stringify({
          parcel_identifier: 'test-parcel',
          request_identifier: 'test-request',
          source_http_request: {
            method: 'GET',
            url: 'https://example.com/search',
            multiValueQueryString: {},
          },
        })
      )
    );
    inputZip.addFile(
      'address.json',
      Buffer.from(
        JSON.stringify({
          county_name: 'Test County',
          request_identifier: 'test-request',
          source_http_request: {
            method: 'GET',
            url: 'https://example.com/search',
            multiValueQueryString: {},
          },
        })
      )
    );
    inputZip.writeZip(inputZipPath);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('writes named HTML captures for a version 2 browser flow', async () => {
    await fs.writeFile(
      browserFlowPath,
      JSON.stringify({
        version: 2,
        starts_at: 'open-search-page',
        states: {
          'open-search-page': {
            type: 'open_page',
            input: {
              url: '{{=it.url}}',
            },
            next: 'capture-search-results',
          },
          'capture-search-results': {
            type: 'capture_html',
            input: {
              name: 'search-results',
            },
            next: 'click-details',
          },
          'click-details': {
            type: 'click',
            input: {
              selector: '#details',
            },
            next: 'capture-details',
          },
          'capture-details': {
            type: 'capture_html',
            input: {
              name: 'details',
            },
            next: 'capture-source',
          },
          'capture-source': {
            type: 'capture_source_url',
            input: {},
            end: true,
          },
        },
      }),
      'utf-8'
    );

    await prepare(inputZipPath, outputZipPath, {
      browserFlowFile: browserFlowPath,
      headless: true,
    });

    const outputZip = new AdmZip(outputZipPath);
    const entries = outputZip.getEntries().map((entry) => entry.entryName);

    expect(entries).toContain('search-results.html');
    expect(entries).toContain('details.html');
    expect(entries).not.toContain('test-request.html');
    expect(outputZip.readAsText('search-results.html')).toContain(
      'Search Results'
    );
    expect(outputZip.readAsText('details.html')).toContain('Property Details');
  });

  it('prefixes named HTML captures with request identifiers in CSV mode', async () => {
    const csvPath = path.join(tempDir, 'requests.csv');
    await fs.writeFile(csvPath, 'request_identifier\nid-001', 'utf-8');
    await fs.writeFile(
      browserFlowPath,
      JSON.stringify({
        version: 2,
        starts_at: 'open-search-page',
        states: {
          'open-search-page': {
            type: 'open_page',
            input: {
              url: 'https://example.com/search/e7e6ec95-4042-4710-ad00-f946bb30291f',
            },
            next: 'capture-search-results',
          },
          'capture-search-results': {
            type: 'capture_html',
            input: {
              name: 'search-results',
            },
            next: 'capture-source',
          },
          'capture-source': {
            type: 'capture_source_url',
            input: {},
            end: true,
          },
        },
      }),
      'utf-8'
    );

    await prepare('', outputZipPath, {
      inputCsv: csvPath,
      browserFlowFile: browserFlowPath,
      headless: true,
    });

    const outputZip = new AdmZip(outputZipPath);
    const entries = outputZip.getEntries().map((entry) => entry.entryName);

    expect(entries).toContain('id-001-search-results.html');
    expect(entries).not.toContain('search-results.html');
    expect(outputZip.readAsText('id-001-search-results.html')).toContain(
      'Search Results'
    );
  });

  it('reports browser flow state names in operation-specific errors', async () => {
    page.goto.mockRejectedValueOnce(new Error('Navigation broke'));
    await fs.writeFile(
      browserFlowPath,
      JSON.stringify({
        version: 2,
        starts_at: 'open-search-page',
        states: {
          'open-search-page': {
            type: 'open_page',
            input: {
              url: '{{=it.url}}',
            },
            next: 'capture-source',
          },
          'capture-source': {
            type: 'capture_source_url',
            input: {},
            end: true,
          },
        },
      }),
      'utf-8'
    );

    await expect(
      prepare(inputZipPath, outputZipPath, {
        browserFlowFile: browserFlowPath,
        headless: true,
      })
    ).rejects.toThrow(
      'State "open-search-page" could not open page "https://example.com/search": Navigation broke'
    );
  });

  it('captures iframe HTML and uses iframe URL as the source request', async () => {
    await fs.writeFile(
      browserFlowPath,
      JSON.stringify({
        version: 2,
        starts_at: 'open-search-page',
        states: {
          'open-search-page': {
            type: 'open_page',
            input: {
              url: '{{=it.url}}',
            },
            next: 'capture-details',
          },
          'capture-details': {
            type: 'capture_html',
            input: {
              name: 'details',
              target: {
                type: 'iframe',
                selector: '#details-frame',
              },
            },
            next: 'capture-source',
          },
          'capture-source': {
            type: 'capture_source_url',
            input: {
              target: {
                type: 'iframe',
                selector: '#details-frame',
              },
            },
            end: true,
          },
        },
      }),
      'utf-8'
    );

    await prepare(inputZipPath, outputZipPath, {
      browserFlowFile: browserFlowPath,
      headless: true,
    });

    const outputZip = new AdmZip(outputZipPath);
    const parcel = JSON.parse(outputZip.readAsText('parcel.json'));

    expect(outputZip.readAsText('details.html')).toContain('Iframe Details');
    expect(parcel.source_http_request.url).toBe(
      'https://example.com/frame-details'
    );
    expect(parcel.entry_http_request.url).toBe('https://example.com/search');
  });

  it('can go back in browser history between version 2 captures', async () => {
    page.content.mockReset();
    page.content
      .mockResolvedValueOnce('<html><body>Permit Details</body></html>')
      .mockResolvedValueOnce('<html><body>Search Results Again</body></html>');

    await fs.writeFile(
      browserFlowPath,
      JSON.stringify({
        version: 2,
        starts_at: 'open-search-page',
        states: {
          'open-search-page': {
            type: 'open_page',
            input: {
              url: '{{=it.url}}',
            },
            next: 'click-permit',
          },
          'click-permit': {
            type: 'click',
            input: {
              selector: '#permit',
            },
            next: 'capture-permit',
          },
          'capture-permit': {
            type: 'capture_html',
            input: {
              name: 'permit-details',
            },
            next: 'back-to-results',
          },
          'back-to-results': {
            type: 'go_back',
            input: {},
            next: 'capture-results-again',
          },
          'capture-results-again': {
            type: 'capture_html',
            input: {
              name: 'results-after-back',
            },
            next: 'capture-source',
          },
          'capture-source': {
            type: 'capture_source_url',
            input: {},
            end: true,
          },
        },
      }),
      'utf-8'
    );

    await prepare(inputZipPath, outputZipPath, {
      browserFlowFile: browserFlowPath,
      headless: true,
    });

    const outputZip = new AdmZip(outputZipPath);

    expect(outputZip.readAsText('permit-details.html')).toContain(
      'Permit Details'
    );
    expect(outputZip.readAsText('results-after-back.html')).toContain(
      'Search Results Again'
    );
  });

  it('reports go_back state names in browser history errors', async () => {
    page.goBack.mockRejectedValueOnce(new Error('No history entry'));
    await fs.writeFile(
      browserFlowPath,
      JSON.stringify({
        version: 2,
        starts_at: 'open-search-page',
        states: {
          'open-search-page': {
            type: 'open_page',
            input: {
              url: '{{=it.url}}',
            },
            next: 'back-to-results',
          },
          'back-to-results': {
            type: 'go_back',
            input: {},
            next: 'capture-source',
          },
          'capture-source': {
            type: 'capture_source_url',
            input: {},
            end: true,
          },
        },
      }),
      'utf-8'
    );

    await expect(
      prepare(inputZipPath, outputZipPath, {
        browserFlowFile: browserFlowPath,
        headless: true,
      })
    ).rejects.toThrow(
      'State "back-to-results" could not go back in browser history: No history entry'
    );
  });
});
