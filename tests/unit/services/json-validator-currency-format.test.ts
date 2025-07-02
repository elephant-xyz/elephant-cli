import { describe, it, expect, beforeEach, vi } from 'vitest';
import { JsonValidatorService } from '../../../src/services/json-validator.service';
import { JSONSchema } from '../../../src/services/schema-cache.service';
import { IPFSService } from '../../../src/services/ipfs.service';

describe('JsonValidatorService - Currency Format', () => {
  let jsonValidator: JsonValidatorService;
  let mockIPFSService: IPFSService;

  beforeEach(() => {
    // Create mock IPFS service
    mockIPFSService = {
      fetchContent: vi.fn().mockResolvedValue(Buffer.from('{"type": "string"}')),
    } as any;

    jsonValidator = new JsonValidatorService(mockIPFSService);
    vi.clearAllMocks();
  });

  describe('Currency Format with number type', () => {
    const currencySchema: JSONSchema = {
      type: 'number',
      format: 'currency',
    };

    it('should validate valid currency values', async () => {
      const validValues = [
        100,
        100.00,
        100.0,
        100.5,
        100.50,
        100.99,
        1000,
        1000000,
        0.50,
        0.01,
        999999999.99,
        1.1,
        1.11,
        42.42,
        0.1,
        0.99,
      ];

      for (const value of validValues) {
        const result = await jsonValidator.validate(value, currencySchema);
        expect(result.valid, `Failed for value: ${value}`).toBe(true);
      }
    });

    it('should reject invalid currency values', async () => {
      const invalidValues = [
        0,            // Zero
        -100,         // Negative
        -100.50,      // Negative with decimals
        -0.01,        // Negative small value
        100.123,      // Three decimal places
        100.001,      // Three decimal places
        1.999,        // Three decimal places
        0.001,        // Three decimal places (but also would be rejected as too small anyway)
        123.4567,     // Four decimal places
      ];

      for (const value of invalidValues) {
        const result = await jsonValidator.validate(value, currencySchema);
        expect(result.valid, `Should reject value: ${value}`).toBe(false);
      }
    });

    it('should reject non-numeric values', async () => {
      const invalidValues = [
        "100",        // String
        "100.00",     // String
        "$100",       // String with dollar sign
        null,         // Null
        undefined,    // Undefined
        {},           // Object
        [],           // Array
        true,         // Boolean
      ];

      for (const value of invalidValues) {
        const result = await jsonValidator.validate(value, currencySchema);
        expect(result.valid, `Should reject non-numeric value: ${value}`).toBe(false);
      }
    });

    it('should reject special numeric values', async () => {
      const invalidValues = [
        NaN,          // Not a number
        Infinity,     // Infinity
        -Infinity,    // Negative infinity
      ];

      for (const value of invalidValues) {
        const result = await jsonValidator.validate(value, currencySchema);
        expect(result.valid, `Should reject special value: ${value}`).toBe(false);
      }
    });

    it('should reject zero and negative numbers', async () => {
      const values = [
        { value: 0, expected: false },        // Zero - invalid
        { value: -100, expected: false },     // Negative - invalid
        { value: -100.50, expected: false },  // Negative - invalid
        { value: -100.99, expected: false },  // Negative - invalid
        { value: -0.01, expected: false },    // Negative - invalid
      ];

      for (const test of values) {
        const result = await jsonValidator.validate(test.value, currencySchema);
        expect(result.valid, `Value ${test.value} should be ${test.expected ? 'valid' : 'invalid'}`).toBe(test.expected);
      }
    });

    it('should handle edge cases', async () => {
      const edgeCases = [
        { value: 0.01, expected: true },     // Smallest positive with 2 decimals
        { value: 0.1, expected: true },      // One decimal
        { value: 0.99, expected: true },     // Less than 1
        { value: 1e2, expected: true },      // 100 in scientific notation
        { value: 1.5e2, expected: true },    // 150 in scientific notation
        { value: 1.23e2, expected: true },   // 123 in scientific notation
      ];

      for (const test of edgeCases) {
        const result = await jsonValidator.validate(test.value, currencySchema);
        expect(result.valid, `Edge case ${test.value} should be ${test.expected ? 'valid' : 'invalid'}`).toBe(test.expected);
      }
    });
  });

  describe('Schema validation with currency format', () => {
    it('should work in object properties', async () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          price: {
            type: 'number',
            format: 'currency',
          },
          discount: {
            type: 'number',
            format: 'currency',
          },
        },
        required: ['price'],
      };

      const validData = {
        price: 19.99,
        discount: 5.00,
      };

      const result = await jsonValidator.validate(validData, schema);
      expect(result.valid).toBe(true);
    });

    it('should reject invalid currency in objects', async () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          price: {
            type: 'number',
            format: 'currency',
          },
        },
      };

      const invalidData = {
        price: 19.999, // Three decimal places
      };

      const result = await jsonValidator.validate(invalidData, schema);
      expect(result.valid).toBe(false);
    });

    it('should work in arrays', async () => {
      const schema: JSONSchema = {
        type: 'array',
        items: {
          type: 'number',
          format: 'currency',
        },
      };

      const validData = [10.00, 20.50, 30.99, 40];
      const result = await jsonValidator.validate(validData, schema);
      expect(result.valid).toBe(true);

      const invalidData = [10.00, 20.555, 30.99]; // One has 3 decimal places
      const result2 = await jsonValidator.validate(invalidData, schema);
      expect(result2.valid).toBe(false);
    });
  });
});