import { describe, it, expect } from 'vitest';
import {
  replaceInString,
  replaceInValue,
  replaceInMultiValueQueryString,
  replaceInHeaders,
  replaceTemplateVariables,
} from '../../../../src/lib/multi-request-flow/template.js';
import { HttpRequestDefinition } from '../../../../src/lib/multi-request-flow/types.js';

describe('multi-request-flow/template', () => {
  const testRequestId = '583207459';

  describe('replaceInString', () => {
    it('replaces single occurrence of {{=it.request_identifier}}', () => {
      const template = 'https://example.com/api?id={{=it.request_identifier}}';
      const result = replaceInString(template, testRequestId);
      expect(result).toBe('https://example.com/api?id=583207459');
    });

    it('replaces multiple occurrences of {{=it.request_identifier}}', () => {
      const template =
        '{{=it.request_identifier}}-test-{{=it.request_identifier}}';
      const result = replaceInString(template, testRequestId);
      expect(result).toBe('583207459-test-583207459');
    });

    it('returns unchanged string when no template variable present', () => {
      const template = 'https://example.com/api?id=123';
      const result = replaceInString(template, testRequestId);
      expect(result).toBe('https://example.com/api?id=123');
    });

    it('handles empty string', () => {
      const template = '';
      const result = replaceInString(template, testRequestId);
      expect(result).toBe('');
    });
  });

  describe('replaceInValue', () => {
    it('replaces template in string value', () => {
      const value = 'parid={{=it.request_identifier}}';
      const result = replaceInValue(value, testRequestId);
      expect(result).toBe('parid=583207459');
    });

    it('replaces template in nested object', () => {
      const value = {
        parid: '{{=it.request_identifier}}',
        ownerType: '',
        nested: {
          id: '{{=it.request_identifier}}',
        },
      };
      const result = replaceInValue(value, testRequestId);
      expect(result).toEqual({
        parid: '583207459',
        ownerType: '',
        nested: {
          id: '583207459',
        },
      });
    });

    it('replaces template in array', () => {
      const value = [
        '{{=it.request_identifier}}',
        'test',
        '{{=it.request_identifier}}-suffix',
      ];
      const result = replaceInValue(value, testRequestId);
      expect(result).toEqual(['583207459', 'test', '583207459-suffix']);
    });

    it('replaces template in nested arrays', () => {
      const value = [
        ['{{=it.request_identifier}}', 'a'],
        ['b', '{{=it.request_identifier}}'],
      ];
      const result = replaceInValue(value, testRequestId);
      expect(result).toEqual([
        ['583207459', 'a'],
        ['b', '583207459'],
      ]);
    });

    it('handles primitive values without modification', () => {
      expect(replaceInValue(123, testRequestId)).toBe(123);
      expect(replaceInValue(true, testRequestId)).toBe(true);
      expect(replaceInValue(null, testRequestId)).toBe(null);
      expect(replaceInValue(undefined, testRequestId)).toBe(undefined);
    });

    it('handles complex nested structure', () => {
      const value = {
        data: {
          items: [
            { id: '{{=it.request_identifier}}', name: 'test' },
            { id: 'other', ref: '{{=it.request_identifier}}' },
          ],
        },
        metadata: {
          source: 'https://example.com/{{=it.request_identifier}}',
        },
      };
      const result = replaceInValue(value, testRequestId);
      expect(result).toEqual({
        data: {
          items: [
            { id: '583207459', name: 'test' },
            { id: 'other', ref: '583207459' },
          ],
        },
        metadata: {
          source: 'https://example.com/583207459',
        },
      });
    });
  });

  describe('replaceInMultiValueQueryString', () => {
    it('replaces template in query string values', () => {
      const mvqs = {
        parid: ['{{=it.request_identifier}}'],
        type: ['real_property'],
      };
      const result = replaceInMultiValueQueryString(mvqs, testRequestId);
      expect(result).toEqual({
        parid: ['583207459'],
        type: ['real_property'],
      });
    });

    it('replaces template in multiple values', () => {
      const mvqs = {
        ids: ['{{=it.request_identifier}}', 'other-{{=it.request_identifier}}'],
        status: ['active'],
      };
      const result = replaceInMultiValueQueryString(mvqs, testRequestId);
      expect(result).toEqual({
        ids: ['583207459', 'other-583207459'],
        status: ['active'],
      });
    });

    it('handles empty query string object', () => {
      const mvqs = {};
      const result = replaceInMultiValueQueryString(mvqs, testRequestId);
      expect(result).toEqual({});
    });
  });

  describe('replaceInHeaders', () => {
    it('replaces template in header values', () => {
      const headers = {
        'content-type': 'application/json',
        'x-request-id': '{{=it.request_identifier}}',
      };
      const result = replaceInHeaders(headers, testRequestId);
      expect(result).toEqual({
        'content-type': 'application/json',
        'x-request-id': '583207459',
      });
    });

    it('preserves null and undefined values', () => {
      const headers = {
        'content-type': 'application/json',
        'x-optional': null,
        'x-undefined': undefined,
      };
      const result = replaceInHeaders(headers, testRequestId);
      expect(result).toEqual({
        'content-type': 'application/json',
        'x-optional': null,
        'x-undefined': undefined,
      });
    });

    it('handles empty headers object', () => {
      const headers = {};
      const result = replaceInHeaders(headers, testRequestId);
      expect(result).toEqual({});
    });
  });

  describe('replaceTemplateVariables', () => {
    it('replaces template in GET request URL', () => {
      const request: HttpRequestDefinition = {
        method: 'GET',
        url: 'https://example.com/api?pid={{=it.request_identifier}}',
      };
      const result = replaceTemplateVariables(request, testRequestId);
      expect(result).toEqual({
        method: 'GET',
        url: 'https://example.com/api?pid=583207459',
      });
    });

    it('replaces template in URL and multiValueQueryString', () => {
      const request: HttpRequestDefinition = {
        method: 'GET',
        url: 'https://example.com/api',
        multiValueQueryString: {
          pid: ['{{=it.request_identifier}}'],
          type: ['property'],
        },
      };
      const result = replaceTemplateVariables(request, testRequestId);
      expect(result).toEqual({
        method: 'GET',
        url: 'https://example.com/api',
        multiValueQueryString: {
          pid: ['583207459'],
          type: ['property'],
        },
      });
    });

    it('replaces template in POST request with JSON body', () => {
      const request: HttpRequestDefinition = {
        method: 'POST',
        url: 'https://example.com/api',
        headers: {
          'content-type': 'application/json',
        },
        json: {
          parid: '{{=it.request_identifier}}',
          ownerType: '',
          parcel_type: 'real_property',
        },
      };
      const result = replaceTemplateVariables(request, testRequestId);
      expect(result).toEqual({
        method: 'POST',
        url: 'https://example.com/api',
        headers: {
          'content-type': 'application/json',
        },
        json: {
          parid: '583207459',
          ownerType: '',
          parcel_type: 'real_property',
        },
      });
    });

    it('replaces template in POST request with string body', () => {
      const request: HttpRequestDefinition = {
        method: 'POST',
        url: 'https://example.com/api',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: 'data=%7B%22parid%22%3A%22{{=it.request_identifier}}%22%7D',
      };
      const result = replaceTemplateVariables(request, testRequestId);
      expect(result).toEqual({
        method: 'POST',
        url: 'https://example.com/api',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: 'data=%7B%22parid%22%3A%22583207459%22%7D',
      });
    });

    it('replaces template in headers', () => {
      const request: HttpRequestDefinition = {
        method: 'POST',
        url: 'https://example.com/api',
        headers: {
          'content-type': 'application/json',
          'x-parcel-id': '{{=it.request_identifier}}',
        },
        json: {},
      };
      const result = replaceTemplateVariables(request, testRequestId);
      expect(result).toEqual({
        method: 'POST',
        url: 'https://example.com/api',
        headers: {
          'content-type': 'application/json',
          'x-parcel-id': '583207459',
        },
        json: {},
      });
    });

    it('replaces template in all fields simultaneously', () => {
      const request: HttpRequestDefinition = {
        method: 'POST',
        url: 'https://example.com/{{=it.request_identifier}}/api',
        headers: {
          'content-type': 'application/json',
          'x-id': '{{=it.request_identifier}}',
        },
        multiValueQueryString: {
          ref: ['{{=it.request_identifier}}'],
        },
        json: {
          data: {
            id: '{{=it.request_identifier}}',
            nested: ['{{=it.request_identifier}}'],
          },
        },
      };
      const result = replaceTemplateVariables(request, testRequestId);
      expect(result).toEqual({
        method: 'POST',
        url: 'https://example.com/583207459/api',
        headers: {
          'content-type': 'application/json',
          'x-id': '583207459',
        },
        multiValueQueryString: {
          ref: ['583207459'],
        },
        json: {
          data: {
            id: '583207459',
            nested: ['583207459'],
          },
        },
      });
    });

    it('handles request without optional fields', () => {
      const request: HttpRequestDefinition = {
        method: 'GET',
        url: 'https://example.com/api',
      };
      const result = replaceTemplateVariables(request, testRequestId);
      expect(result).toEqual({
        method: 'GET',
        url: 'https://example.com/api',
      });
    });

    it('preserves request without template variables', () => {
      const request: HttpRequestDefinition = {
        method: 'POST',
        url: 'https://example.com/api',
        headers: {
          'content-type': 'application/json',
        },
        json: {
          static: 'value',
        },
      };
      const result = replaceTemplateVariables(request, testRequestId);
      expect(result).toEqual({
        method: 'POST',
        url: 'https://example.com/api',
        headers: {
          'content-type': 'application/json',
        },
        json: {
          static: 'value',
        },
      });
    });
  });
});
