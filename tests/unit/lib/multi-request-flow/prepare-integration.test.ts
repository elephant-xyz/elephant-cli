import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { prepare } from '../../../../src/lib/prepare.js';
import { promises as fs } from 'fs';
import AdmZip from 'adm-zip';
import { tmpdir } from 'os';
import path from 'path';

vi.mock('../../../../src/utils/logger.js');

describe('prepare command with multi-request flow integration', () => {
  let testDir: string;
  let inputZipPath: string;
  let outputZipPath: string;
  let flowFilePath: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    global.fetch = vi.fn();

    testDir = await fs.mkdtemp(path.join(tmpdir(), 'elephant-test-'));
    inputZipPath = path.join(testDir, 'input.zip');
    outputZipPath = path.join(testDir, 'output.zip');
    flowFilePath = path.join(testDir, 'flow.json');
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  async function createInputZip(
    parcelData: Record<string, unknown>,
    addressData: Record<string, unknown>
  ): Promise<void> {
    const zip = new AdmZip();
    zip.addFile(
      'parcel.json',
      Buffer.from(JSON.stringify(parcelData, null, 2))
    );
    zip.addFile(
      'address.json',
      Buffer.from(JSON.stringify(addressData, null, 2))
    );
    zip.writeZip(inputZipPath);
  }

  async function readOutputZip(): Promise<{
    parcel: Record<string, unknown>;
    address: Record<string, unknown>;
    preparedData: string;
  }> {
    const zip = new AdmZip(outputZipPath);
    const entries = zip.getEntries();

    const parcelEntry = entries.find((e) => e.entryName === 'parcel.json');
    const addressEntry = entries.find((e) => e.entryName === 'address.json');
    const dataEntry = entries.find(
      (e) =>
        e.entryName.endsWith('.json') &&
        e.entryName !== 'parcel.json' &&
        e.entryName !== 'address.json'
    );

    if (!parcelEntry || !addressEntry || !dataEntry) {
      throw new Error('Required files not found in output zip');
    }

    return {
      parcel: JSON.parse(parcelEntry.getData().toString('utf-8')),
      address: JSON.parse(addressEntry.getData().toString('utf-8')),
      preparedData: dataEntry.getData().toString('utf-8'),
    };
  }

  it('executes multi-request flow and combines responses', async () => {
    const parcelData = {
      request_identifier: '583207459',
      source_http_request: {
        method: 'GET',
        url: 'https://example.com/search',
        multiValueQueryString: {},
      },
    };

    const addressData = {
      county_name: 'Manatee',
      state_abbreviation: 'FL',
    };

    await createInputZip(parcelData, addressData);

    const flowConfig = {
      requests: [
        {
          key: 'OwnersAndGeneralInfo',
          request: {
            method: 'POST',
            url: 'https://example.com/api/owner',
            headers: {
              'content-type': 'application/x-www-form-urlencoded',
            },
            body: 'parid={{=it.request_identifier}}',
          },
        },
        {
          key: 'Sales',
          request: {
            method: 'GET',
            url: 'https://example.com/api/sales?parid={{=it.request_identifier}}',
          },
        },
        {
          key: 'Tax',
          request: {
            method: 'GET',
            url: 'https://example.com/api/tax?parid={{=it.request_identifier}}',
          },
        },
      ],
    };

    await fs.writeFile(flowFilePath, JSON.stringify(flowConfig, null, 2));

    const mockOwnerResponse = '<html><body>Owner Data</body></html>';
    const mockSalesResponse = [{ id: 1, date: '2023-01-01', price: 500000 }];
    const mockTaxResponse = { year: 2023, amount: 5000 };

    vi.mocked(fetch)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers(),
        text: async () => mockOwnerResponse,
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers(),
        text: async () => JSON.stringify(mockSalesResponse),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers(),
        text: async () => JSON.stringify(mockTaxResponse),
      } as Response);

    await prepare(inputZipPath, outputZipPath, {
      multiRequestFlowFile: flowFilePath,
    });

    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch).toHaveBeenNthCalledWith(
      1,
      'https://example.com/api/owner',
      expect.objectContaining({
        method: 'POST',
        body: 'parid=583207459',
      })
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      'https://example.com/api/sales?parid=583207459',
      expect.objectContaining({ method: 'GET' })
    );
    expect(fetch).toHaveBeenNthCalledWith(
      3,
      'https://example.com/api/tax?parid=583207459',
      expect.objectContaining({ method: 'GET' })
    );

    const output = await readOutputZip();

    const preparedJson = JSON.parse(output.preparedData);
    expect(preparedJson).toHaveProperty('OwnersAndGeneralInfo');
    expect(preparedJson).toHaveProperty('Sales');
    expect(preparedJson).toHaveProperty('Tax');

    expect(preparedJson.OwnersAndGeneralInfo.response).toBe(mockOwnerResponse);
    expect(preparedJson.Sales.response).toEqual(mockSalesResponse);
    expect(preparedJson.Tax.response).toEqual(mockTaxResponse);

    expect(preparedJson.OwnersAndGeneralInfo.source_http_request.url).toBe(
      'https://example.com/api/owner'
    );
    expect(preparedJson.OwnersAndGeneralInfo.source_http_request.body).toBe(
      'parid=583207459'
    );

    expect(preparedJson.Sales.source_http_request.url).toBe(
      'https://example.com/api/sales'
    );
    expect(
      preparedJson.Sales.source_http_request.multiValueQueryString
    ).toEqual({
      parid: ['583207459'],
    });
  });

  it('substitutes request_identifier in all request parts', async () => {
    const parcelData = {
      request_identifier: 'TEST-ID-123',
      source_http_request: {
        method: 'GET',
        url: 'https://example.com/search',
        multiValueQueryString: {},
      },
    };

    const addressData = {
      county_name: 'TestCounty',
    };

    await createInputZip(parcelData, addressData);

    const flowConfig = {
      requests: [
        {
          key: 'ComplexRequest',
          request: {
            method: 'POST',
            url: 'https://example.com/{{=it.request_identifier}}/api',
            headers: {
              'content-type': 'application/json',
              'x-request-id': '{{=it.request_identifier}}',
            },
            multiValueQueryString: {
              ref: ['{{=it.request_identifier}}'],
            },
            json: {
              id: '{{=it.request_identifier}}',
              nested: {
                value: '{{=it.request_identifier}}',
              },
            },
          },
        },
      ],
    };

    await fs.writeFile(flowFilePath, JSON.stringify(flowConfig, null, 2));

    const mockResponse = { success: true };

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers(),
      text: async () => JSON.stringify(mockResponse),
    } as Response);

    await prepare(inputZipPath, outputZipPath, {
      multiRequestFlowFile: flowFilePath,
    });

    expect(fetch).toHaveBeenCalledWith(
      'https://example.com/TEST-ID-123/api?ref=TEST-ID-123',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'content-type': 'application/json',
          'x-request-id': 'TEST-ID-123',
        }),
        body: JSON.stringify({
          id: 'TEST-ID-123',
          nested: {
            value: 'TEST-ID-123',
          },
        }),
      })
    );

    const output = await readOutputZip();
    const preparedJson = JSON.parse(output.preparedData);

    expect(preparedJson.ComplexRequest.source_http_request.url).toBe(
      'https://example.com/TEST-ID-123/api'
    );
    expect(preparedJson.ComplexRequest.source_http_request.json.id).toBe(
      'TEST-ID-123'
    );
  });

  it('handles multiple requests with different methods and bodies', async () => {
    const parcelData = {
      request_identifier: 'ABC123',
      source_http_request: {
        method: 'GET',
        url: 'https://example.com/search',
        multiValueQueryString: {},
      },
    };

    const addressData = {
      county_name: 'TestCounty',
    };

    await createInputZip(parcelData, addressData);

    const flowConfig = {
      requests: [
        {
          key: 'GetRequest',
          request: {
            method: 'GET',
            url: 'https://example.com/api1?id={{=it.request_identifier}}',
          },
        },
        {
          key: 'PostJson',
          request: {
            method: 'POST',
            url: 'https://example.com/api2',
            headers: {
              'content-type': 'application/json',
            },
            json: {
              parid: '{{=it.request_identifier}}',
            },
          },
        },
        {
          key: 'PostForm',
          request: {
            method: 'POST',
            url: 'https://example.com/api3',
            headers: {
              'content-type': 'application/x-www-form-urlencoded',
            },
            body: 'data=%7B%22parid%22%3A%22{{=it.request_identifier}}%22%7D',
          },
        },
        {
          key: 'PutRequest',
          request: {
            method: 'PUT',
            url: 'https://example.com/api4',
            headers: {
              'content-type': 'text/xml',
            },
            body: '<data><id>{{=it.request_identifier}}</id></data>',
          },
        },
      ],
    };

    await fs.writeFile(flowFilePath, JSON.stringify(flowConfig, null, 2));

    vi.mocked(fetch)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers(),
        text: async () => JSON.stringify({ result: 'get' }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers(),
        text: async () => JSON.stringify({ result: 'post-json' }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers(),
        text: async () => JSON.stringify({ result: 'post-form' }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers(),
        text: async () => '<response>put</response>',
      } as Response);

    await prepare(inputZipPath, outputZipPath, {
      multiRequestFlowFile: flowFilePath,
    });

    expect(fetch).toHaveBeenCalledTimes(4);

    const output = await readOutputZip();
    const preparedJson = JSON.parse(output.preparedData);

    expect(preparedJson).toHaveProperty('GetRequest');
    expect(preparedJson).toHaveProperty('PostJson');
    expect(preparedJson).toHaveProperty('PostForm');
    expect(preparedJson).toHaveProperty('PutRequest');

    expect(preparedJson.GetRequest.source_http_request.method).toBe('GET');
    expect(preparedJson.PostJson.source_http_request.method).toBe('POST');
    expect(preparedJson.PostForm.source_http_request.method).toBe('POST');
    expect(preparedJson.PutRequest.source_http_request.method).toBe('PUT');
  });

  it('preserves original seed files in output', async () => {
    const parcelData = {
      request_identifier: '123',
      source_http_request: {
        method: 'GET',
        url: 'https://example.com/search',
        multiValueQueryString: {},
      },
      additional_field: 'test-value',
    };

    const addressData = {
      county_name: 'TestCounty',
      street_address: '123 Main St',
    };

    await createInputZip(parcelData, addressData);

    const flowConfig = {
      requests: [
        {
          key: 'TestRequest',
          request: {
            method: 'GET',
            url: 'https://example.com/api',
          },
        },
      ],
    };

    await fs.writeFile(flowFilePath, JSON.stringify(flowConfig, null, 2));

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers(),
      text: async () => JSON.stringify({ data: 'test' }),
    } as Response);

    await prepare(inputZipPath, outputZipPath, {
      multiRequestFlowFile: flowFilePath,
    });

    const output = await readOutputZip();

    expect(output.parcel.request_identifier).toBe('123');
    expect(output.parcel.additional_field).toBe('test-value');
    expect(output.address.county_name).toBe('TestCounty');
    expect(output.address.street_address).toBe('123 Main St');
  });
});
