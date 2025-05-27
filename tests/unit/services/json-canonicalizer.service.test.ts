import { describe, it, expect } from 'vitest';
import { JsonCanonicalizerService } from '../../../src/services/json-canonicalizer.service';

describe('JsonCanonicalizerService', () => {
  const service = new JsonCanonicalizerService();

  describe('canonicalize', () => {
    it('should canonicalize simple object', () => {
      const obj = { b: 1, a: 'hello' };
      expect(service.canonicalize(obj)).toBe('{"a":"hello","b":1}');
    });

    it('should canonicalize nested objects', () => {
      const obj = { c: { y: 2, x: 1 }, a: 'foo' };
      expect(service.canonicalize(obj)).toBe('{"a":"foo","c":{"x":1,"y":2}}');
    });

    it('should handle arrays', () => {
      const obj = { arr: [3, 2, 1] }; // Arrays are not reordered
      expect(service.canonicalize(obj)).toBe('{"arr":[3,2,1]}');
    });

    it('should handle null values', () => {
      const obj = { key: null };
      expect(service.canonicalize(obj)).toBe('{"key":null}');
    });

    it('should handle boolean values', () => {
      const obj = { t: true, f: false };
      expect(service.canonicalize(obj)).toBe('{"f":false,"t":true}');
    });

    it('should handle numbers correctly', () => {
      const obj = { num: 123.45, int: 0 };
      expect(service.canonicalize(obj)).toBe('{"int":0,"num":123.45}');
    });

    it('should handle strings with special characters', () => {
      const obj = { str: 'a"b\\c\n\r\t\f\b' };
      // json-canonicalize escapes these as per JSON spec
      expect(service.canonicalize(obj)).toBe('{"str":"a\\"b\\\\c\\n\\r\\t\\f\\b"}');
    });

    it('should handle empty object', () => {
      expect(service.canonicalize({})).toBe('{}');
    });

    it('should handle empty array', () => {
      expect(service.canonicalize([])).toBe('[]');
    });

    it('should throw error for undefined', () => {
      expect(() => service.canonicalize(undefined)).toThrow(
        'Failed to canonicalize JSON: Cannot canonicalize undefined'
      );
    });

    it('should throw error for functions', () => {
      const func = () => console.log('test');
      expect(() => service.canonicalize(func)).toThrow(
        'Failed to canonicalize JSON: Cannot canonicalize functions'
      );
    });

    it('should handle complex nested structures', () => {
      const obj = {
        z: 'last',
        a: [1, { sub_b: 'sub_val_b', sub_a: 'sub_val_a' }, 3],
        b: { inner_c: null, inner_a: true },
      };
      const expected =
        '{"a":[1,{"sub_a":"sub_val_a","sub_b":"sub_val_b"},3],"b":{"inner_a":true,"inner_c":null},"z":"last"}';
      expect(service.canonicalize(obj)).toBe(expected);
    });

    it('should handle BigInt by converting to string via JSON.stringify behavior', () => {
      // The 'json-canonicalize' library relies on standard JSON behavior.
      // JSON.stringify throws for BigInt, so the library might too, or handle it specifically.
      // The library's behavior is to throw "Do not know how to serialize a BigInt"
      const obj = { big: BigInt(123) };
      expect(() => service.canonicalize(obj)).toThrow(
         'Failed to canonicalize JSON: Do not know how to serialize a BigInt'
      );
    });

    it('should handle various primitive types directly', () => {
      expect(service.canonicalize(123)).toBe('123');
      expect(service.canonicalize("string")).toBe('"string"');
      expect(service.canonicalize(true)).toBe('true');
      expect(service.canonicalize(null)).toBe('null');
    });
  });

  describe('canonicalizeToBuffer', () => {
    it('should convert canonical JSON to Buffer', () => {
      const obj = { b: 1, a: 'hello' };
      const buffer = service.canonicalizeToBuffer(obj);
      expect(Buffer.isBuffer(buffer)).toBe(true);
      expect(buffer.toString('utf-8')).toBe('{"a":"hello","b":1}');
    });
  });

  describe('parseAndCanonicalize', () => {
    it('should parse and canonicalize valid JSON string', () => {
      const jsonString = '{"b": 1, "a": "hello"}';
      expect(service.parseAndCanonicalize(jsonString)).toBe('{"a":"hello","b":1}');
    });

    it('should throw for invalid JSON string', () => {
      const invalidJsonString = '{"b": 1, "a": "hello"'; // Missing closing brace
      expect(() => service.parseAndCanonicalize(invalidJsonString)).toThrow(
        'Failed to parse or canonicalize JSON string: Unexpected end of JSON input'
      );
    });
  });

  describe('canonicalizeBatch', async () => {
    it('should canonicalize an array of JSON objects', async () => {
      const arr = [{ b: 1, a: 2 }, { d: 3, c: 4 }];
      const expected = ['{"a":2,"b":1}', '{"c":4,"d":3}'];
      const results = await service.canonicalizeBatch(arr);
      expect(results).toEqual(expected);
    });

    it('should handle empty array for batch', async () => {
        const results = await service.canonicalizeBatch([]);
        expect(results).toEqual([]);
    });
  });

  describe('isCanonical', () => {
    it('should return true for canonical JSON string', () => {
      expect(service.isCanonical('{"a":1,"b":2}')).toBe(true);
    });

    it('should return false for non-canonical JSON string', () => {
      expect(service.isCanonical('{"b":2,"a":1}')).toBe(false);
    });

    it('should return false for invalid JSON string', () => {
      expect(service.isCanonical('{"a:1}')).toBe(false);
    });
  });

  describe('areEquivalent', () => {
    it('should return true for equivalent JSON objects', () => {
      expect(service.areEquivalent({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
    });

    it('should return false for non-equivalent JSON objects', () => {
      expect(service.areEquivalent({ a: 1, b: 2 }, { a: 1, b: 3 })).toBe(false);
    });

     it('should return false if one object causes canonicalization error', () => {
      expect(service.areEquivalent({ a: 1 }, () => {})).toBe(false);
    });
  });
});