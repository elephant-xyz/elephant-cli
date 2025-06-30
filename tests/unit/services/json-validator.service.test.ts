import { describe, it, expect, beforeEach, vi } from 'vitest';
import { JsonValidatorService } from '../../../src/services/json-validator.service';
import { JSONSchema } from '../../../src/services/schema-cache.service';
import { IPFSService } from '../../../src/services/ipfs.service';
import { CID } from 'multiformats/cid';

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

  describe('CID format validation', () => {
    it('should validate valid CID format', async () => {
      const schema: JSONSchema = {
        type: 'string',
        format: 'cid',
      };

      const validCIDv0 = 'QmWUnTmuodSYEuHVPgxtrARGra2VpzsusAp4FqT9FWobuU';
      const validCIDv1 = 'bafybeiemxf5abjwjbikoz4mc3a3dla6ual3jsgpdr4cjr3oz3evfyavhwq';

      expect((await jsonValidator.validate(validCIDv0, schema)).valid).toBe(true);
      expect((await jsonValidator.validate(validCIDv1, schema)).valid).toBe(true);
    });

    it('should reject invalid CID format', async () => {
      const schema: JSONSchema = {
        type: 'string',
        format: 'cid',
      };

      const invalidCIDs = [
        'not-a-cid',
        'Qm',
        'QmInvalid!@#$',
        '',
        '12345',
        'bafybeie'
      ];

      for (const invalidCID of invalidCIDs) {
        const result = await jsonValidator.validate(invalidCID, schema);
        expect(result.valid).toBe(false);
        expect(result.errors).toBeDefined();
        expect(result.errors![0].message).toContain('format');
      }
    });

    it('should validate CID format in object properties', async () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          dataCID: { type: 'string', format: 'cid' },
          schemaCID: { type: 'string', format: 'cid' },
        },
        required: ['dataCID', 'schemaCID'],
      };

      const validData = {
        dataCID: 'QmWUnTmuodSYEuHVPgxtrARGra2VpzsusAp4FqT9FWobuU',
        schemaCID: 'bafybeiemxf5abjwjbikoz4mc3a3dla6ual3jsgpdr4cjr3oz3evfyavhwq',
      };

      expect((await jsonValidator.validate(validData, schema)).valid).toBe(true);

      const invalidData = {
        dataCID: 'invalid-cid',
        schemaCID: 'QmWUnTmuodSYEuHVPgxtrARGra2VpzsusAp4FqT9FWobuU',
      };

      const result = await jsonValidator.validate(invalidData, schema);
      expect(result.valid).toBe(false);
      expect(result.errors![0].path).toContain('dataCID');
    });
  });

  describe('CID custom keyword', () => {
    it('should validate data against schema fetched from CID', async () => {
      const mockCID = 'QmTestSchema123456789012345678901234567890123';
      const embeddedSchema: JSONSchema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
          value: { type: 'number', minimum: 0 },
        },
        required: ['name', 'value'],
      };

      // Mock IPFS service to return the embedded schema
      vi.mocked(mockIPFSService.fetchContent).mockResolvedValueOnce(
        Buffer.from(JSON.stringify(embeddedSchema))
      );

      const schema: JSONSchema = {
        type: 'object',
        properties: {
          data: { type: 'cid' as any, cid: mockCID },
        },
      };

      const validData = {
        data: {
          name: 'Test',
          value: 42,
        },
      };

      const result = await jsonValidator.validate(validData, schema);
      expect(result.valid).toBe(true);
      expect(mockIPFSService.fetchContent).toHaveBeenCalledWith(mockCID);
    });

    it('should fail validation when data does not match CID schema', async () => {
      const mockCID = 'QmTestSchema123456789012345678901234567890123';
      const embeddedSchema: JSONSchema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
          value: { type: 'number', minimum: 0 },
        },
        required: ['name', 'value'],
      };

      vi.mocked(mockIPFSService.fetchContent).mockResolvedValueOnce(
        Buffer.from(JSON.stringify(embeddedSchema))
      );

      const schema: JSONSchema = {
        type: 'object',
        properties: {
          data: { type: 'cid' as any, cid: mockCID },
        },
      };

      const invalidData = {
        data: {
          name: 'Test',
          value: -10, // Violates minimum: 0
        },
      };

      const result = await jsonValidator.validate(invalidData, schema);
      expect(result.valid).toBe(false);
    });

    it('should cache schemas fetched from CID', async () => {
      const mockCID = 'QmTestSchema123456789012345678901234567890123';
      const embeddedSchema: JSONSchema = {
        type: 'object',
        properties: {
          id: { type: 'string' },
        },
      };

      vi.mocked(mockIPFSService.fetchContent).mockResolvedValueOnce(
        Buffer.from(JSON.stringify(embeddedSchema))
      );

      const schema: JSONSchema = {
        type: 'object',
        properties: {
          data1: { type: 'cid' as any, cid: mockCID },
          data2: { type: 'cid' as any, cid: mockCID },
        },
      };

      const data = {
        data1: { id: 'test1' },
        data2: { id: 'test2' },
      };

      const result = await jsonValidator.validate(data, schema);
      expect(result.valid).toBe(true);
      // Should only fetch once due to caching
      expect(mockIPFSService.fetchContent).toHaveBeenCalledTimes(1);
    });

    it('should handle IPFS fetch errors gracefully', async () => {
      const mockCID = 'QmTestSchema123456789012345678901234567890123';
      
      vi.mocked(mockIPFSService.fetchContent).mockRejectedValueOnce(
        new Error('IPFS gateway timeout')
      );

      const schema: JSONSchema = {
        type: 'object',
        properties: {
          data: { type: 'cid' as any, cid: mockCID },
        },
      };

      const data = {
        data: { test: 'value' },
      };

      const result = await jsonValidator.validate(data, schema);
      expect(result.valid).toBe(false);
      expect(result.errors![0].message).toContain('Validation error');
    });

    it('should handle invalid JSON in CID content', async () => {
      const mockCID = 'QmTestSchema123456789012345678901234567890123';
      
      vi.mocked(mockIPFSService.fetchContent).mockResolvedValueOnce(
        Buffer.from('{ invalid json ]')
      );

      const schema: JSONSchema = {
        type: 'object',
        properties: {
          data: { type: 'cid' as any, cid: mockCID },
        },
      };

      const data = {
        data: { test: 'value' },
      };

      const result = await jsonValidator.validate(data, schema);
      expect(result.valid).toBe(false);
    });

    it('should validate nested CID schemas', async () => {
      const mockCID1 = 'QmTestSchema123456789012345678901234567890111';
      const mockCID2 = 'QmTestSchema123456789012345678901234567890222';
      
      const schema1: JSONSchema = {
        type: 'object',
        properties: {
          user: { type: 'string' },
          profile: { type: 'cid' as any, cid: mockCID2 },
        },
      };

      const schema2: JSONSchema = {
        type: 'object',
        properties: {
          bio: { type: 'string', maxLength: 100 },
          age: { type: 'number', minimum: 18 },
        },
        required: ['bio'],
      };

      vi.mocked(mockIPFSService.fetchContent)
        .mockResolvedValueOnce(Buffer.from(JSON.stringify(schema1)))
        .mockResolvedValueOnce(Buffer.from(JSON.stringify(schema2)));

      const rootSchema: JSONSchema = {
        type: 'object',
        properties: {
          data: { type: 'cid' as any, cid: mockCID1 },
        },
      };

      const validData = {
        data: {
          user: 'john',
          profile: {
            bio: 'Software developer',
            age: 25,
          },
        },
      };

      const result = await jsonValidator.validate(validData, rootSchema);
      expect(result.valid).toBe(true);
      expect(mockIPFSService.fetchContent).toHaveBeenCalledWith(mockCID1);
      expect(mockIPFSService.fetchContent).toHaveBeenCalledWith(mockCID2);
    });

    it('should validate arrays with CID item schemas', async () => {
      const mockCID = 'QmTestSchema123456789012345678901234567890123';
      const itemSchema: JSONSchema = {
        type: 'object',
        properties: {
          id: { type: 'string' },
          value: { type: 'number' },
        },
        required: ['id'],
      };

      vi.mocked(mockIPFSService.fetchContent).mockResolvedValueOnce(
        Buffer.from(JSON.stringify(itemSchema))
      );

      const schema: JSONSchema = {
        type: 'array',
        items: { type: 'cid' as any, cid: mockCID },
      };

      const validData = [
        { id: '1', value: 10 },
        { id: '2', value: 20 },
        { id: '3' }, // value is optional
      ];

      const result = await jsonValidator.validate(validData, schema);
      expect(result.valid).toBe(true);
    });

    it('should handle invalid schema from CID', async () => {
      const mockCID = 'QmTestSchema123456789012345678901234567890123';
      
      // Return valid JSON but invalid schema
      vi.mocked(mockIPFSService.fetchContent).mockResolvedValueOnce(
        Buffer.from(JSON.stringify({ type: 'invalid-type' }))
      );

      const schema: JSONSchema = {
        type: 'object',
        properties: {
          data: { type: 'cid' as any, cid: mockCID },
        },
      };

      const data = {
        data: { test: 'value' },
      };

      const result = await jsonValidator.validate(data, schema);
      expect(result.valid).toBe(false);
    });

    it('should validate format CID with embedded schema', async () => {
      const mockCID = 'QmTestSchema123456789012345678901234567890123';
      const embeddedSchema: JSONSchema = {
        type: 'object',
        properties: {
          metadata: { type: 'string' },
        },
      };

      vi.mocked(mockIPFSService.fetchContent).mockResolvedValueOnce(
        Buffer.from(JSON.stringify(embeddedSchema))
      );

      const schema: JSONSchema = {
        type: 'object',
        properties: {
          config: {
            type: 'string',
            format: 'cid',
            value: mockCID,
          },
        },
      };

      const data = {
        config: { metadata: 'test' },
      };

      const result = await jsonValidator.validate(data, schema);
      expect(result.valid).toBe(true);
      expect(mockIPFSService.fetchContent).toHaveBeenCalledWith(mockCID);
    });
  });

  describe('isValidSchema', () => {
    it('should validate correct schemas', async () => {
      const schemas = [
        { type: 'string' },
        { type: 'object', properties: { id: { type: 'number' } } },
        { type: 'array', items: { type: 'string' } },
        { enum: ['a', 'b', 'c'] },
        { anyOf: [{ type: 'string' }, { type: 'number' }] },
      ];

      for (const schema of schemas) {
        expect(await jsonValidator.isValidSchema(schema)).toBe(true);
      }
    });

    it('should reject invalid schemas', async () => {
      // AJV may be more permissive than expected, let's test with schemas that definitely should fail
      const invalidSchemas = [
        { type: 'invalid-type' }, // Invalid type value
        { type: ['string', 'invalid'] }, // Invalid type in array
        { required: 'not-an-array' }, // required must be array
        { properties: 'not-an-object' }, // properties must be object
      ];

      for (const schema of invalidSchemas) {
        const isValid = await jsonValidator.isValidSchema(schema);
        if (isValid) {
          console.log('Unexpectedly valid schema:', schema);
        }
        expect(isValid).toBe(false);
      }
    });
  });
});
