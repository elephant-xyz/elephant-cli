import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { loadMultiRequestFlow } from '../../../../src/lib/multi-request-flow/loader.js';
import { logger } from '../../../../src/utils/logger.js';

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    promises: {
      ...actual.promises,
      readFile: vi.fn(),
    },
  };
});

vi.mock('../../../../src/utils/logger.js');

describe('multi-request-flow/loader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('loadMultiRequestFlow', () => {
    it('successfully loads valid multi-request flow', async () => {
      const validFlow = {
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

      vi.mocked(fs.readFile).mockResolvedValueOnce(
        JSON.stringify(validFlow) as any
      );

      const result = await loadMultiRequestFlow('/path/to/flow.json');

      expect(result).toEqual(validFlow);
      expect(fs.readFile).toHaveBeenCalledWith('/path/to/flow.json', 'utf-8');
    });

    it('throws error when file cannot be read', async () => {
      vi.mocked(fs.readFile).mockRejectedValueOnce(new Error('File not found'));

      await expect(
        loadMultiRequestFlow('/path/to/nonexistent.json')
      ).rejects.toThrow('Failed to read multi-request flow file');
    });

    it('throws error when JSON is invalid', async () => {
      vi.mocked(fs.readFile).mockResolvedValueOnce(
        'invalid json content' as any
      );

      await expect(loadMultiRequestFlow('/path/to/flow.json')).rejects.toThrow(
        'Failed to parse multi-request flow JSON'
      );
    });

    it('throws error when flow is not an object', async () => {
      vi.mocked(fs.readFile).mockResolvedValueOnce('null' as any);

      await expect(loadMultiRequestFlow('/path/to/flow.json')).rejects.toThrow(
        'Multi-request flow must be a JSON object'
      );
    });

    it('throws error when requests array is missing', async () => {
      const invalidFlow = {};

      vi.mocked(fs.readFile).mockResolvedValueOnce(
        JSON.stringify(invalidFlow) as any
      );

      await expect(loadMultiRequestFlow('/path/to/flow.json')).rejects.toThrow(
        'Required'
      );
    });

    it('throws error when requests is not an array', async () => {
      const invalidFlow = {
        requests: 'not-an-array',
      };

      vi.mocked(fs.readFile).mockResolvedValueOnce(
        JSON.stringify(invalidFlow) as any
      );

      await expect(loadMultiRequestFlow('/path/to/flow.json')).rejects.toThrow(
        'Expected array'
      );
    });

    it('throws error when requests array is empty', async () => {
      const invalidFlow = {
        requests: [],
      };

      vi.mocked(fs.readFile).mockResolvedValueOnce(
        JSON.stringify(invalidFlow) as any
      );

      await expect(loadMultiRequestFlow('/path/to/flow.json')).rejects.toThrow(
        'Multi-request flow must have at least one request'
      );
    });

    it('throws error when request key is missing', async () => {
      const invalidFlow = {
        requests: [
          {
            request: {
              method: 'GET',
              url: 'https://example.com/api',
            },
          },
        ],
      };

      vi.mocked(fs.readFile).mockResolvedValueOnce(
        JSON.stringify(invalidFlow) as any
      );

      await expect(loadMultiRequestFlow('/path/to/flow.json')).rejects.toThrow(
        'Required'
      );
    });

    it('throws error when request keys are duplicated', async () => {
      const invalidFlow = {
        requests: [
          {
            key: 'DuplicateKey',
            request: {
              method: 'GET',
              url: 'https://example.com/api1',
            },
          },
          {
            key: 'DuplicateKey',
            request: {
              method: 'GET',
              url: 'https://example.com/api2',
            },
          },
        ],
      };

      vi.mocked(fs.readFile).mockResolvedValueOnce(
        JSON.stringify(invalidFlow) as any
      );

      await expect(loadMultiRequestFlow('/path/to/flow.json')).rejects.toThrow(
        'Duplicate request key: "DuplicateKey"'
      );
    });

    it('throws error when HTTP method is invalid', async () => {
      const invalidFlow = {
        requests: [
          {
            key: 'InvalidMethod',
            request: {
              method: 'DELETE',
              url: 'https://example.com/api',
            },
          },
        ],
      };

      vi.mocked(fs.readFile).mockResolvedValueOnce(
        JSON.stringify(invalidFlow) as any
      );

      await expect(loadMultiRequestFlow('/path/to/flow.json')).rejects.toThrow(
        'Invalid enum value'
      );
    });

    it('throws error when URL is missing', async () => {
      const invalidFlow = {
        requests: [
          {
            key: 'NoUrl',
            request: {
              method: 'GET',
            },
          },
        ],
      };

      vi.mocked(fs.readFile).mockResolvedValueOnce(
        JSON.stringify(invalidFlow) as any
      );

      await expect(loadMultiRequestFlow('/path/to/flow.json')).rejects.toThrow(
        'Required'
      );
    });

    it('throws error when URL does not start with http/https', async () => {
      const invalidFlow = {
        requests: [
          {
            key: 'InvalidUrl',
            request: {
              method: 'GET',
              url: 'ftp://example.com/api',
            },
          },
        ],
      };

      vi.mocked(fs.readFile).mockResolvedValueOnce(
        JSON.stringify(invalidFlow) as any
      );

      await expect(loadMultiRequestFlow('/path/to/flow.json')).rejects.toThrow(
        'URL must start with http:// or https://'
      );
    });

    it('throws error when GET request has body', async () => {
      const invalidFlow = {
        requests: [
          {
            key: 'GetWithBody',
            request: {
              method: 'GET',
              url: 'https://example.com/api',
              body: 'invalid',
            },
          },
        ],
      };

      vi.mocked(fs.readFile).mockResolvedValueOnce(
        JSON.stringify(invalidFlow) as any
      );

      await expect(loadMultiRequestFlow('/path/to/flow.json')).rejects.toThrow(
        'GET requests cannot have body or json fields'
      );
    });

    it('throws error when GET request has json', async () => {
      const invalidFlow = {
        requests: [
          {
            key: 'GetWithJson',
            request: {
              method: 'GET',
              url: 'https://example.com/api',
              json: {},
            },
          },
        ],
      };

      vi.mocked(fs.readFile).mockResolvedValueOnce(
        JSON.stringify(invalidFlow) as any
      );

      await expect(loadMultiRequestFlow('/path/to/flow.json')).rejects.toThrow(
        'GET requests cannot have body or json fields'
      );
    });

    it('accepts GET request with headers (for authentication, content negotiation, etc.)', async () => {
      const validFlow = {
        requests: [
          {
            key: 'GetWithHeaders',
            request: {
              method: 'GET',
              url: 'https://example.com/api',
              headers: {
                'Authorization': 'Bearer token123',
                'Accept': 'application/json',
              },
            },
          },
        ],
      };

      vi.mocked(fs.readFile).mockResolvedValueOnce(
        JSON.stringify(validFlow) as any
      );

      const flow = await loadMultiRequestFlow('/path/to/flow.json');
      expect(flow.requests[0].request.headers).toEqual({
        'Authorization': 'Bearer token123',
        'Accept': 'application/json',
      });
    });

    it('throws error when json field is used without content-type header', async () => {
      const invalidFlow = {
        requests: [
          {
            key: 'JsonWithoutContentType',
            request: {
              method: 'POST',
              url: 'https://example.com/api',
              json: {},
            },
          },
        ],
      };

      vi.mocked(fs.readFile).mockResolvedValueOnce(
        JSON.stringify(invalidFlow) as any
      );

      await expect(loadMultiRequestFlow('/path/to/flow.json')).rejects.toThrow(
        'json body requires content-type: application/json'
      );
    });

    it('throws error when json field is used with non-json content-type', async () => {
      const invalidFlow = {
        requests: [
          {
            key: 'JsonWithWrongContentType',
            request: {
              method: 'POST',
              url: 'https://example.com/api',
              headers: {
                'content-type': 'text/xml',
              },
              json: {},
            },
          },
        ],
      };

      vi.mocked(fs.readFile).mockResolvedValueOnce(
        JSON.stringify(invalidFlow) as any
      );

      await expect(loadMultiRequestFlow('/path/to/flow.json')).rejects.toThrow(
        'json body requires content-type: application/json'
      );
    });

    it('throws error when body field is used without content-type header', async () => {
      const invalidFlow = {
        requests: [
          {
            key: 'BodyWithoutContentType',
            request: {
              method: 'POST',
              url: 'https://example.com/api',
              body: 'data',
            },
          },
        ],
      };

      vi.mocked(fs.readFile).mockResolvedValueOnce(
        JSON.stringify(invalidFlow) as any
      );

      await expect(loadMultiRequestFlow('/path/to/flow.json')).rejects.toThrow(
        'body field requires content-type header to be set'
      );
    });

    it('throws error when body field is used with json content-type', async () => {
      const invalidFlow = {
        requests: [
          {
            key: 'BodyWithJsonContentType',
            request: {
              method: 'POST',
              url: 'https://example.com/api',
              headers: {
                'content-type': 'application/json',
              },
              body: 'data',
            },
          },
        ],
      };

      vi.mocked(fs.readFile).mockResolvedValueOnce(
        JSON.stringify(invalidFlow) as any
      );

      await expect(loadMultiRequestFlow('/path/to/flow.json')).rejects.toThrow(
        'body field requires content-type header to be set (and not application/json)'
      );
    });

    it('throws error when both json and body fields are present', async () => {
      const invalidFlow = {
        requests: [
          {
            key: 'BothJsonAndBody',
            request: {
              method: 'POST',
              url: 'https://example.com/api',
              headers: {
                'content-type': 'application/json',
              },
              json: {},
              body: 'data',
            },
          },
        ],
      };

      vi.mocked(fs.readFile).mockResolvedValueOnce(
        JSON.stringify(invalidFlow) as any
      );

      await expect(loadMultiRequestFlow('/path/to/flow.json')).rejects.toThrow(
        'Cannot have both json and body fields'
      );
    });

    it('throws error when POST with json content-type missing json field', async () => {
      const invalidFlow = {
        requests: [
          {
            key: 'PostJsonMissingField',
            request: {
              method: 'POST',
              url: 'https://example.com/api',
              headers: {
                'content-type': 'application/json',
              },
            },
          },
        ],
      };

      vi.mocked(fs.readFile).mockResolvedValueOnce(
        JSON.stringify(invalidFlow) as any
      );

      await expect(loadMultiRequestFlow('/path/to/flow.json')).rejects.toThrow(
        'POST/PUT/PATCH with content-type: application/json requires json field'
      );
    });

    it('throws error when POST with non-json content-type missing body field', async () => {
      const invalidFlow = {
        requests: [
          {
            key: 'PostBodyMissingField',
            request: {
              method: 'POST',
              url: 'https://example.com/api',
              headers: {
                'content-type': 'application/x-www-form-urlencoded',
              },
            },
          },
        ],
      };

      vi.mocked(fs.readFile).mockResolvedValueOnce(
        JSON.stringify(invalidFlow) as any
      );

      await expect(loadMultiRequestFlow('/path/to/flow.json')).rejects.toThrow(
        'POST/PUT/PATCH with non-json content-type requires body field'
      );
    });

    it('accepts valid POST request with json', async () => {
      const validFlow = {
        requests: [
          {
            key: 'ValidPostJson',
            request: {
              method: 'POST',
              url: 'https://example.com/api',
              headers: {
                'content-type': 'application/json',
              },
              json: {
                data: 'test',
              },
            },
          },
        ],
      };

      vi.mocked(fs.readFile).mockResolvedValueOnce(
        JSON.stringify(validFlow) as any
      );

      const result = await loadMultiRequestFlow('/path/to/flow.json');

      expect(result).toEqual(validFlow);
    });

    it('accepts valid POST request with body', async () => {
      const validFlow = {
        requests: [
          {
            key: 'ValidPostBody',
            request: {
              method: 'POST',
              url: 'https://example.com/api',
              headers: {
                'content-type': 'application/x-www-form-urlencoded',
              },
              body: 'data=test',
            },
          },
        ],
      };

      vi.mocked(fs.readFile).mockResolvedValueOnce(
        JSON.stringify(validFlow) as any
      );

      const result = await loadMultiRequestFlow('/path/to/flow.json');

      expect(result).toEqual(validFlow);
    });

    it('accepts valid PUT and PATCH requests', async () => {
      const validFlow = {
        requests: [
          {
            key: 'ValidPut',
            request: {
              method: 'PUT',
              url: 'https://example.com/api',
              headers: {
                'content-type': 'application/json',
              },
              json: {},
            },
          },
          {
            key: 'ValidPatch',
            request: {
              method: 'PATCH',
              url: 'https://example.com/api',
              headers: {
                'content-type': 'text/xml',
              },
              body: '<data/>',
            },
          },
        ],
      };

      vi.mocked(fs.readFile).mockResolvedValueOnce(
        JSON.stringify(validFlow) as any
      );

      const result = await loadMultiRequestFlow('/path/to/flow.json');

      expect(result).toEqual(validFlow);
    });

    it('accepts valid request with multiValueQueryString', async () => {
      const validFlow = {
        requests: [
          {
            key: 'WithQueryString',
            request: {
              method: 'GET',
              url: 'https://example.com/api',
              multiValueQueryString: {
                param: ['value1', 'value2'],
              },
            },
          },
        ],
      };

      vi.mocked(fs.readFile).mockResolvedValueOnce(
        JSON.stringify(validFlow) as any
      );

      const result = await loadMultiRequestFlow('/path/to/flow.json');

      expect(result).toEqual(validFlow);
    });

    it('accepts valid content-type with explicit value', async () => {
      const validFlow = {
        requests: [
          {
            key: 'ExplicitContentType',
            request: {
              method: 'POST',
              url: 'https://example.com/api',
              headers: {
                'content-type': 'text/xml',
              },
              body: '<data/>',
            },
          },
        ],
      };

      vi.mocked(fs.readFile).mockResolvedValueOnce(
        JSON.stringify(validFlow) as any
      );

      const result = await loadMultiRequestFlow('/path/to/flow.json');

      expect(result).toEqual(validFlow);
    });

    it('throws error for invalid content-type', async () => {
      const invalidFlow = {
        requests: [
          {
            key: 'InvalidContentType',
            request: {
              method: 'POST',
              url: 'https://example.com/api',
              headers: {
                'content-type': 'invalid/type',
              },
              body: 'data',
            },
          },
        ],
      };

      vi.mocked(fs.readFile).mockResolvedValueOnce(
        JSON.stringify(invalidFlow) as any
      );

      await expect(loadMultiRequestFlow('/path/to/flow.json')).rejects.toThrow(
        'Invalid enum value'
      );
    });
  });
});
