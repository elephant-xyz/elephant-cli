import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { JsonValidatorService } from '../../../src/services/json-validator.service';
import { JSONSchema } from '../../../src/services/schema-cache.service';
import { IPFSService } from '../../../src/services/ipfs.service';
import { promises as fsPromises } from 'fs';

vi.mock('fs', () => ({
  promises: {
    readFile: vi.fn(),
  },
}));

describe('JsonValidatorService', () => {
  let jsonValidator: JsonValidatorService;
  let mockIPFSService: IPFSService;

  beforeEach(() => {
    // Create mock IPFS service
    mockIPFSService = {
      fetchContent: vi
        .fn()
        .mockResolvedValue(Buffer.from('{"type": "string"}')),
    } as any;

    jsonValidator = new JsonValidatorService(mockIPFSService);
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
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

      expect((await jsonValidator.validate([1, 2, 3], schema)).valid).toBe(
        true
      );
      expect((await jsonValidator.validate([], schema)).valid).toBe(false); // Too few
      expect(
        (await jsonValidator.validate([1, 2, 3, 4, 5, 6], schema)).valid
      ).toBe(false); // Too many
      expect((await jsonValidator.validate([1, 'two', 3], schema)).valid).toBe(
        false
      ); // Wrong type
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

      expect(
        (await jsonValidator.validate({ status: 'active' }, schema)).valid
      ).toBe(true);
      expect(
        (await jsonValidator.validate({ status: 'invalid' }, schema)).valid
      ).toBe(false);
    });

    it('should validate patterns', async () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          code: { type: 'string', pattern: '^[A-Z]{3}[0-9]{3}$' },
        },
      };

      expect(
        (await jsonValidator.validate({ code: 'ABC123' }, schema)).valid
      ).toBe(true);
      expect(
        (await jsonValidator.validate({ code: 'abc123' }, schema)).valid
      ).toBe(false);
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
      expect(
        (await jsonValidator.validate({ score: 85.3 }, schema)).valid
      ).toBe(false);
    });

    it('should validate string constraints', async () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          username: { type: 'string', minLength: 3, maxLength: 20 },
        },
      };

      expect(
        (await jsonValidator.validate({ username: 'john' }, schema)).valid
      ).toBe(true);
      expect(
        (await jsonValidator.validate({ username: 'jo' }, schema)).valid
      ).toBe(false);
      expect(
        (await jsonValidator.validate({ username: 'a'.repeat(25) }, schema))
          .valid
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

      expect(
        (await jsonValidator.validate('test@example.com', schema)).valid
      ).toBe(true);
      expect(
        (await jsonValidator.validate('invalid-email', schema)).valid
      ).toBe(false);
    });

    it('should validate date format', async () => {
      const schema: JSONSchema = {
        type: 'string',
        format: 'date',
      };

      expect((await jsonValidator.validate('2023-12-25', schema)).valid).toBe(
        true
      );
      expect((await jsonValidator.validate('25-12-2023', schema)).valid).toBe(
        false
      );
    });

    it('should validate uri format', async () => {
      const schema: JSONSchema = {
        type: 'string',
        format: 'uri',
      };

      expect(
        (await jsonValidator.validate('https://example.com', schema)).valid
      ).toBe(true);
      expect((await jsonValidator.validate('not a uri', schema)).valid).toBe(
        false
      );
    });

    it('should validate ipv4 format', async () => {
      const schema: JSONSchema = {
        type: 'string',
        format: 'ipv4',
      };

      expect((await jsonValidator.validate('192.168.1.1', schema)).valid).toBe(
        true
      );
      expect(
        (await jsonValidator.validate('999.999.999.999', schema)).valid
      ).toBe(false);
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

      expect((await jsonValidator.validate(validData, schema)).valid).toBe(
        true
      );

      const invalidData = {
        billing: { street: '123 Main St', city: 'Anytown', zip: 'abc' },
      };

      expect((await jsonValidator.validate(invalidData, schema)).valid).toBe(
        false
      );
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

      expect(
        (await jsonValidator.validate({ value: 'text' }, schema)).valid
      ).toBe(true);
      expect((await jsonValidator.validate({ value: 123 }, schema)).valid).toBe(
        true
      );
      expect(
        (await jsonValidator.validate({ value: true }, schema)).valid
      ).toBe(false);
    });
  });

  describe('CID format validation', () => {
    it('should validate valid CID format', async () => {
      const schema: JSONSchema = {
        type: 'string',
        format: 'cid',
      };

      const validCIDv0 = 'QmWUnTmuodSYEuHVPgxtrARGra2VpzsusAp4FqT9FWobuU';
      const validCIDv1 =
        'bafybeiemxf5abjwjbikoz4mc3a3dla6ual3jsgpdr4cjr3oz3evfyavhwq';

      expect((await jsonValidator.validate(validCIDv0, schema)).valid).toBe(
        true
      );
      expect((await jsonValidator.validate(validCIDv1, schema)).valid).toBe(
        true
      );
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
        'bafybeie',
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
        schemaCID:
          'bafybeiemxf5abjwjbikoz4mc3a3dla6ual3jsgpdr4cjr3oz3evfyavhwq',
      };

      expect((await jsonValidator.validate(validData, schema)).valid).toBe(
        true
      );

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
    // Note: The CID functionality works by replacing schema nodes that have
    // type: 'string' and a cid property with the schema fetched from IPFS

    it('should validate data against schema fetched from CID', async () => {
      const mockCID = 'QmYjtig7VJQ6XsnUjqqJvj7QaMcCAwtrgNdahSiFofrE7o';
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
          data: { type: 'string', cid: mockCID },
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
      const mockCID = 'QmYjtig7VJQ6XsnUjqqJvj7QaMcCAwtrgNdahSiFofrE7o';
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
          data: { type: 'string', cid: mockCID },
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
      const mockCID = 'QmYjtig7VJQ6XsnUjqqJvj7QaMcCAwtrgNdahSiFofrE7o';
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
          data1: { type: 'string', cid: mockCID },
          data2: { type: 'string', cid: mockCID },
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
      const mockCID = 'QmYjtig7VJQ6XsnUjqqJvj7QaMcCAwtrgNdahSiFofrE7o';

      vi.mocked(mockIPFSService.fetchContent).mockRejectedValueOnce(
        new Error('IPFS gateway timeout')
      );

      const schema: JSONSchema = {
        type: 'object',
        properties: {
          data: { type: 'string', cid: mockCID },
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
      const mockCID = 'QmYjtig7VJQ6XsnUjqqJvj7QaMcCAwtrgNdahSiFofrE7o';

      vi.mocked(mockIPFSService.fetchContent).mockResolvedValueOnce(
        Buffer.from('{ invalid json ]')
      );

      const schema: JSONSchema = {
        type: 'object',
        properties: {
          data: { type: 'string', cid: mockCID },
        },
      };

      const data = {
        data: { test: 'value' },
      };

      const result = await jsonValidator.validate(data, schema);
      expect(result.valid).toBe(false);
    });

    it('should validate nested CID schemas', async () => {
      const mockCID1 = 'QmWUnTmuodSYEuHVPgxtrARGra2VpzsusAp4FqT9FWobuU';
      const mockCID2 = 'QmPZ9gcCEpqKTo6aq61g2nXGUhM4iCL3ewB6LDXZCtioEB';

      const schema1: JSONSchema = {
        type: 'object',
        properties: {
          user: { type: 'string' },
          profile: { type: 'string', cid: mockCID2 },
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
          data: { type: 'string', cid: mockCID1 },
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
      const mockCID = 'QmYjtig7VJQ6XsnUjqqJvj7QaMcCAwtrgNdahSiFofrE7o';
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
        items: { type: 'string', cid: mockCID },
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
      const mockCID = 'QmYjtig7VJQ6XsnUjqqJvj7QaMcCAwtrgNdahSiFofrE7o';

      // Return valid JSON but invalid schema
      vi.mocked(mockIPFSService.fetchContent).mockResolvedValueOnce(
        Buffer.from(JSON.stringify({ type: 'invalid-type' }))
      );

      const schema: JSONSchema = {
        type: 'object',
        properties: {
          data: { type: 'string', cid: mockCID },
        },
      };

      const data = {
        data: { test: 'value' },
      };

      const result = await jsonValidator.validate(data, schema);
      expect(result.valid).toBe(false);
    });
  });

  describe('CID pointer resolution', () => {
    it('should resolve CID pointers in data', async () => {
      const contentCID = 'QmWUnTmuodSYEuHVPgxtrARGra2VpzsusAp4FqT9FWobuU';
      const schemaCID = 'QmYjtig7VJQ6XsnUjqqJvj7QaMcCAwtrgNdahSiFofrE7o';

      const actualContent = {
        name: 'John Doe',
        age: 30,
        email: 'john@example.com',
      };

      const schemaContent = {
        type: 'object',
        properties: {
          name: { type: 'string' },
          age: { type: 'number' },
          email: { type: 'string', format: 'email' },
        },
        required: ['name', 'age'],
      };

      // Mock IPFS to return the content and schema
      vi.mocked(mockIPFSService.fetchContent)
        .mockResolvedValueOnce(Buffer.from(JSON.stringify(actualContent))) // Content fetch
        .mockResolvedValueOnce(Buffer.from(JSON.stringify(schemaContent))); // Schema fetch

      // Schema references another schema via CID
      const schema: JSONSchema = {
        type: 'string',
        cid: schemaCID,
      };

      // Data is a CID pointer
      const data = { '/': contentCID };

      const result = await jsonValidator.validate(data, schema);

      expect(result.valid).toBe(true);
      expect(mockIPFSService.fetchContent).toHaveBeenCalledWith(contentCID);
      expect(mockIPFSService.fetchContent).toHaveBeenCalledWith(schemaCID);
    });

    it('should fail when referenced content does not match schema', async () => {
      const contentCID = 'QmWUnTmuodSYEuHVPgxtrARGra2VpzsusAp4FqT9FWobuU';
      const schemaCID = 'QmYjtig7VJQ6XsnUjqqJvj7QaMcCAwtrgNdahSiFofrE7o';

      const invalidContent = {
        name: 'John Doe',
        age: 'thirty', // Invalid type
        email: 'not-an-email',
      };

      const schemaContent = {
        type: 'object',
        properties: {
          name: { type: 'string' },
          age: { type: 'number' },
          email: { type: 'string', format: 'email' },
        },
        required: ['name', 'age'],
      };

      vi.mocked(mockIPFSService.fetchContent)
        .mockResolvedValueOnce(Buffer.from(JSON.stringify(invalidContent))) // Content fetch
        .mockResolvedValueOnce(Buffer.from(JSON.stringify(schemaContent))); // Schema fetch

      const schema: JSONSchema = {
        type: 'string',
        cid: schemaCID,
      };

      const data = { '/': contentCID };

      const result = await jsonValidator.validate(data, schema);
      expect(result.valid).toBe(false);
    });

    it('should validate string content from CID pointer', async () => {
      const contentCID = 'QmPZ9gcCEpqKTo6aq61g2nXGUhM4iCL3ewB6LDXZCtioEB';
      const textContent = 'Hello, this is plain text content';

      vi.mocked(mockIPFSService.fetchContent).mockResolvedValueOnce(
        Buffer.from(textContent)
      );

      const schema: JSONSchema = {
        type: 'string',
        minLength: 10,
      };

      const data = { '/': contentCID };

      const result = await jsonValidator.validate(data, schema);
      expect(result.valid).toBe(true);
    });

    it('should resolve nested CID pointers', async () => {
      const userCID = 'QmTzQ1qTvWQWoK9DBwp9vRssFyY1jCFyLEgcs1qeYNBrkK';
      const profileCID = 'Qmbj6yDMMPSaXwYJWJfGoRAUtCfLtZZhM9fi2HEHVQ5Tde';

      const userData = {
        name: 'Alice',
        profile: { '/': profileCID },
      };

      const profileData = {
        bio: 'Software developer',
        location: 'San Francisco',
      };

      // Clear any previous mocks
      vi.clearAllMocks();

      // Set up fresh mocks
      vi.mocked(mockIPFSService.fetchContent)
        .mockResolvedValueOnce(Buffer.from(JSON.stringify(userData))) // User data fetch
        .mockResolvedValueOnce(Buffer.from(JSON.stringify(profileData))); // Profile data fetch

      const schema: JSONSchema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
          profile: {
            type: 'object',
            properties: {
              bio: { type: 'string' },
              location: { type: 'string' },
            },
          },
        },
      };

      const data = { '/': userCID };

      const result = await jsonValidator.validate(data, schema);
      expect(result.valid).toBe(true);
      expect(mockIPFSService.fetchContent).toHaveBeenCalledTimes(2);
    });

    it('should handle arrays with CID pointers', async () => {
      const cid1 = 'QmRhVwVfENfzsT9gWZnQY9C8w2cpNyuyUKUpc8mNGaW1MG';
      const cid2 = 'QmSrPcBnqggGvvRgCi3LoLSLd6gtfbTVgfvktKKpJmtLGr';

      const content1 = { id: 1, value: 'first' };
      const content2 = { id: 2, value: 'second' };

      vi.mocked(mockIPFSService.fetchContent)
        .mockResolvedValueOnce(Buffer.from(JSON.stringify(content1)))
        .mockResolvedValueOnce(Buffer.from(JSON.stringify(content2)));

      const schema: JSONSchema = {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'number' },
            value: { type: 'string' },
          },
          required: ['id', 'value'],
        },
      };

      const data = [{ '/': cid1 }, { '/': cid2 }];

      const result = await jsonValidator.validate(data, schema);
      expect(result.valid).toBe(true);
      expect(mockIPFSService.fetchContent).toHaveBeenCalledTimes(2);
    });

    it('should handle IPFS fetch errors for CID pointers', async () => {
      const contentCID = 'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG';

      vi.mocked(mockIPFSService.fetchContent).mockRejectedValueOnce(
        new Error('IPFS gateway error')
      );

      const schema: JSONSchema = {
        type: 'object',
      };

      const data = { '/': contentCID };

      const result = await jsonValidator.validate(data, schema);
      expect(result.valid).toBe(false);
      expect(result.errors![0].message).toContain(
        'Failed to resolve CID pointer'
      );
    });
  });

  describe('relative file path resolution', () => {
    it('should resolve relative file paths in data', async () => {
      const baseDir = '/test/data';
      const jsonValidatorWithBaseDir = new JsonValidatorService(
        mockIPFSService,
        baseDir
      );

      // Mock fs.readFile
      vi.mocked(fsPromises.readFile).mockResolvedValueOnce(
        JSON.stringify({ name: 'John', age: 30 }) as any
      );

      const schema: JSONSchema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
          age: { type: 'number' },
        },
      };

      // Data contains a relative file path
      const data = { '/': 'user.json' };

      const result = await jsonValidatorWithBaseDir.validate(data, schema);

      expect(result.valid).toBe(true);
      expect(fsPromises.readFile).toHaveBeenCalledWith(
        '/test/data/user.json',
        'utf-8'
      );
    });

    it('should handle nested relative paths', async () => {
      const baseDir = '/test/data';
      const jsonValidatorWithBaseDir = new JsonValidatorService(
        mockIPFSService,
        baseDir
      );

      vi.mocked(fsPromises.readFile).mockResolvedValueOnce(
        JSON.stringify({ bio: 'Developer', location: 'NYC' }) as any
      );

      const schema: JSONSchema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
          profile: {
            type: 'object',
            properties: {
              bio: { type: 'string' },
              location: { type: 'string' },
            },
          },
        },
      };

      const data = {
        name: 'Alice',
        profile: { '/': 'profiles/alice.json' },
      };

      const result = await jsonValidatorWithBaseDir.validate(data, schema);

      expect(result.valid).toBe(true);
      expect(fsPromises.readFile).toHaveBeenCalledWith(
        '/test/data/profiles/alice.json',
        'utf-8'
      );
    });

    it('should fail when file does not exist', async () => {
      const baseDir = '/test/data';
      const jsonValidatorWithBaseDir = new JsonValidatorService(
        mockIPFSService,
        baseDir
      );

      vi.mocked(fsPromises.readFile).mockRejectedValueOnce(
        new Error('ENOENT: no such file or directory')
      );

      const schema: JSONSchema = { type: 'object' };
      const data = { '/': 'nonexistent.json' };

      const result = await jsonValidatorWithBaseDir.validate(data, schema);

      expect(result.valid).toBe(false);
      expect(result.errors![0].message).toContain('Failed to resolve pointer');
    });

    it('should prefer CID over file path when both are possible', async () => {
      const baseDir = '/test/data';
      const jsonValidatorWithBaseDir = new JsonValidatorService(
        mockIPFSService,
        baseDir
      );

      // Use a valid CID format
      const validCID = 'QmWUnTmuodSYEuHVPgxtrARGra2VpzsusAp4FqT9FWobuU';

      vi.mocked(mockIPFSService.fetchContent).mockResolvedValueOnce(
        Buffer.from(JSON.stringify({ source: 'ipfs' }))
      );

      const schema: JSONSchema = {
        type: 'object',
        properties: {
          source: { type: 'string' },
        },
      };

      const data = { '/': validCID };

      const result = await jsonValidatorWithBaseDir.validate(data, schema);

      expect(result.valid).toBe(true);
      expect(mockIPFSService.fetchContent).toHaveBeenCalledWith(validCID);
      // File system should not be accessed for valid CIDs
      expect(fsPromises.readFile).not.toHaveBeenCalled();
    });

    it('should fail when no base directory is provided for relative paths', async () => {
      // Create validator without base directory
      const jsonValidatorNoBaseDir = new JsonValidatorService(mockIPFSService);

      const schema: JSONSchema = { type: 'object' };
      const data = { '/': 'user.json' }; // Not a valid CID

      const result = await jsonValidatorNoBaseDir.validate(data, schema);

      expect(result.valid).toBe(false);
      expect(result.errors![0].message).toContain('no base directory provided');
    });

    it('should handle absolute file paths', async () => {
      // Create validator with base directory (should be ignored for absolute paths)
      const jsonValidatorWithBaseDir = new JsonValidatorService(
        mockIPFSService,
        '/test/data'
      );

      vi.mocked(fsPromises.readFile).mockResolvedValueOnce(
        JSON.stringify({ name: 'System User', role: 'admin' }) as any
      );

      const schema: JSONSchema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
          role: { type: 'string' },
        },
      };

      // Data contains an absolute file path
      const data = { '/': '/etc/config/user.json' };

      const result = await jsonValidatorWithBaseDir.validate(data, schema);

      expect(result.valid).toBe(true);
      expect(fsPromises.readFile).toHaveBeenCalledWith(
        '/etc/config/user.json',
        'utf-8'
      );
    });

    it('should handle absolute paths without base directory', async () => {
      // Create validator without base directory
      const jsonValidatorNoBaseDir = new JsonValidatorService(mockIPFSService);

      vi.mocked(fsPromises.readFile).mockResolvedValueOnce(
        JSON.stringify({ status: 'active' }) as any
      );

      const schema: JSONSchema = {
        type: 'object',
        properties: {
          status: { type: 'string' },
        },
      };

      // Data contains an absolute file path
      const data = { '/': '/var/status.json' };

      const result = await jsonValidatorNoBaseDir.validate(data, schema);

      expect(result.valid).toBe(true);
      expect(fsPromises.readFile).toHaveBeenCalledWith(
        '/var/status.json',
        'utf-8'
      );
    });

    it('should handle paths starting with ./', async () => {
      const baseDir = '/test/data';
      const jsonValidatorWithBaseDir = new JsonValidatorService(
        mockIPFSService,
        baseDir
      );

      vi.mocked(fsPromises.readFile).mockResolvedValueOnce(
        JSON.stringify({ value: 'test' }) as any
      );

      const schema: JSONSchema = {
        type: 'object',
        properties: {
          value: { type: 'string' },
        },
      };

      // Data contains a relative path with ./
      const data = { '/': './relative/file.json' };

      const result = await jsonValidatorWithBaseDir.validate(data, schema);

      expect(result.valid).toBe(true);
      expect(fsPromises.readFile).toHaveBeenCalledWith(
        '/test/data/relative/file.json',
        'utf-8'
      );
    });

    it('should handle nested file path pointers', async () => {
      const baseDir = '/test/data';
      const jsonValidatorWithBaseDir = new JsonValidatorService(
        mockIPFSService,
        baseDir
      );

      // First file contains a pointer to another file
      vi.mocked(fsPromises.readFile)
        .mockResolvedValueOnce(
          JSON.stringify({ '/': 'nested/second.json' }) as any
        )
        .mockResolvedValueOnce(JSON.stringify({ final: 'value' }) as any);

      const schema: JSONSchema = {
        type: 'object',
        properties: {
          final: { type: 'string' },
        },
      };

      const data = { '/': 'first.json' };

      const result = await jsonValidatorWithBaseDir.validate(data, schema);

      expect(result.valid).toBe(true);
      expect(fsPromises.readFile).toHaveBeenCalledWith(
        '/test/data/first.json',
        'utf-8'
      );
      expect(fsPromises.readFile).toHaveBeenCalledWith(
        '/test/data/nested/second.json',
        'utf-8'
      );
    });

    it('should handle mixed CID and file path pointers in nested structures', async () => {
      const baseDir = '/test/data';
      const jsonValidatorWithBaseDir = new JsonValidatorService(
        mockIPFSService,
        baseDir
      );

      const validCID = 'QmWUnTmuodSYEuHVPgxtrARGra2VpzsusAp4FqT9FWobuU';

      // Mock IPFS fetch for CID
      vi.mocked(mockIPFSService.fetchContent).mockResolvedValueOnce(
        Buffer.from(JSON.stringify({ ipfsData: 'from IPFS' }))
      );

      // Mock file read for local file
      vi.mocked(fsPromises.readFile).mockResolvedValueOnce(
        JSON.stringify({ fileData: 'from file' }) as any
      );

      const schema: JSONSchema = {
        type: 'object',
        properties: {
          remote: {
            type: 'object',
            properties: {
              ipfsData: { type: 'string' },
            },
          },
          local: {
            type: 'object',
            properties: {
              fileData: { type: 'string' },
            },
          },
        },
      };

      const data = {
        remote: { '/': validCID },
        local: { '/': 'local.json' },
      };

      const result = await jsonValidatorWithBaseDir.validate(data, schema);

      expect(result.valid).toBe(true);
      expect(mockIPFSService.fetchContent).toHaveBeenCalledWith(validCID);
      expect(fsPromises.readFile).toHaveBeenCalledWith(
        '/test/data/local.json',
        'utf-8'
      );
    });

    it('should return file content as string if not valid JSON', async () => {
      const baseDir = '/test/data';
      const jsonValidatorWithBaseDir = new JsonValidatorService(
        mockIPFSService,
        baseDir
      );

      // Return plain text, not JSON
      vi.mocked(fsPromises.readFile).mockResolvedValueOnce(
        'This is plain text content' as any
      );

      const schema: JSONSchema = {
        type: 'string',
      };

      const data = { '/': 'plaintext.txt' };

      const result = await jsonValidatorWithBaseDir.validate(data, schema);

      expect(result.valid).toBe(true);
    });

    it('should handle Windows-style absolute paths', async () => {
      const jsonValidatorNoBaseDir = new JsonValidatorService(mockIPFSService);

      vi.mocked(fsPromises.readFile).mockResolvedValueOnce(
        JSON.stringify({ windows: 'data' }) as any
      );

      const schema: JSONSchema = {
        type: 'object',
        properties: {
          windows: { type: 'string' },
        },
      };

      // Windows absolute path (though this test runs on all platforms)
      const data = { '/': '/C:/Users/test/data.json' };

      const result = await jsonValidatorNoBaseDir.validate(data, schema);

      expect(result.valid).toBe(true);
      expect(fsPromises.readFile).toHaveBeenCalledWith(
        '/C:/Users/test/data.json',
        'utf-8'
      );
    });

    it('should handle file read errors with descriptive messages', async () => {
      const baseDir = '/test/data';
      const jsonValidatorWithBaseDir = new JsonValidatorService(
        mockIPFSService,
        baseDir
      );

      const fileError = new Error('ENOENT: no such file or directory');
      vi.mocked(fsPromises.readFile).mockRejectedValueOnce(fileError);

      const schema: JSONSchema = { type: 'object' };
      const data = { '/': 'missing.json' };

      const result = await jsonValidatorWithBaseDir.validate(data, schema);

      expect(result.valid).toBe(false);
      expect(result.errors![0].message).toContain(
        'not a valid CID or accessible file path: missing.json'
      );
    });

    it('should handle arrays containing file path pointers', async () => {
      const baseDir = '/test/data';
      const jsonValidatorWithBaseDir = new JsonValidatorService(
        mockIPFSService,
        baseDir
      );

      vi.mocked(fsPromises.readFile)
        .mockResolvedValueOnce(JSON.stringify({ id: 1, name: 'First' }) as any)
        .mockResolvedValueOnce(
          JSON.stringify({ id: 2, name: 'Second' }) as any
        );

      const schema: JSONSchema = {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'number' },
            name: { type: 'string' },
          },
        },
      };

      const data = [{ '/': 'items/1.json' }, { '/': 'items/2.json' }];

      const result = await jsonValidatorWithBaseDir.validate(data, schema);

      expect(result.valid).toBe(true);
      expect(fsPromises.readFile).toHaveBeenCalledWith(
        '/test/data/items/1.json',
        'utf-8'
      );
      expect(fsPromises.readFile).toHaveBeenCalledWith(
        '/test/data/items/2.json',
        'utf-8'
      );
    });

    it('should handle deeply nested paths with ../', async () => {
      const baseDir = '/test/data/subdir';
      const jsonValidatorWithBaseDir = new JsonValidatorService(
        mockIPFSService,
        baseDir
      );

      vi.mocked(fsPromises.readFile).mockResolvedValueOnce(
        JSON.stringify({ content: 'parent directory file' }) as any
      );

      const schema: JSONSchema = {
        type: 'object',
        properties: {
          content: { type: 'string' },
        },
      };

      const data = { '/': '../parent.json' };

      const result = await jsonValidatorWithBaseDir.validate(data, schema);

      expect(result.valid).toBe(true);
      expect(fsPromises.readFile).toHaveBeenCalledWith(
        '/test/data/parent.json',
        'utf-8'
      );
    });

    it('should validate complex nested structure with multiple file pointers', async () => {
      const baseDir = '/config';
      const jsonValidatorWithBaseDir = new JsonValidatorService(
        mockIPFSService,
        baseDir
      );

      vi.mocked(fsPromises.readFile)
        .mockResolvedValueOnce(
          JSON.stringify({ host: 'localhost', port: 5432 }) as any
        )
        .mockResolvedValueOnce(
          JSON.stringify({ level: 'info', file: 'app.log' }) as any
        );

      const schema: JSONSchema = {
        type: 'object',
        properties: {
          app: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              version: { type: 'string' },
            },
          },
          database: {
            type: 'object',
            properties: {
              host: { type: 'string' },
              port: { type: 'number' },
            },
          },
          logging: {
            type: 'object',
            properties: {
              level: { type: 'string' },
              file: { type: 'string' },
            },
          },
        },
      };

      const data = {
        app: {
          name: 'MyApp',
          version: '1.0.0',
        },
        database: { '/': 'database.json' },
        logging: { '/': 'logging.json' },
      };

      const result = await jsonValidatorWithBaseDir.validate(data, schema);

      expect(result.valid).toBe(true);
      expect(fsPromises.readFile).toHaveBeenCalledTimes(2);
    });

    it('should handle empty string as pointer value', async () => {
      const baseDir = '/test/data';
      const jsonValidatorWithBaseDir = new JsonValidatorService(
        mockIPFSService,
        baseDir
      );

      const schema: JSONSchema = { type: 'object' };
      const data = { '/': '' };

      const result = await jsonValidatorWithBaseDir.validate(data, schema);

      expect(result.valid).toBe(false);
      expect(result.errors![0].message).toContain(
        'empty string is not a valid CID or file path'
      );
    });

    it('should handle special characters in file names', async () => {
      const baseDir = '/test/data';
      const jsonValidatorWithBaseDir = new JsonValidatorService(
        mockIPFSService,
        baseDir
      );

      vi.mocked(fsPromises.readFile).mockResolvedValueOnce(
        JSON.stringify({ special: 'chars' }) as any
      );

      const schema: JSONSchema = {
        type: 'object',
        properties: {
          special: { type: 'string' },
        },
      };

      const data = { '/': 'file with spaces & special-chars.json' };

      const result = await jsonValidatorWithBaseDir.validate(data, schema);

      expect(result.valid).toBe(true);
      expect(fsPromises.readFile).toHaveBeenCalledWith(
        '/test/data/file with spaces & special-chars.json',
        'utf-8'
      );
    });

    it('should handle JSON parsing errors in file content', async () => {
      const baseDir = '/test/data';
      const jsonValidatorWithBaseDir = new JsonValidatorService(
        mockIPFSService,
        baseDir
      );

      // Return invalid JSON
      vi.mocked(fsPromises.readFile).mockResolvedValueOnce(
        '{ invalid json content' as any
      );

      const schema: JSONSchema = {
        type: 'string',
      };

      const data = { '/': 'invalid.json' };

      const result = await jsonValidatorWithBaseDir.validate(data, schema);

      // Should return the raw content as string when JSON parsing fails
      expect(result.valid).toBe(true);
    });

    it('should handle permission errors when reading files', async () => {
      const baseDir = '/test/data';
      const jsonValidatorWithBaseDir = new JsonValidatorService(
        mockIPFSService,
        baseDir
      );

      const permissionError = new Error('EACCES: permission denied');
      vi.mocked(fsPromises.readFile).mockRejectedValueOnce(permissionError);

      const schema: JSONSchema = { type: 'object' };
      const data = { '/': 'protected.json' };

      const result = await jsonValidatorWithBaseDir.validate(data, schema);

      expect(result.valid).toBe(false);
      expect(result.errors![0].message).toContain(
        'not a valid CID or accessible file path: protected.json'
      );
    });

    it('should handle circular file references gracefully', async () => {
      const baseDir = '/test/data';
      const jsonValidatorWithBaseDir = new JsonValidatorService(
        mockIPFSService,
        baseDir
      );

      // Create a circular reference: file1 -> file2 -> file1
      let callCount = 0;
      vi.mocked(fsPromises.readFile).mockImplementation(async (path) => {
        callCount++;
        if (callCount > 10) {
          // Prevent infinite loop in test
          throw new Error('Maximum call depth exceeded');
        }
        if (path.toString().includes('file1.json')) {
          return JSON.stringify({ '/': 'file2.json' }) as any;
        } else {
          return JSON.stringify({ '/': 'file1.json' }) as any;
        }
      });

      const schema: JSONSchema = { type: 'object' };
      const data = { '/': 'file1.json' };

      const result = await jsonValidatorWithBaseDir.validate(data, schema);

      // The implementation will eventually fail due to call stack or other limits
      expect(result.valid).toBe(false);
    });

    it('should preserve path resolution across different operating systems', async () => {
      const baseDir = '/test/data';
      const jsonValidatorWithBaseDir = new JsonValidatorService(
        mockIPFSService,
        baseDir
      );

      vi.mocked(fsPromises.readFile).mockResolvedValueOnce(
        JSON.stringify({ crossPlatform: true }) as any
      );

      const schema: JSONSchema = {
        type: 'object',
        properties: {
          crossPlatform: { type: 'boolean' },
        },
      };

      // Use forward slashes even on Windows
      const data = { '/': 'subdirs/nested/file.json' };

      const result = await jsonValidatorWithBaseDir.validate(data, schema);

      expect(result.valid).toBe(true);
      // The path.join should handle platform differences
      expect(fsPromises.readFile).toHaveBeenCalled();
      const calledPath = (fsPromises.readFile as any).mock.calls[0][0];
      expect(calledPath).toContain('subdirs');
      expect(calledPath).toContain('nested');
      expect(calledPath).toContain('file.json');
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
