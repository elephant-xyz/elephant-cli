import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { executeMultiRequestFlow } from '../../../../src/lib/multi-request-flow/executor.js';
import { MultiRequestFlow } from '../../../../src/lib/multi-request-flow/types.js';
import { logger } from '../../../../src/utils/logger.js';

vi.mock('../../../../src/utils/logger.js');

describe('multi-request-flow/executor', () => {
  const testRequestId = '583207459';

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('executeMultiRequestFlow', () => {
    it('executes single GET request and returns JSON result', async () => {
      const flow: MultiRequestFlow = {
        requests: [
          {
            key: 'TestData',
            request: {
              method: 'GET',
              url: 'https://example.com/api?id={{=it.request_identifier}}',
            },
          },
        ],
      };

      const mockResponse = { id: '583207459', name: 'Test Property' };
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () => JSON.stringify(mockResponse),
      } as Response);

      const result = await executeMultiRequestFlow(flow, testRequestId);

      expect(result.type).toBe('json');
      const output = JSON.parse(result.content);
      expect(output).toHaveProperty('TestData');
      expect(output.TestData.response).toEqual(mockResponse);
      expect(output.TestData.source_http_request.url).toBe(
        'https://example.com/api'
      );
      expect(output.TestData.source_http_request.multiValueQueryString).toEqual(
        {
          id: ['583207459'],
        }
      );

      expect(fetch).toHaveBeenCalledWith(
        'https://example.com/api?id=583207459',
        expect.objectContaining({
          method: 'GET',
        })
      );
    });

    it('executes multiple requests in sequence', async () => {
      const flow: MultiRequestFlow = {
        requests: [
          {
            key: 'Request1',
            request: {
              method: 'GET',
              url: 'https://example.com/api1?id={{=it.request_identifier}}',
            },
          },
          {
            key: 'Request2',
            request: {
              method: 'GET',
              url: 'https://example.com/api2?id={{=it.request_identifier}}',
            },
          },
        ],
      };

      const mockResponse1 = { data: 'response1' };
      const mockResponse2 = { data: 'response2' };

      vi.mocked(fetch)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: new Headers(),
          text: async () => JSON.stringify(mockResponse1),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: new Headers(),
          text: async () => JSON.stringify(mockResponse2),
        } as Response);

      const result = await executeMultiRequestFlow(flow, testRequestId);

      const output = JSON.parse(result.content);
      expect(output.Request1.response).toEqual(mockResponse1);
      expect(output.Request2.response).toEqual(mockResponse2);
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('executes POST request with JSON body', async () => {
      const flow: MultiRequestFlow = {
        requests: [
          {
            key: 'PostData',
            request: {
              method: 'POST',
              url: 'https://example.com/api',
              headers: {
                'content-type': 'application/json',
              },
              json: {
                parid: '{{=it.request_identifier}}',
                ownerType: '',
              },
            },
          },
        ],
      };

      const mockResponse = { success: true };
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers(),
        text: async () => JSON.stringify(mockResponse),
      } as Response);

      const result = await executeMultiRequestFlow(flow, testRequestId);

      const output = JSON.parse(result.content);
      expect(output.PostData.response).toEqual(mockResponse);
      expect(output.PostData.source_http_request.json).toEqual({
        parid: '583207459',
        ownerType: '',
      });

      expect(fetch).toHaveBeenCalledWith(
        'https://example.com/api',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ parid: '583207459', ownerType: '' }),
          headers: expect.objectContaining({
            'content-type': 'application/json',
          }),
        })
      );
    });

    it('executes POST request with string body', async () => {
      const flow: MultiRequestFlow = {
        requests: [
          {
            key: 'FormData',
            request: {
              method: 'POST',
              url: 'https://example.com/api',
              headers: {
                'content-type': 'application/x-www-form-urlencoded',
              },
              body: 'parid={{=it.request_identifier}}&type=property',
            },
          },
        ],
      };

      const mockResponse = '<html>Success</html>';
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers(),
        text: async () => mockResponse,
      } as Response);

      const result = await executeMultiRequestFlow(flow, testRequestId);

      const output = JSON.parse(result.content);
      expect(output.FormData.response).toBe(mockResponse);
      expect(output.FormData.source_http_request.body).toBe(
        'parid=583207459&type=property'
      );

      expect(fetch).toHaveBeenCalledWith(
        'https://example.com/api',
        expect.objectContaining({
          method: 'POST',
          body: 'parid=583207459&type=property',
        })
      );
    });

    it('handles multiValueQueryString', async () => {
      const flow: MultiRequestFlow = {
        requests: [
          {
            key: 'QueryTest',
            request: {
              method: 'GET',
              url: 'https://example.com/api',
              multiValueQueryString: {
                id: ['{{=it.request_identifier}}'],
                type: ['property', 'land'],
              },
            },
          },
        ],
      };

      const mockResponse = { data: 'test' };
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers(),
        text: async () => JSON.stringify(mockResponse),
      } as Response);

      const result = await executeMultiRequestFlow(flow, testRequestId);

      expect(fetch).toHaveBeenCalledWith(
        'https://example.com/api?id=583207459&type=property&type=land',
        expect.any(Object)
      );

      const output = JSON.parse(result.content);
      expect(output.QueryTest.source_http_request.url).toBe(
        'https://example.com/api'
      );
      expect(
        output.QueryTest.source_http_request.multiValueQueryString
      ).toEqual({
        id: ['583207459'],
        type: ['property', 'land'],
      });
    });

    it('URL-encodes special characters in multiValueQueryString', async () => {
      const flow: MultiRequestFlow = {
        requests: [
          {
            key: 'EncodingTest',
            request: {
              method: 'GET',
              url: 'https://example.com/api',
              multiValueQueryString: {
                filter: ["contains(strap,'322530307S000B0015')"],
                search: ['hello world'],
                complex: ['a&b=c'],
              },
            },
          },
        ],
      };

      const mockResponse = { data: 'test' };
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers(),
        text: async () => JSON.stringify(mockResponse),
      } as Response);

      const result = await executeMultiRequestFlow(flow, testRequestId);

      // Verify the fetch URL has properly encoded query params
      // Note: URLSearchParams encodes spaces as '+', parentheses, and single quotes
      expect(fetch).toHaveBeenCalledWith(
        'https://example.com/api?filter=contains%28strap%2C%27322530307S000B0015%27%29&search=hello+world&complex=a%26b%3Dc',
        expect.any(Object)
      );

      // Verify source_http_request stores URL-encoded values using encodeURIComponent
      // Note: encodeURIComponent does NOT encode parentheses or single quotes
      const output = JSON.parse(result.content);
      expect(
        output.EncodingTest.source_http_request.multiValueQueryString
      ).toEqual({
        filter: ["contains(strap%2C'322530307S000B0015')"],
        search: ['hello%20world'],
        complex: ['a%26b%3Dc'],
      });
    });

    it('URL-encodes query params extracted from URL', async () => {
      const flow: MultiRequestFlow = {
        requests: [
          {
            key: 'UrlEncodingTest',
            request: {
              method: 'GET',
              url: "https://example.com/api?filter=contains(strap,'322530307S000B0015')&search=hello%20world",
            },
          },
        ],
      };

      const mockResponse = { data: 'test' };
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers(),
        text: async () => JSON.stringify(mockResponse),
      } as Response);

      const result = await executeMultiRequestFlow(flow, testRequestId);

      // Verify source_http_request stores URL-encoded values even when extracted from URL
      const output = JSON.parse(result.content);
      expect(
        output.UrlEncodingTest.source_http_request.multiValueQueryString
      ).toEqual({
        filter: ["contains(strap%2C'322530307S000B0015')"],
        search: ['hello%20world'],
      });

      // URL should be normalized (query params moved to multiValueQueryString)
      expect(output.UrlEncodingTest.source_http_request.url).toBe(
        'https://example.com/api'
      );
    });

    it('parses HTML response as string when not valid JSON', async () => {
      const flow: MultiRequestFlow = {
        requests: [
          {
            key: 'HtmlData',
            request: {
              method: 'GET',
              url: 'https://example.com/page',
            },
          },
        ],
      };

      const mockHtml = '<html><body>Test Page</body></html>';
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers(),
        text: async () => mockHtml,
      } as Response);

      const result = await executeMultiRequestFlow(flow, testRequestId);

      const output = JSON.parse(result.content);
      expect(output.HtmlData.response).toBe(mockHtml);
    });

    it('parses array JSON response correctly', async () => {
      const flow: MultiRequestFlow = {
        requests: [
          {
            key: 'ArrayData',
            request: {
              method: 'GET',
              url: 'https://example.com/api',
            },
          },
        ],
      };

      const mockResponse = [{ id: 1 }, { id: 2 }];
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers(),
        text: async () => JSON.stringify(mockResponse),
      } as Response);

      const result = await executeMultiRequestFlow(flow, testRequestId);

      const output = JSON.parse(result.content);
      expect(output.ArrayData.response).toEqual(mockResponse);
    });

    it('throws error on HTTP error response', async () => {
      const flow: MultiRequestFlow = {
        requests: [
          {
            key: 'ErrorTest',
            request: {
              method: 'GET',
              url: 'https://example.com/api',
            },
          },
        ],
      };

      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        headers: new Headers(),
        text: async () => 'Not Found',
      } as Response);

      await expect(
        executeMultiRequestFlow(flow, testRequestId)
      ).rejects.toThrow('HTTP error 404: Not Found');
    });

    it('throws error on network failure', async () => {
      const flow: MultiRequestFlow = {
        requests: [
          {
            key: 'NetworkError',
            request: {
              method: 'GET',
              url: 'https://example.com/api',
            },
          },
        ],
      };

      vi.mocked(fetch).mockRejectedValueOnce(new Error('Network failure'));

      await expect(
        executeMultiRequestFlow(flow, testRequestId)
      ).rejects.toThrow('Network failure');
    });

    it('includes custom headers in request', async () => {
      const flow: MultiRequestFlow = {
        requests: [
          {
            key: 'CustomHeaders',
            request: {
              method: 'POST',
              url: 'https://example.com/api',
              headers: {
                'content-type': 'application/json',
                'x-custom-header': 'custom-value',
                'x-parcel-id': '{{=it.request_identifier}}',
              },
              json: {},
            },
          },
        ],
      };

      const mockResponse = { success: true };
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers(),
        text: async () => JSON.stringify(mockResponse),
      } as Response);

      await executeMultiRequestFlow(flow, testRequestId);

      expect(fetch).toHaveBeenCalledWith(
        'https://example.com/api',
        expect.objectContaining({
          headers: {
            'content-type': 'application/json',
            'x-custom-header': 'custom-value',
            'x-parcel-id': '583207459',
          },
        })
      );
    });

    it('handles null headers correctly', async () => {
      const flow: MultiRequestFlow = {
        requests: [
          {
            key: 'NullHeaders',
            request: {
              method: 'POST',
              url: 'https://example.com/api',
              headers: {
                'content-type': 'application/json',
                'x-optional': null,
              },
              json: {},
            },
          },
        ],
      };

      const mockResponse = { success: true };
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers(),
        text: async () => JSON.stringify(mockResponse),
      } as Response);

      await executeMultiRequestFlow(flow, testRequestId);

      expect(fetch).toHaveBeenCalledWith(
        'https://example.com/api',
        expect.objectContaining({
          headers: {
            'content-type': 'application/json',
          },
        })
      );
    });

    it('correctly formats output with all request details', async () => {
      const flow: MultiRequestFlow = {
        requests: [
          {
            key: 'FullTest',
            request: {
              method: 'POST',
              url: 'https://example.com/api/{{=it.request_identifier}}?extra=value',
              headers: {
                'content-type': 'application/json',
              },
              multiValueQueryString: {
                ref: ['{{=it.request_identifier}}'],
              },
              json: {
                id: '{{=it.request_identifier}}',
              },
            },
          },
        ],
      };

      const mockResponse = { status: 'ok' };
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers(),
        text: async () => JSON.stringify(mockResponse),
      } as Response);

      const result = await executeMultiRequestFlow(flow, testRequestId);

      const output = JSON.parse(result.content);
      expect(output.FullTest).toHaveProperty('source_http_request');
      expect(output.FullTest).toHaveProperty('response');
      expect(output.FullTest.source_http_request).toEqual({
        method: 'POST',
        url: 'https://example.com/api/583207459',
        headers: {
          'content-type': 'application/json',
        },
        multiValueQueryString: {
          extra: ['value'],
          ref: ['583207459'],
        },
        json: {
          id: '583207459',
        },
      });
      expect(output.FullTest.response).toEqual(mockResponse);
    });
  });
});
