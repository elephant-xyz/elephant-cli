import { describe, it, expect } from 'vitest';
import { extractLeafValues } from '../../src/utils/json-leaf-extractor.js';

describe('extractLeafValues', () => {
  it('should extract string values', () => {
    const obj = { name: 'John', city: 'Seattle' };
    const result = extractLeafValues(obj);

    expect(result).toContain('John');
    expect(result).toContain('Seattle');
    expect(result).toHaveLength(2);
  });

  it('should extract number values as strings', () => {
    const obj = { age: 30, price: 99.99 };
    const result = extractLeafValues(obj);

    expect(result).toContain('30');
    expect(result).toContain('99.99');
    expect(result).toHaveLength(2);
  });

  it('should handle nested objects', () => {
    const obj = {
      person: {
        name: 'Alice',
        address: {
          city: 'Boston',
          zip: '02101',
        },
      },
    };
    const result = extractLeafValues(obj);

    expect(result).toContain('Alice');
    expect(result).toContain('Boston');
    expect(result).toContain('02101');
    expect(result).toHaveLength(3);
  });

  it('should handle arrays', () => {
    const obj = {
      names: ['Bob', 'Carol', 'Dave'],
      numbers: [1, 2, 3],
    };
    const result = extractLeafValues(obj);

    expect(result).toContain('Bob');
    expect(result).toContain('Carol');
    expect(result).toContain('Dave');
    expect(result).toContain('1');
    expect(result).toContain('2');
    expect(result).toContain('3');
    expect(result).toHaveLength(6);
  });

  it('should skip null and undefined values', () => {
    const obj = { a: 'value', b: null, c: undefined, d: 'another' };
    const result = extractLeafValues(obj);

    expect(result).toContain('value');
    expect(result).toContain('another');
    expect(result).toHaveLength(2);
  });

  it('should skip boolean values', () => {
    const obj = { flag: true, name: 'Test', active: false };
    const result = extractLeafValues(obj);

    expect(result).toContain('Test');
    expect(result).toHaveLength(1);
  });

  it('should trim whitespace from strings', () => {
    const obj = { name: '  John  ', city: 'Seattle  ' };
    const result = extractLeafValues(obj);

    expect(result).toContain('John');
    expect(result).toContain('Seattle');
  });

  it('should skip empty strings', () => {
    const obj = { name: '', city: 'Seattle', description: '   ' };
    const result = extractLeafValues(obj);

    expect(result).toContain('Seattle');
    expect(result).toHaveLength(1);
  });

  it('should handle complex nested structure', () => {
    const obj = {
      datagroups: {
        property: {
          parcel: [
            { id: '123', owner: 'John Doe' },
            { id: '456', owner: 'Jane Smith' },
          ],
          company: [{ name: 'Acme Corp', revenue: 1000000 }],
        },
      },
    };
    const result = extractLeafValues(obj);

    expect(result).toContain('123');
    expect(result).toContain('456');
    expect(result).toContain('John Doe');
    expect(result).toContain('Jane Smith');
    expect(result).toContain('Acme Corp');
    expect(result).toContain('1000000');
    expect(result).toHaveLength(6);
  });

  it('should return empty array for null input', () => {
    const result = extractLeafValues(null);
    expect(result).toEqual([]);
  });

  it('should return empty array for undefined input', () => {
    const result = extractLeafValues(undefined);
    expect(result).toEqual([]);
  });

  it('should handle empty object', () => {
    const result = extractLeafValues({});
    expect(result).toEqual([]);
  });

  it('should handle empty array', () => {
    const result = extractLeafValues([]);
    expect(result).toEqual([]);
  });
});
