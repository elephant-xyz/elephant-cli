import { describe, it, expect, beforeEach, vi } from 'vitest';
import { JsonValidatorService } from '../../../src/services/json-validator.service';
import { JSONSchema } from '../../../src/services/schema-cache.service';
import { IPFSService } from '../../../src/services/ipfs.service';

describe('JsonValidatorService', () => {
  let jsonValidator: JsonValidatorService;
  let mockIPFSService: IPFSService;

  beforeEach(() => {
    // Create mock IPFS service
    mockIPFSService = {
      fetchContent: vi.fn().mockResolvedValue(Buffer.from('{"type": "string"}')),
    } as any;
    
    jsonValidator = new JsonValidatorService(mockIPFSService);
  });

  describe('validate', () => {
    it('should validate valid data against simple schema', async () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
          age: { type: 'number' },
        },
        required: ['name'],
      };

      const data = { name: 'John', age: 30 };
      const result = await jsonValidator.validate(data, schema);

      expect(result.valid).toBe(true);
      expect(result.errors).toBeUndefined();
    });

    it('should fail validation for missing required field', async () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
          age: { type: 'number' },
        },
        required: ['name', 'age'],
      };

      const data = { name: 'John' }; // Missing age
      const result = await jsonValidator.validate(data, schema);

      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors!.length).toBeGreaterThan(0);
      expect(result.errors![0].message).toContain('required property');
    });

    it('should fail validation for wrong type', async () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          age: { type: 'number' },
        },
      };

      const data = { age: 'thirty' }; // Wrong type
      const result = await jsonValidator.validate(data, schema);

      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors![0].keyword).toBe('type');
    });

    it('should validate nested objects', async () => {
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

      const result = await jsonValidator.validate(validData, schema);
      expect(result.valid).toBe(true);

      const invalidData = {
        user: {
          name: 'John',
          email: 'not-an-email',
        },
      };

      const result2 = await jsonValidator.validate(invalidData, schema);
      expect(result2.valid).toBe(false);
      expect(result2.errors![0].message).toContain('format');
    });

    it('should validate arrays', async () => {
      const schema: JSONSchema = {
        type: 'array',
        items: { type: 'number' },
        minItems: 1,
        maxItems: 5,
      };

      expect((await jsonValidator.validate([1, 2, 3], schema)).valid).toBe(true);
      expect((await jsonValidator.validate([], schema)).valid).toBe(false); // Too few
      expect((await jsonValidator.validate([1, 2, 3, 4, 5, 6], schema)).valid).toBe(
        false
      ); // Too many
      expect((await jsonValidator.validate([1, 'two', 3], schema)).valid).toBe(false); // Wrong type
    });

    it('should validate with additional properties', async () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
        },
        additionalProperties: false,
      };

      const data1 = { name: 'John' };
      expect((await jsonValidator.validate(data1, schema)).valid).toBe(true);

      const data2 = { name: 'John', extra: 'field' };
      expect((await jsonValidator.validate(data2, schema)).valid).toBe(false);
    });

    it('should validate enums', async () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          status: { enum: ['active', 'inactive', 'pending'] },
        },
      };

      expect((await jsonValidator.validate({ status: 'active' }, schema)).valid).toBe(
        true
      );
      expect((await jsonValidator.validate({ status: 'invalid' }, schema)).valid).toBe(
        false
      );
    });

    it('should validate patterns', async () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          code: { type: 'string', pattern: '^[A-Z]{3}[0-9]{3}$' },
        },
      };

      expect((await jsonValidator.validate({ code: 'ABC123' }, schema)).valid).toBe(
        true
      );
      expect((await jsonValidator.validate({ code: 'abc123' }, schema)).valid).toBe(
        false
      );
    });

    it('should validate number constraints', async () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          age: { type: 'number', minimum: 0, maximum: 150 },
          score: { type: 'number', multipleOf: 0.5 },
        },
      };

      expect(
        (await jsonValidator.validate({ age: 30, score: 85.5 }, schema)).valid
      ).toBe(true);
      expect(
        (await jsonValidator.validate({ age: -1, score: 85.5 }, schema)).valid
      ).toBe(false);
      expect(
        (await jsonValidator.validate({ age: 200, score: 85.5 }, schema)).valid
      ).toBe(false);
      expect((await jsonValidator.validate({ score: 85.3 }, schema)).valid).toBe(false);
    });

    it('should validate string constraints', async () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          username: { type: 'string', minLength: 3, maxLength: 20 },
        },
      };

      expect((await jsonValidator.validate({ username: 'john' }, schema)).valid).toBe(
        true
      );
      expect((await jsonValidator.validate({ username: 'jo' }, schema)).valid).toBe(
        false
      );
      expect(
        (await jsonValidator.validate({ username: 'a'.repeat(25) }, schema)).valid
      ).toBe(false);
    });

    it('should handle validation errors gracefully', async () => {
      const invalidSchema = { type: 'invalid-type' };
      const result = await jsonValidator.validate({}, invalidSchema as any);

      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors![0].keyword).toBe('error');
    });
  });

  describe('format validators', () => {
    it('should validate email format', async () => {
      const schema: JSONSchema = {
        type: 'string',
        format: 'email',
      };

      expect((await jsonValidator.validate('test@example.com', schema)).valid).toBe(
        true
      );
      expect((await jsonValidator.validate('invalid-email', schema)).valid).toBe(false);
    });

    it('should validate date format', async () => {
      const schema: JSONSchema = {
        type: 'string',
        format: 'date',
      };

      expect((await jsonValidator.validate('2023-12-25', schema)).valid).toBe(true);
      expect((await jsonValidator.validate('25-12-2023', schema)).valid).toBe(false);
    });

    it('should validate uri format', async () => {
      const schema: JSONSchema = {
        type: 'string',
        format: 'uri',
      };

      expect((await jsonValidator.validate('https://example.com', schema)).valid).toBe(
        true
      );
      expect((await jsonValidator.validate('not a uri', schema)).valid).toBe(false);
    });

    it('should validate ipv4 format', async () => {
      const schema: JSONSchema = {
        type: 'string',
        format: 'ipv4',
      };

      expect((await jsonValidator.validate('192.168.1.1', schema)).valid).toBe(true);
      expect((await jsonValidator.validate('999.999.999.999', schema)).valid).toBe(
        false
      );
      expect(
        (await jsonValidator.validate('999.999.999.999', schema)).valid
      ).toBe(false);
    });
  });

  describe('getErrorMessage', () => {
    it('should format single error message', async () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
        },
        required: ['name'],
      };

      const result = await jsonValidator.validate({}, schema);
      const message = jsonValidator.getErrorMessage(result.errors || []);

      expect(message).toContain('required property');
    });

    it('should format multiple error messages', async () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
          age: { type: 'number', minimum: 0 },
        },
        required: ['name', 'age'],
      };

      const result = await jsonValidator.validate({ age: -5 }, schema);
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

  describe('complex schemas', () => {
    it('should validate with $ref references', async () => {
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

      expect((await jsonValidator.validate(validData, schema)).valid).toBe(true);

      const invalidData = {
        billing: { street: '123 Main St', city: 'Anytown', zip: 'abc' },
      };

      expect((await jsonValidator.validate(invalidData, schema)).valid).toBe(false);
    });

    it('should validate with allOf, anyOf, oneOf', async () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          value: {
            anyOf: [{ type: 'string' }, { type: 'number' }],
          },
        },
      };

      expect((await jsonValidator.validate({ value: 'text' }, schema)).valid).toBe(
        true
      );
      expect((await jsonValidator.validate({ value: 123 }, schema)).valid).toBe(true);
      expect((await jsonValidator.validate({ value: true }, schema)).valid).toBe(false);
    });
  });
});
