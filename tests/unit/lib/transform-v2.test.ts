import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import AdmZip from 'adm-zip';
import { handleTransform } from '../../../src/commands/transform/index.js';
import { transform } from '../../../src/lib/commands.js';

vi.mock('../../../src/services/schema-manifest.service.js', () => ({
  SchemaManifestService: vi.fn().mockImplementation(() => ({
    loadSchemaManifest: vi.fn().mockResolvedValue({
      County: {
        ipfsCid: 'county-schema-cid',
        type: 'dataGroup',
      },
    }),
    getDataGroupCidByLabel: vi.fn((label: string) =>
      label === 'County' ? 'county-schema-cid' : null
    ),
  })),
}));

vi.mock('../../../src/services/schema-cache.service.js', () => ({
  SchemaCacheService: vi.fn().mockImplementation(() => ({
    get: vi.fn().mockResolvedValue({
      type: 'object',
      properties: {
        relationships: {
          type: 'object',
          properties: {
            property_has_address: {
              type: ['string', 'null'],
            },
          },
        },
      },
    }),
  })),
}));

describe('transform v2', () => {
  let dir: string;
  let inputZip: string;
  let transformZip: string;
  let outputZip: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'transform-v2-'));
    inputZip = path.join(dir, 'input.zip');
    transformZip = path.join(dir, 'transform.zip');
    outputZip = path.join(dir, 'output.zip');
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('requires a prepare v2 captures manifest', async () => {
    const input = new AdmZip();
    input.addFile(
      'address.json',
      Buffer.from(
        JSON.stringify({
          request_identifier: 'parcel-123',
          county_name: 'Example',
          unnormalized_address: '123 Main St',
        })
      )
    );
    input.addFile(
      'parcel.json',
      Buffer.from(
        JSON.stringify({
          request_identifier: 'parcel-123',
          parcel_identifier: 'parcel-123',
          source_http_request: {
            method: 'GET',
            url: 'https://county.example/search',
            multiValueQueryString: {},
          },
        })
      )
    );
    input.writeZip(inputZip);

    const handler = new AdmZip();
    handler.addFile(
      'handler.js',
      Buffer.from('export async function handler() {}')
    );
    handler.writeZip(transformZip);

    await expect(
      handleTransform({
        inputZip,
        outputZip,
        transformVersion: 2,
        transformZip,
        silent: true,
      })
    ).rejects.toThrow('captures.json is required for transform v2');
  });

  it('returns transform v2 failures through scriptFailure in the library API', async () => {
    const input = new AdmZip();
    input.addFile(
      'address.json',
      Buffer.from(
        JSON.stringify({
          request_identifier: 'parcel-123',
          county_name: 'Example',
          unnormalized_address: '123 Main St',
        })
      )
    );
    input.addFile(
      'parcel.json',
      Buffer.from(
        JSON.stringify({
          request_identifier: 'parcel-123',
          parcel_identifier: 'parcel-123',
          source_http_request: {
            method: 'GET',
            url: 'https://county.example/search',
            multiValueQueryString: {},
          },
        })
      )
    );
    input.writeZip(inputZip);

    const handler = new AdmZip();
    handler.addFile(
      'handler.js',
      Buffer.from('export async function handler() {}')
    );
    handler.writeZip(transformZip);

    const result = await transform({
      inputZip,
      outputZip,
      transformVersion: 2,
      transformZip,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('captures.json is required for transform v2');
    expect(result.scriptFailure).toEqual({
      message: 'captures.json is required for transform v2',
    });
  });

  it('runs a handler package and writes entity JSON with request metadata', async () => {
    const sourceHttpRequest = {
      method: 'GET',
      url: 'https://county.example/search',
      multiValueQueryString: {
        id: ['parcel-123'],
      },
    };
    const input = new AdmZip();
    input.addFile(
      'address.json',
      Buffer.from(
        JSON.stringify({
          request_identifier: 'parcel-123',
          county_name: 'Example',
          unnormalized_address: '123 Main St',
        })
      )
    );
    input.addFile(
      'parcel.json',
      Buffer.from(
        JSON.stringify({
          request_identifier: 'parcel-123',
          parcel_identifier: 'parcel-123',
          source_http_request: sourceHttpRequest,
        })
      )
    );
    input.addFile(
      'captures.json',
      Buffer.from(
        JSON.stringify({
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
        })
      )
    );
    input.addFile(
      'captures/property-detail.html',
      Buffer.from('<html><body><h1>Property Detail</h1></body></html>')
    );
    input.writeZip(inputZip);

    const handler = new AdmZip();
    handler.addFile(
      'handler.js',
      Buffer.from(`
export async function handler({ readCapture, writeJson }) {
  const html = await readCapture('property-detail');
  await writeJson('property', {
    parcel_identifier: html.includes('Property Detail') ? 'parcel-123' : 'missing'
  });
}
`)
    );
    handler.writeZip(transformZip);

    await handleTransform({
      inputZip,
      outputZip,
      transformVersion: 2,
      transformZip,
      silent: true,
    });

    const output = new AdmZip(outputZip);
    const entries = output
      .getEntries()
      .map((entry) => entry.entryName)
      .sort();

    expect(entries).toEqual(['data/property.json']);
    expect(JSON.parse(output.readAsText('data/property.json') || '{}')).toEqual(
      {
        parcel_identifier: 'parcel-123',
        request_identifier: 'parcel-123',
        source_http_request: sourceHttpRequest,
      }
    );
  });

  it('writes relationships and creates a schema-aware data-group root', async () => {
    const input = new AdmZip();
    input.addFile(
      'address.json',
      Buffer.from(
        JSON.stringify({
          request_identifier: 'parcel-123',
          county_name: 'Example',
          unnormalized_address: '123 Main St',
        })
      )
    );
    input.addFile(
      'parcel.json',
      Buffer.from(
        JSON.stringify({
          request_identifier: 'parcel-123',
          parcel_identifier: 'parcel-123',
          source_http_request: {
            method: 'GET',
            url: 'https://county.example/search',
            multiValueQueryString: {},
          },
        })
      )
    );
    input.addFile(
      'captures.json',
      Buffer.from(
        JSON.stringify({
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
        })
      )
    );
    input.addFile(
      'captures/property-detail.html',
      Buffer.from('<html><body><h1>Property Detail</h1></body></html>')
    );
    input.writeZip(inputZip);

    const handler = new AdmZip();
    handler.addFile(
      'handler.js',
      Buffer.from(`
export async function handler({ input, writeJson, writeRelationship }) {
  await writeJson('property', { parcel_identifier: input.parcel.parcel_identifier });
  await writeJson('address', input.address);
  await writeRelationship({
    type: 'property_has_address',
    name: 'relationship_property_address',
    from: 'property',
    to: 'address'
  });
}
`)
    );
    handler.writeZip(transformZip);

    await handleTransform({
      inputZip,
      outputZip,
      transformVersion: 2,
      transformZip,
      silent: true,
    });

    const output = new AdmZip(outputZip);
    const entries = output
      .getEntries()
      .map((entry) => entry.entryName)
      .sort();

    expect(entries).toEqual([
      'data/address.json',
      'data/county-schema-cid.json',
      'data/property.json',
      'data/relationship_property_address.json',
    ]);
    expect(
      JSON.parse(
        output.readAsText('data/relationship_property_address.json') || '{}'
      )
    ).toEqual({
      from: { '/': './property.json' },
      to: { '/': './address.json' },
    });
    expect(
      JSON.parse(output.readAsText('data/county-schema-cid.json') || '{}')
    ).toEqual({
      label: 'County',
      relationships: {
        property_has_address: { '/': './relationship_property_address.json' },
      },
    });
  });

  it('rejects capture paths that escape the prepared input directory', async () => {
    const input = new AdmZip();
    input.addFile(
      'address.json',
      Buffer.from(
        JSON.stringify({
          request_identifier: 'parcel-123',
          county_name: 'Example',
          unnormalized_address: '123 Main St',
        })
      )
    );
    input.addFile(
      'parcel.json',
      Buffer.from(
        JSON.stringify({
          request_identifier: 'parcel-123',
          parcel_identifier: 'parcel-123',
          source_http_request: {
            method: 'GET',
            url: 'https://county.example/search',
            multiValueQueryString: {},
          },
        })
      )
    );
    input.addFile(
      'captures.json',
      Buffer.from(
        JSON.stringify({
          version: 2,
          request_identifier: 'parcel-123',
          sourceUrl: 'https://county.example/details?id=parcel-123',
          captures: [
            {
              name: 'property-detail',
              path: '../../../package.json',
              type: 'html',
            },
          ],
        })
      )
    );
    input.writeZip(inputZip);

    const handler = new AdmZip();
    handler.addFile(
      'handler.js',
      Buffer.from(`
export async function handler({ readCapture, writeJson }) {
  const content = await readCapture('property-detail');
  await writeJson('property', { leaked: content.length });
}
`)
    );
    handler.writeZip(transformZip);

    await expect(
      handleTransform({
        inputZip,
        outputZip,
        transformVersion: 2,
        transformZip,
        silent: true,
      })
    ).rejects.toThrow('Invalid capture path: ../../../package.json');
  });

  it('rejects relationships that reference relationship outputs', async () => {
    const input = new AdmZip();
    input.addFile(
      'address.json',
      Buffer.from(
        JSON.stringify({
          request_identifier: 'parcel-123',
          county_name: 'Example',
          unnormalized_address: '123 Main St',
        })
      )
    );
    input.addFile(
      'parcel.json',
      Buffer.from(
        JSON.stringify({
          request_identifier: 'parcel-123',
          parcel_identifier: 'parcel-123',
          source_http_request: {
            method: 'GET',
            url: 'https://county.example/search',
            multiValueQueryString: {},
          },
        })
      )
    );
    input.addFile(
      'captures.json',
      Buffer.from(
        JSON.stringify({
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
        })
      )
    );
    input.addFile(
      'captures/property-detail.html',
      Buffer.from('<html><body><h1>Property Detail</h1></body></html>')
    );
    input.writeZip(inputZip);

    const handler = new AdmZip();
    handler.addFile(
      'handler.js',
      Buffer.from(`
export async function handler({ input, writeJson, writeRelationship }) {
  await writeJson('property', { parcel_identifier: input.parcel.parcel_identifier });
  await writeJson('address', input.address);
  await writeRelationship({
    type: 'property_has_address',
    name: 'relationship_property_address',
    from: 'property',
    to: 'address'
  });
  await writeRelationship({
    type: 'property_has_address',
    name: 'relationship_property_address_2',
    from: 'relationship_property_address',
    to: 'address'
  });
}
`)
    );
    handler.writeZip(transformZip);

    await expect(
      handleTransform({
        inputZip,
        outputZip,
        transformVersion: 2,
        transformZip,
        silent: true,
      })
    ).rejects.toThrow(
      'Unknown relationship source: relationship_property_address'
    );
  });

  it('validates timeout configuration exported by the handler package', async () => {
    const input = new AdmZip();
    input.addFile(
      'address.json',
      Buffer.from(
        JSON.stringify({
          request_identifier: 'parcel-123',
          county_name: 'Example',
          unnormalized_address: '123 Main St',
        })
      )
    );
    input.addFile(
      'parcel.json',
      Buffer.from(
        JSON.stringify({
          request_identifier: 'parcel-123',
          parcel_identifier: 'parcel-123',
          source_http_request: {
            method: 'GET',
            url: 'https://county.example/search',
            multiValueQueryString: {},
          },
        })
      )
    );
    input.addFile(
      'captures.json',
      Buffer.from(
        JSON.stringify({
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
        })
      )
    );
    input.addFile(
      'captures/property-detail.html',
      Buffer.from('<html><body><h1>Property Detail</h1></body></html>')
    );
    input.writeZip(inputZip);

    const handler = new AdmZip();
    handler.addFile(
      'handler.js',
      Buffer.from(`
export const config = { timeoutMs: 999 };

export async function handler() {
}
`)
    );
    handler.writeZip(transformZip);

    await expect(
      handleTransform({
        inputZip,
        outputZip,
        transformVersion: 2,
        transformZip,
        silent: true,
      })
    ).rejects.toThrow(
      'Transform v2 timeoutMs must be between 1000ms and 600000ms'
    );
  });
});
