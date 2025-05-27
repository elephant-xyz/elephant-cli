import { describe, it, expect, beforeEach } from 'vitest';
import { JsonCanonicalizerService } from '../../../src/services/json-canonicalizer.service';

describe('JsonCanonicalizerService', () => {
  let jsonCanonicalizer: JsonCanonicalizerService;

  beforeEach(() => {
    jsonCanonicalizer = new JsonCanonicalizerService();
  });

  describe('canonicalize', () => {
    it('should canonicalize simple object', () => {
      const input = { b: 2, a: 1 };
      const result = jsonCanonicalizer.canonicalize(input);

      // RFC 8785 specifies lexicographic ordering of keys
      expect(result).toBe('{"a":1,"b":2}');
    });

    it('should canonicalize nested objects', () => {
      const input = {
        outer: {
          b: 2,
          a: 1
        },
        first: true
      };
      const result = jsonCanonicalizer.canonicalize(input);

      expect(result).toBe('{"first":true,"outer":{"a":1,"b":2}}');
    });

    it('should handle arrays', () => {
      const input = { array: [3, 1, 2] };
      const result = jsonCanonicalizer.canonicalize(input);

      // Arrays maintain their order
      expect(result).toBe('{"array":[3,1,2]}');
    });

    it('should handle null values', () => {
      const input = { value: null };
      const result = jsonCanonicalizer.canonicalize(input);

      expect(result).toBe('{"value":null}');
    });

    it('should handle boolean values', () => {
      const input = { isTrue: true, isFalse: false };
      const result = jsonCanonicalizer.canonicalize(input);

      expect(result).toBe('{"isFalse":false,"isTrue":true}');
    });

    it('should handle numbers correctly', () => {
      const input = {
        integer: 42,
        negative: -17,
        decimal: 3.14,
        zero: 0,
        scientific: 1.23e-4
      };
      const result = jsonCanonicalizer.canonicalize(input);

      expect(result).toContain('"integer":42');
      expect(result).toContain('"negative":-17');
      expect(result).toContain('"decimal":3.14');
      expect(result).toContain('"zero":0');
    });

    it('should handle strings with special characters', () => {
      const input = {
        normal: "hello",
        escaped: "line1\nline2",
        unicode: "测试",
        quotes: 'He said "hello"'
      };
      const result = jsonCanonicalizer.canonicalize(input);

      expect(result).toContain('"normal":"hello"');
      expect(result).toContain('"escaped":"line1\\nline2"');
      expect(result).toContain('"unicode":"测试"');
      expect(result).toContain('"quotes":"He said \\"hello\\""');
    });

    it('should handle empty object', () => {
      const result = jsonCanonicalizer.canonicalize({});
      expect(result).toBe('{}');
    });

    it('should handle empty array', () => {
      const input = { empty: [] };
      const result = jsonCanonicalizer.canonicalize(input);
      expect(result).toBe('{"empty":[]}');
    });

    it('should throw error for undefined', () => {
      expect(() => jsonCanonicalizer.canonicalize(undefined)).toThrow('Failed to canonicalize JSON');
    });

    it('should throw error for functions', () => {
      const input = { func: () => {} };
      expect(() => jsonCanonicalizer.canonicalize(input)).toThrow('Failed to canonicalize JSON');
    });

    it('should handle deeply nested structures', () => {
      const input = {
        level1: {
          level2: {
            level3: {
              level4: {
                value: "deep"
              }
            }
          }
        }
      };
      const result = jsonCanonicalizer.canonicalize(input);

      expect(result).toBe('{"level1":{"level2":{"level3":{"level4":{"value":"deep"}}}}}');
    });
  });

  describe('canonicalizeToBuffer', () => {
    it('should return Buffer with canonical JSON', () => {
      const input = { b: 2, a: 1 };
      const buffer = jsonCanonicalizer.canonicalizeToBuffer(input);

      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.toString('utf-8')).toBe('{"a":1,"b":2}');
    });

    it('should handle UTF-8 encoding correctly', () => {
      const input = { text: "Hello 世界 🌍" };
      const buffer = jsonCanonicalizer.canonicalizeToBuffer(input);

      const decoded = buffer.toString('utf-8');
      expect(decoded).toContain('"text":"Hello 世界 🌍"');
    });
  });

  describe('parseAndCanonicalize', () => {
    it('should parse and canonicalize valid JSON string', () => {
      const jsonString = '{"b": 2, "a": 1}';
      const result = jsonCanonicalizer.parseAndCanonicalize(jsonString);

      expect(result).toBe('{"a":1,"b":2}');
    });

    it('should handle JSON with extra whitespace', () => {
      const jsonString = `{
        "b": 2,
        "a": 1
      }`;
      const result = jsonCanonicalizer.parseAndCanonicalize(jsonString);

      expect(result).toBe('{"a":1,"b":2}');
    });

    it('should throw error for invalid JSON', () => {
      const invalidJson = '{"a": 1, invalid}';
      
      expect(() => jsonCanonicalizer.parseAndCanonicalize(invalidJson))
        .toThrow('Failed to parse or canonicalize JSON string');
    });

    it('should throw error for non-JSON input', () => {
      expect(() => jsonCanonicalizer.parseAndCanonicalize('not json'))
        .toThrow('Failed to parse or canonicalize JSON string');
    });
  });

  describe('canonicalizeBatch', () => {
    it('should canonicalize multiple JSON objects', async () => {
      const batch = [
        { b: 2, a: 1 },
        { d: 4, c: 3 },
        { f: 6, e: 5 }
      ];

      const results = await jsonCanonicalizer.canonicalizeBatch(batch);

      expect(results).toHaveLength(3);
      expect(results[0]).toBe('{"a":1,"b":2}');
      expect(results[1]).toBe('{"c":3,"d":4}');
      expect(results[2]).toBe('{"e":5,"f":6}');
    });

    it('should handle empty batch', async () => {
      const results = await jsonCanonicalizer.canonicalizeBatch([]);
      expect(results).toEqual([]);
    });

    it('should handle batch with one item', async () => {
      const results = await jsonCanonicalizer.canonicalizeBatch([{ test: true }]);
      
      expect(results).toHaveLength(1);
      expect(results[0]).toBe('{"test":true}');
    });

    it('should maintain order in batch results', async () => {
      const batch = [
        { id: 1 },
        { id: 2 },
        { id: 3 }
      ];

      const results = await jsonCanonicalizer.canonicalizeBatch(batch);

      expect(results[0]).toBe('{"id":1}');
      expect(results[1]).toBe('{"id":2}');
      expect(results[2]).toBe('{"id":3}');
    });
  });

  describe('isCanonical', () => {
    it('should return true for canonical JSON', () => {
      const canonical = '{"a":1,"b":2}';
      expect(jsonCanonicalizer.isCanonical(canonical)).toBe(true);
    });

    it('should return false for non-canonical JSON', () => {
      const nonCanonical = '{"b":2,"a":1}';
      expect(jsonCanonicalizer.isCanonical(nonCanonical)).toBe(false);
    });

    it('should return false for JSON with whitespace', () => {
      const withWhitespace = '{ "a": 1, "b": 2 }';
      expect(jsonCanonicalizer.isCanonical(withWhitespace)).toBe(false);
    });

    it('should return false for invalid JSON', () => {
      expect(jsonCanonicalizer.isCanonical('not json')).toBe(false);
    });

    it('should handle edge cases', () => {
      expect(jsonCanonicalizer.isCanonical('null')).toBe(true);
      expect(jsonCanonicalizer.isCanonical('true')).toBe(true);
      expect(jsonCanonicalizer.isCanonical('false')).toBe(true);
      expect(jsonCanonicalizer.isCanonical('42')).toBe(true);
      expect(jsonCanonicalizer.isCanonical('"string"')).toBe(true);
    });
  });

  describe('areEquivalent', () => {
    it('should return true for equivalent objects with different key order', () => {
      const obj1 = { b: 2, a: 1 };
      const obj2 = { a: 1, b: 2 };

      expect(jsonCanonicalizer.areEquivalent(obj1, obj2)).toBe(true);
    });

    it('should return true for deeply nested equivalent objects', () => {
      const obj1 = {
        outer: { b: 2, a: 1 },
        array: [1, 2, 3]
      };
      const obj2 = {
        array: [1, 2, 3],
        outer: { a: 1, b: 2 }
      };

      expect(jsonCanonicalizer.areEquivalent(obj1, obj2)).toBe(true);
    });

    it('should return false for different objects', () => {
      const obj1 = { a: 1 };
      const obj2 = { a: 2 };

      expect(jsonCanonicalizer.areEquivalent(obj1, obj2)).toBe(false);
    });

    it('should return false for objects with different keys', () => {
      const obj1 = { a: 1 };
      const obj2 = { b: 1 };

      expect(jsonCanonicalizer.areEquivalent(obj1, obj2)).toBe(false);
    });

    it('should handle array order sensitivity', () => {
      const obj1 = { array: [1, 2, 3] };
      const obj2 = { array: [3, 2, 1] };

      // Arrays are order-sensitive
      expect(jsonCanonicalizer.areEquivalent(obj1, obj2)).toBe(false);
    });

    it('should handle null and undefined', () => {
      expect(jsonCanonicalizer.areEquivalent(null, null)).toBe(true);
      expect(jsonCanonicalizer.areEquivalent(null, undefined)).toBe(false);
      expect(jsonCanonicalizer.areEquivalent({}, null)).toBe(false);
    });

    it('should handle invalid inputs gracefully', () => {
      const circular: any = { a: 1 };
      circular.self = circular;

      expect(jsonCanonicalizer.areEquivalent(circular, { a: 1 })).toBe(false);
    });
  });

  describe('RFC 8785 compliance', () => {
    it('should order object keys lexicographically', () => {
      const input = { "z": 1, "a": 2, "m": 3 };
      const result = jsonCanonicalizer.canonicalize(input);
      
      expect(result).toBe('{"a":2,"m":3,"z":1}');
    });

    it('should handle Unicode ordering correctly', () => {
      const input = { "ä": 1, "a": 2, "z": 3 };
      const result = jsonCanonicalizer.canonicalize(input);
      
      // Unicode characters should be ordered by their code points
      const keys = Object.keys(JSON.parse(result));
      expect(keys[0]).toBe('a');
      expect(keys[1]).toBe('z');
      expect(keys[2]).toBe('ä');
    });

    it('should not add or remove whitespace in strings', () => {
      const input = { text: "  spaces  " };
      const result = jsonCanonicalizer.canonicalize(input);
      
      expect(result).toBe('{"text":"  spaces  "}');
    });
  });
});