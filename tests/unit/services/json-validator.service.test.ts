import { describe, it, expect, beforeEach } from 'vitest';
import {
  JsonValidatorService,
  ValidationResult,
} from '../../../src/services/json-validator.service';
import { JSONSchema } from '../../../src/services/schema-cache.service';

describe('JsonValidatorService', () => {
  let jsonValidator: JsonValidatorService;

  beforeEach(() => {
    jsonValidator = new JsonValidatorService();
  });

  describe('validate', () => {
    it('should validate valid data against simple schema', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
          age: { type: 'number' },
        },
        required: ['name'],
      };

      const data = { name: 'John', age: 30 };
      const result = jsonValidator.validate(data, schema);

      expect(result.valid).toBe(true);
      expect(result.errors).toBeUndefined();
    });

    it('should fail validation for missing required field', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
          age: { type: 'number' },
        },
        required: ['name', 'age'],
      };

      const data = { name: 'John' }; // Missing age
      const result = jsonValidator.validate(data, schema);

      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors!.length).toBeGreaterThan(0);
      expect(result.errors![0].message).toContain('required property');
    });

    it('should fail validation for wrong type', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          age: { type: 'number' },
        },
      };

      const data = { age: 'thirty' }; // Wrong type
      const result = jsonValidator.validate(data, schema);

      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors![0].keyword).toBe('type');
    });

    it('should validate nested objects', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          user: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              email: { type: 'string', format: 'email' },
            },
            required: ['name', 'email'],
          },
        },
      };

      const validData = {
        user: {
          name: 'John',
          email: 'john@example.com',
        },
      };

      const result = jsonValidator.validate(validData, schema);
      expect(result.valid).toBe(true);

      const invalidData = {
        user: {
          name: 'John',
          email: 'not-an-email',
        },
      };

      const result2 = jsonValidator.validate(invalidData, schema);
      expect(result2.valid).toBe(false);
      expect(result2.errors![0].message).toContain('format');
    });

    it('should validate arrays', () => {
      const schema: JSONSchema = {
        type: 'array',
        items: { type: 'number' },
        minItems: 1,
        maxItems: 5,
      };

      expect(jsonValidator.validate([1, 2, 3], schema).valid).toBe(true);
      expect(jsonValidator.validate([], schema).valid).toBe(false); // Too few
      expect(jsonValidator.validate([1, 2, 3, 4, 5, 6], schema).valid).toBe(
        false
      ); // Too many
      expect(jsonValidator.validate([1, 'two', 3], schema).valid).toBe(false); // Wrong type
    });

    it('should validate with additional properties', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
        },
        additionalProperties: false,
      };

      const data1 = { name: 'John' };
      expect(jsonValidator.validate(data1, schema).valid).toBe(true);

      const data2 = { name: 'John', extra: 'field' };
      expect(jsonValidator.validate(data2, schema).valid).toBe(false);
    });

    it('should validate enums', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          status: { enum: ['active', 'inactive', 'pending'] },
        },
      };

      expect(jsonValidator.validate({ status: 'active' }, schema).valid).toBe(
        true
      );
      expect(jsonValidator.validate({ status: 'invalid' }, schema).valid).toBe(
        false
      );
    });

    it('should validate patterns', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          code: { type: 'string', pattern: '^[A-Z]{3}[0-9]{3}$' },
        },
      };

      expect(jsonValidator.validate({ code: 'ABC123' }, schema).valid).toBe(
        true
      );
      expect(jsonValidator.validate({ code: 'abc123' }, schema).valid).toBe(
        false
      );
    });

    it('should validate number constraints', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          age: { type: 'number', minimum: 0, maximum: 150 },
          score: { type: 'number', multipleOf: 0.5 },
        },
      };

      expect(
        jsonValidator.validate({ age: 30, score: 85.5 }, schema).valid
      ).toBe(true);
      expect(jsonValidator.validate({ age: -1 }, schema).valid).toBe(false);
      expect(jsonValidator.validate({ age: 200 }, schema).valid).toBe(false);
      expect(jsonValidator.validate({ score: 85.3 }, schema).valid).toBe(false);
    });

    it('should validate string constraints', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          username: { type: 'string', minLength: 3, maxLength: 20 },
        },
      };

      expect(jsonValidator.validate({ username: 'john' }, schema).valid).toBe(
        true
      );
      expect(jsonValidator.validate({ username: 'jo' }, schema).valid).toBe(
        false
      );
      expect(
        jsonValidator.validate({ username: 'a'.repeat(25) }, schema).valid
      ).toBe(false);
    });

    it('should handle validation errors gracefully', () => {
      const invalidSchema = { type: 'invalid-type' };
      const result = jsonValidator.validate({}, invalidSchema as any);

      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors![0].keyword).toBe('error');
    });
  });

  describe('validateBatch', () => {
    it('should validate multiple data items against same schema', async () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          id: { type: 'number' },
          name: { type: 'string' },
        },
        required: ['id', 'name'],
      };

      const dataArray = [
        { id: 1, name: 'Item 1' },
        { id: 2, name: 'Item 2' },
        { id: 3 }, // Missing name
        { id: 4, name: 'Item 4' },
      ];

      const results = await jsonValidator.validateBatch(dataArray, schema);

      expect(results).toHaveLength(4);
      expect(results[0].valid).toBe(true);
      expect(results[1].valid).toBe(true);
      expect(results[2].valid).toBe(false);
      expect(results[3].valid).toBe(true);
    });

    it('should handle empty batch', async () => {
      const schema: JSONSchema = { type: 'object' };
      const results = await jsonValidator.validateBatch([], schema);

      expect(results).toEqual([]);
    });

    it('should reuse compiled validator for performance', async () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          value: { type: 'number' },
        },
      };

      const largeDataArray = Array(100)
        .fill(null)
        .map((_, i) => ({ value: i }));

      const startTime = Date.now();
      const results = await jsonValidator.validateBatch(largeDataArray, schema);
      const duration = Date.now() - startTime;

      expect(results).toHaveLength(100);
      expect(results.every((r) => r.valid)).toBe(true);
      expect(duration).toBeLessThan(100); // Should be fast due to caching
    });
  });

  describe('format validators', () => {
    it('should validate email format', () => {
      const schema: JSONSchema = {
        type: 'string',
        format: 'email',
      };

      expect(jsonValidator.validate('test@example.com', schema).valid).toBe(
        true
      );
      expect(jsonValidator.validate('invalid-email', schema).valid).toBe(false);
    });

    it('should validate date format', () => {
      const schema: JSONSchema = {
        type: 'string',
        format: 'date',
      };

      expect(jsonValidator.validate('2023-12-25', schema).valid).toBe(true);
      expect(jsonValidator.validate('25-12-2023', schema).valid).toBe(false);
    });

    it('should validate uri format', () => {
      const schema: JSONSchema = {
        type: 'string',
        format: 'uri',
      };

      expect(jsonValidator.validate('https://example.com', schema).valid).toBe(
        true
      );
      expect(jsonValidator.validate('not a uri', schema).valid).toBe(false);
    });

    it('should validate ipv4 format', () => {
      const schema: JSONSchema = {
        type: 'string',
        format: 'ipv4',
      };

      expect(jsonValidator.validate('192.168.1.1', schema).valid).toBe(true);
      expect(jsonValidator.validate('999.999.999.999', schema).valid).toBe(
        false
      );
    });
  });

  describe('addFormat', () => {
    it('should add custom string format', () => {
      jsonValidator.addFormat('uppercase', /^[A-Z]+$/);

      const schema: JSONSchema = {
        type: 'string',
        format: 'uppercase',
      };

      expect(jsonValidator.validate('HELLO', schema).valid).toBe(true);
      expect(jsonValidator.validate('Hello', schema).valid).toBe(false);
    });

    it('should add custom format with function', () => {
      jsonValidator.addFormat(
        'even-length',
        (data: string) => data.length % 2 === 0
      );

      const schema: JSONSchema = {
        type: 'string',
        format: 'even-length',
      };

      expect(jsonValidator.validate('ab', schema).valid).toBe(true);
      expect(jsonValidator.validate('abc', schema).valid).toBe(false);
    });
  });

  describe('getErrorMessage', () => {
    it('should format single error message', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
        },
        required: ['name'],
      };

      const result = jsonValidator.validate({}, schema);
      const message = jsonValidator.getErrorMessage(result.errors || []);

      expect(message).toContain('required property');
    });

    it('should format multiple error messages', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
          age: { type: 'number', minimum: 0 },
        },
        required: ['name', 'age'],
      };

      const result = jsonValidator.validate({ age: -5 }, schema);
      const message = jsonValidator.getErrorMessage(result.errors || []);

      expect(message).toContain('required property');
      // AJV might report errors in different order, so check that we have multiple errors
      expect(result.errors!.length).toBeGreaterThan(1);
    });

    it('should handle empty errors', () => {
      const message = jsonValidator.getErrorMessage([]);
      expect(message).toBe('Unknown validation error');
    });
  });

  describe('isValidSchema', () => {
    it('should return true for valid schema', () => {
      const validSchema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
        },
      };

      expect(jsonValidator.isValidSchema(validSchema)).toBe(true);
    });

    it('should return false for invalid schema', () => {
      const invalidSchema = {
        type: 'invalid-type',
        properties: 'not-an-object',
      };

      expect(jsonValidator.isValidSchema(invalidSchema)).toBe(false);
    });

    it('should handle complex valid schemas', () => {
      const complexSchema = {
        $schema: 'http://json-schema.org/draft-07/schema#',
        type: 'object',
        properties: {
          items: {
            type: 'array',
            items: {
              oneOf: [{ type: 'string' }, { type: 'number' }],
            },
          },
        },
      };

      expect(jsonValidator.isValidSchema(complexSchema)).toBe(true);
    });
  });

  describe('clearCache', () => {
    it('should clear validator cache', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          test: { type: 'string' },
        },
      };

      // First validation compiles and caches
      jsonValidator.validate({ test: 'value' }, schema);

      // Clear cache
      jsonValidator.clearCache();

      // Should still work after clearing cache
      const result = jsonValidator.validate({ test: 'value' }, schema);
      expect(result.valid).toBe(true);
    });
  });

  describe('complex schemas', () => {
    it('should validate with $ref references', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          billing: { $ref: '#/definitions/address' },
          shipping: { $ref: '#/definitions/address' },
        },
        definitions: {
          address: {
            type: 'object',
            properties: {
              street: { type: 'string' },
              city: { type: 'string' },
              zip: { type: 'string', pattern: '^[0-9]{5}$' },
            },
            required: ['street', 'city', 'zip'],
          },
        },
      };

      const validData = {
        billing: { street: '123 Main St', city: 'Anytown', zip: '12345' },
        shipping: { street: '456 Oak Ave', city: 'Other City', zip: '67890' },
      };

      expect(jsonValidator.validate(validData, schema).valid).toBe(true);

      const invalidData = {
        billing: { street: '123 Main St', city: 'Anytown', zip: 'abc' },
      };

      expect(jsonValidator.validate(invalidData, schema).valid).toBe(false);
    });

    it('should validate with allOf, anyOf, oneOf', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          value: {
            anyOf: [{ type: 'string' }, { type: 'number' }],
          },
        },
      };

      expect(jsonValidator.validate({ value: 'text' }, schema).valid).toBe(
        true
      );
      expect(jsonValidator.validate({ value: 123 }, schema).valid).toBe(true);
      expect(jsonValidator.validate({ value: true }, schema).valid).toBe(false);
    });
  });
});
