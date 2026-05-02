import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import AdmZip from 'adm-zip';

const page = {
  content: vi.fn(),
  [Symbol.asyncDispose]: vi.fn(),
};

vi.mock('../../../src/lib/common.js', async () => {
  const actual = await vi.importActual<
    typeof import('../../../src/lib/common.js')
  >('../../../src/lib/common.js');

  return {
    ...actual,
    createBrowserPage: vi.fn(async () => page),
  };
});

describe('prepare browser flow v2', () => {
  let dir: string;
  let inputZip: string;
  let flowZip: string;
  let outputZip: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    page.content.mockResolvedValue(
      '<!DOCTYPE html><html><head><style>.x{color:red}</style></head><body><main style="color:red">Property</main><script>bad()</script></body></html>'
    );
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'browser-flow-v2-'));
    inputZip = path.join(dir, 'input.zip');
    flowZip = path.join(dir, 'flow.zip');
    outputZip = path.join(dir, 'output.zip');
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('runs a packaged handler and writes captures without changing input files', async () => {
    const parcel = {
      request_identifier: 'parcel-123',
      parcel_identifier: 'parcel-123',
      source_http_request: {
        method: 'GET',
        url: 'https://county.example/search',
        multiValueQueryString: {
          id: ['parcel-123'],
        },
      },
    };
    const address = {
      request_identifier: 'parcel-123',
      county_name: 'Example',
      unnormalized_address: '123 Main St',
    };
    const input = new AdmZip();
    input.addFile('parcel.json', Buffer.from(JSON.stringify(parcel, null, 2)));
    input.addFile(
      'address.json',
      Buffer.from(JSON.stringify(address, null, 2))
    );
    input.writeZip(inputZip);

    const flow = new AdmZip();
    flow.addFile(
      'handler.js',
      Buffer.from(`
export async function handler({ input, page, saveHtml, saveSourceUrl }) {
  if (input.request_identifier !== 'parcel-123') {
    throw new Error('unexpected request identifier');
  }

  if (input.url !== 'https://county.example/search?id=parcel-123') {
    throw new Error('unexpected constructed URL');
  }

  await saveSourceUrl('https://county.example/details?id=parcel-123');
  await saveHtml({ name: 'property-detail', html: await page.content() });
}
`)
    );
    flow.writeZip(flowZip);

    const { prepare } = await import('../../../src/lib/prepare.js');

    await prepare(inputZip, outputZip, {
      browserFlowVersion: 2,
      browserFlowZip: flowZip,
    });

    const output = new AdmZip(outputZip);
    const entries = output
      .getEntries()
      .map((entry) => entry.entryName)
      .sort();

    expect(entries).toEqual([
      'address.json',
      'captures.json',
      'captures/property-detail.html',
      'parcel.json',
    ]);
    expect(JSON.parse(output.readAsText('parcel.json') || '{}')).toStrictEqual(
      parcel
    );
    expect(JSON.parse(output.readAsText('address.json') || '{}')).toStrictEqual(
      address
    );
    expect(JSON.parse(output.readAsText('captures.json') || '{}')).toEqual({
      version: 2,
      request_identifier: 'parcel-123',
      sourceUrl: 'https://county.example/details?id=parcel-123',
      captures: [
        {
          name: 'property-detail',
          path: 'captures/property-detail.html',
          type: 'html',
        },
      ],
    });
    expect(output.readAsText('captures/property-detail.html')).toContain(
      '<main>Property</main>'
    );
    expect(output.readAsText('captures/property-detail.html')).not.toContain(
      '<script>'
    );
  });

  it('rejects a v2 flow ZIP without the v2 version flag', async () => {
    const input = new AdmZip();
    input.addFile(
      'parcel.json',
      Buffer.from(
        JSON.stringify({
          request_identifier: 'parcel-123',
          source_http_request: {
            method: 'GET',
            url: 'https://county.example/search',
            multiValueQueryString: {},
          },
        })
      )
    );
    input.addFile(
      'address.json',
      Buffer.from(
        JSON.stringify({
          county_name: 'Example',
        })
      )
    );
    input.writeZip(inputZip);

    const flow = new AdmZip();
    flow.addFile(
      'handler.js',
      Buffer.from('export async function handler() {}')
    );
    flow.writeZip(flowZip);

    const { prepare } = await import('../../../src/lib/prepare.js');

    await expect(
      prepare(inputZip, outputZip, {
        browserFlowZip: flowZip,
      })
    ).rejects.toThrow('--browser-flow-zip requires --browser-flow-version 2');
  });
});
