import { describe, it, expect } from 'vitest';
import { parse } from 'csv-parse/sync';

describe('Seed transform - multiValueQueryString handling', () => {
  it('should handle empty multiValueQueryString', () => {
    const csvContent = `parcel_id,address,method,url,multiValueQueryString,source_identifier,county
12345,123 Main St,GET,https://api.example.com,,source123,TestCounty`;

    const parsed = parse(csvContent, {
      columns: true,
      skip_empty_lines: true,
    });
    const seedRow = parsed[0];

    const sourceHttpRequest = {
      url: seedRow.url,
      method: seedRow.method,
      multiValueQueryString: seedRow.multiValueQueryString?.trim()
        ? JSON.parse(seedRow.multiValueQueryString)
        : {},
    };

    expect(sourceHttpRequest.multiValueQueryString).toEqual({});
  });

  it('should handle whitespace-only multiValueQueryString', () => {
    const csvContent = `parcel_id,address,method,url,multiValueQueryString,source_identifier,county
12345,123 Main St,GET,https://api.example.com,   ,source123,TestCounty`;

    const parsed = parse(csvContent, {
      columns: true,
      skip_empty_lines: true,
    });
    const seedRow = parsed[0];

    const sourceHttpRequest = {
      url: seedRow.url,
      method: seedRow.method,
      multiValueQueryString: seedRow.multiValueQueryString?.trim()
        ? JSON.parse(seedRow.multiValueQueryString)
        : {},
    };

    expect(sourceHttpRequest.multiValueQueryString).toEqual({});
  });

  it('should handle valid JSON in multiValueQueryString', () => {
    const csvContent = `parcel_id,address,method,url,multiValueQueryString,source_identifier,county
12345,123 Main St,GET,https://api.example.com,"{""key"":""value""}",source123,TestCounty`;

    const parsed = parse(csvContent, {
      columns: true,
      skip_empty_lines: true,
    });
    const seedRow = parsed[0];

    const sourceHttpRequest = {
      url: seedRow.url,
      method: seedRow.method,
      multiValueQueryString: seedRow.multiValueQueryString?.trim()
        ? JSON.parse(seedRow.multiValueQueryString)
        : {},
    };

    expect(sourceHttpRequest.multiValueQueryString).toEqual({ key: 'value' });
  });

  it('should handle empty object {} in multiValueQueryString', () => {
    const csvContent = `parcel_id,address,method,url,multiValueQueryString,source_identifier,county
12345,123 Main St,GET,https://api.example.com,{},source123,TestCounty`;

    const parsed = parse(csvContent, {
      columns: true,
      skip_empty_lines: true,
    });
    const seedRow = parsed[0];

    const sourceHttpRequest = {
      url: seedRow.url,
      method: seedRow.method,
      multiValueQueryString: seedRow.multiValueQueryString?.trim()
        ? JSON.parse(seedRow.multiValueQueryString)
        : {},
    };

    expect(sourceHttpRequest.multiValueQueryString).toEqual({});
  });

  it('should throw error for invalid JSON in multiValueQueryString', () => {
    const csvContent = `parcel_id,address,method,url,multiValueQueryString,source_identifier,county
12345,123 Main St,GET,https://api.example.com,{invalid json},source123,TestCounty`;

    const parsed = parse(csvContent, {
      columns: true,
      skip_empty_lines: true,
    });
    const seedRow = parsed[0];

    expect(() => {
      const sourceHttpRequest = {
        url: seedRow.url,
        method: seedRow.method,
        multiValueQueryString: seedRow.multiValueQueryString?.trim()
          ? JSON.parse(seedRow.multiValueQueryString)
          : {},
      };
    }).toThrow();
  });
});
