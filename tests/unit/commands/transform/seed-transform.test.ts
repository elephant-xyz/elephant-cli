import { describe, it, expect } from 'vitest';
import { parseMultiValueQueryString } from '../../../../src/commands/transform/sourceHttpRequest.js';

describe('parseMultiValueQueryString', () => {
  it('should handle valid JSON', () => {
    const result = parseMultiValueQueryString('{"key":"value"}');
    expect(result).toEqual({ key: 'value' });
  });

  it('should handle empty object', () => {
    const result = parseMultiValueQueryString('{}');
    expect(result).toEqual({});
  });

  it('should throw error for invalid JSON', () => {
    expect(() => parseMultiValueQueryString('{invalid json}')).toThrow();
  });

  it('should handle single-quoted strings', () => {
    const result = parseMultiValueQueryString(
      '{"key":"value","key2":"value2","key3":"\'value3\'"}'
    );
    expect(result).toEqual({ key: 'value', key2: 'value2', key3: "'value3'" });
  });

  it('should handle double-quoted strings', () => {
    const result = parseMultiValueQueryString(
      '{"key":"value","key2":"value2","key3":"\\"value3\\""}'
    );
    expect(result).toEqual({ key: 'value', key2: 'value2', key3: '"value3"' });
  });

  it('should handle escaped single quotes', () => {
    const result = parseMultiValueQueryString(
      '{"key":"value","key2":"value2","key3":"\'value3\'"}'
    );
    expect(result).toEqual({ key: 'value', key2: 'value2', key3: "'value3'" });
  });
});
