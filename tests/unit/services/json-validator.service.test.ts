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
      expect(result2.errors![0].message).toContain(
        'must be a valid email address'
      );
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
      const message = jsonValidator.getErrorMessages(result.errors || [])[0];

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
      const message = jsonValidator.getErrorMessages(result.errors || [])[0];

      expect(message).toContain('required property');
      // AJV might report errors in different order, so check that we have multiple errors
      expect(result.errors!.length).toBeGreaterThan(1);
    });

    it('should handle empty errors', () => {
      const message = jsonValidator.getErrorMessages([])[0];
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
        expect(result.errors![0].message).toContain(
          'must be a valid IPFS Content Identifier (CID)'
        );
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
    it('should resolve CID pointers in data when property schema is a CID link', async () => {
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
        .mockResolvedValueOnce(Buffer.from(JSON.stringify(schemaContent))) // Schema fetch first
        .mockResolvedValueOnce(Buffer.from(JSON.stringify(actualContent))); // Content fetch second

      // Schema has a property that references another schema via CID
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          user: {
            type: 'string',
            cid: schemaCID,
          },
        },
      };

      // Data has a CID pointer in the user property
      const data = { user: { '/': contentCID } };

      const result = await jsonValidator.validate(data, schema);

      expect(result.valid).toBe(true);
      expect(mockIPFSService.fetchContent).toHaveBeenCalledWith(contentCID);
      expect(mockIPFSService.fetchContent).toHaveBeenCalledWith(schemaCID);
    });

    it('should reject root schema that is a CID link', async () => {
      const schemaCID = 'QmYjtig7VJQ6XsnUjqqJvj7QaMcCAwtrgNdahSiFofrE7o';

      // Root schema is a CID link (not allowed)
      const schema: JSONSchema = {
        type: 'string',
        cid: schemaCID,
      };

      const data = { test: 'value' };

      const result = await jsonValidator.validate(data, schema);

      expect(result.valid).toBe(false);
      expect(result.errors![0].message).toContain(
        'Root schema cannot be a CID link'
      );
      // IPFS should not be called
      expect(mockIPFSService.fetchContent).not.toHaveBeenCalled();
    });

    it('should NOT resolve CID pointers when schema is not a CID link', async () => {
      const contentCID = 'QmWUnTmuodSYEuHVPgxtrARGra2VpzsusAp4FqT9FWobuU';

      // Schema is a regular object schema, not a CID link
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          '/': { type: 'string' },
        },
      };

      // Data is a CID pointer
      const data = { '/': contentCID };

      const result = await jsonValidator.validate(data, schema);

      // Should validate the pointer object as-is, not resolve it
      expect(result.valid).toBe(true);
      // IPFS should not be called since pointer is not resolved
      expect(mockIPFSService.fetchContent).not.toHaveBeenCalled();
    });

    it('should NOT resolve file path pointers when schema is not a CID link', async () => {
      const baseDir = '/test/data';
      const jsonValidatorWithBaseDir = new JsonValidatorService(
        mockIPFSService,
        baseDir
      );

      // Schema is a regular object schema, not a CID link
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          '/': { type: 'string' },
        },
      };

      // Data is a file path pointer
      const data = { '/': './user.json' };

      const result = await jsonValidatorWithBaseDir.validate(data, schema);

      // Should validate the pointer object as-is, not resolve it
      expect(result.valid).toBe(true);
      // File system should not be accessed since pointer is not resolved
      expect(fsPromises.readFile).not.toHaveBeenCalled();
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
        .mockResolvedValueOnce(Buffer.from(JSON.stringify(schemaContent))) // Schema fetch first
        .mockResolvedValueOnce(Buffer.from(JSON.stringify(invalidContent))); // Content fetch second

      const schema: JSONSchema = {
        type: 'object',
        properties: {
          user: {
            type: 'string',
            cid: schemaCID,
          },
        },
      };

      const data = { user: { '/': contentCID } };

      const result = await jsonValidator.validate(data, schema);
      expect(result.valid).toBe(false);
    });

    it('should validate string content from CID pointer when property schema is a CID link', async () => {
      const contentCID = 'QmPZ9gcCEpqKTo6aq61g2nXGUhM4iCL3ewB6LDXZCtioEB';
      const schemaCID = 'QmYjtig7VJQ6XsnUjqqJvj7QaMcCAwtrgNdahSiFofrE7o';
      const textContent = 'Hello, this is plain text content';

      const schemaContent = {
        type: 'string',
        minLength: 10,
      };

      vi.mocked(mockIPFSService.fetchContent)
        .mockResolvedValueOnce(Buffer.from(JSON.stringify(schemaContent)))
        .mockResolvedValueOnce(Buffer.from(textContent));

      const schema: JSONSchema = {
        type: 'object',
        properties: {
          content: {
            type: 'string',
            cid: schemaCID,
          },
        },
      };

      const data = { content: { '/': contentCID } };

      const result = await jsonValidator.validate(data, schema);
      expect(result.valid).toBe(true);
    });

    it('should resolve nested CID pointers when nested schema is a CID link', async () => {
      const userCID = 'QmTzQ1qTvWQWoK9DBwp9vRssFyY1jCFyLEgcs1qeYNBrkK';
      const profileCID = 'Qmbj6yDMMPSaXwYJWJfGoRAUtCfLtZZhM9fi2HEHVQ5Tde';
      const userSchemaCID = 'QmWUnTmuodSYEuHVPgxtrARGra2VpzsusAp4FqT9FWobuU';
      const profileSchemaCID = 'QmYjtig7VJQ6XsnUjqqJvj7QaMcCAwtrgNdahSiFofrE7o';

      const userData = {
        name: 'Alice',
        profile: { '/': profileCID },
      };

      const profileData = {
        bio: 'Software developer',
        location: 'San Francisco',
      };

      const userSchemaData = {
        type: 'object',
        properties: {
          name: { type: 'string' },
          profile: {
            type: 'string',
            cid: profileSchemaCID,
          },
        },
      };

      const profileSchemaData = {
        type: 'object',
        properties: {
          bio: { type: 'string' },
          location: { type: 'string' },
        },
      };

      // Clear any previous mocks
      vi.clearAllMocks();

      // Set up fresh mocks
      vi.mocked(mockIPFSService.fetchContent)
        .mockResolvedValueOnce(Buffer.from(JSON.stringify(userSchemaData))) // User schema fetch first
        .mockResolvedValueOnce(Buffer.from(JSON.stringify(profileSchemaData))) // Profile schema fetch second
        .mockResolvedValueOnce(Buffer.from(JSON.stringify(userData))) // User data fetch third
        .mockResolvedValueOnce(Buffer.from(JSON.stringify(profileData))); // Profile data fetch fourth

      const schema: JSONSchema = {
        type: 'object',
        properties: {
          user: {
            type: 'string',
            cid: userSchemaCID,
          },
        },
      };

      const data = { user: { '/': userCID } };

      const result = await jsonValidator.validate(data, schema);
      expect(result.valid).toBe(true);
      expect(mockIPFSService.fetchContent).toHaveBeenCalledTimes(4);
    });

    it('should NOT resolve nested CID pointers when nested schema is not a CID link', async () => {
      const userCID = 'QmTzQ1qTvWQWoK9DBwp9vRssFyY1jCFyLEgcs1qeYNBrkK';
      const profileCID = 'Qmbj6yDMMPSaXwYJWJfGoRAUtCfLtZZhM9fi2HEHVQ5Tde';
      const userSchemaCID = 'QmWUnTmuodSYEuHVPgxtrARGra2VpzsusAp4FqT9FWobuU';

      const userData = {
        name: 'Alice',
        profile: { '/': profileCID },
      };

      const userSchemaData = {
        type: 'object',
        properties: {
          name: { type: 'string' },
          profile: {
            type: 'object',
            properties: {
              '/': { type: 'string' },
            },
          },
        },
      };

      // Clear any previous mocks
      vi.clearAllMocks();

      // Set up fresh mocks
      vi.mocked(mockIPFSService.fetchContent)
        .mockResolvedValueOnce(Buffer.from(JSON.stringify(userSchemaData))) // User schema fetch first
        .mockResolvedValueOnce(Buffer.from(JSON.stringify(userData))); // User data fetch second

      const schema: JSONSchema = {
        type: 'object',
        properties: {
          user: {
            type: 'string',
            cid: userSchemaCID,
          },
        },
      };

      const data = { user: { '/': userCID } };

      const result = await jsonValidator.validate(data, schema);
      expect(result.valid).toBe(true);
      // Should only fetch 2 times: user data and user schema, not profile data
      expect(mockIPFSService.fetchContent).toHaveBeenCalledTimes(2);
    });

    it('should handle arrays with CID pointers when items schema is a CID link', async () => {
      const cid1 = 'QmRhVwVfENfzsT9gWZnQY9C8w2cpNyuyUKUpc8mNGaW1MG';
      const cid2 = 'QmSrPcBnqggGvvRgCi3LoLSLd6gtfbTVgfvktKKpJmtLGr';
      const schemaCID = 'QmYjtig7VJQ6XsnUjqqJvj7QaMcCAwtrgNdahSiFofrE7o';

      const content1 = { id: 1, value: 'first' };
      const content2 = { id: 2, value: 'second' };
      const itemSchema = {
        type: 'object',
        properties: {
          id: { type: 'number' },
          value: { type: 'string' },
        },
        required: ['id', 'value'],
      };

      vi.mocked(mockIPFSService.fetchContent)
        .mockResolvedValueOnce(Buffer.from(JSON.stringify(itemSchema))) // Item schema first
        .mockResolvedValueOnce(Buffer.from(JSON.stringify(content1))) // Content 1 second
        .mockResolvedValueOnce(Buffer.from(JSON.stringify(content2))); // Content 2 third

      const schema: JSONSchema = {
        type: 'array',
        items: {
          type: 'string',
          cid: schemaCID,
        },
      };

      const data = [{ '/': cid1 }, { '/': cid2 }];

      const result = await jsonValidator.validate(data, schema);
      expect(result.valid).toBe(true);
      expect(mockIPFSService.fetchContent).toHaveBeenCalledTimes(3);
    });

    it('should NOT resolve CID pointers in arrays when items schema is not a CID link', async () => {
      const cid1 = 'QmRhVwVfENfzsT9gWZnQY9C8w2cpNyuyUKUpc8mNGaW1MG';
      const cid2 = 'QmSrPcBnqggGvvRgCi3LoLSLd6gtfbTVgfvktKKpJmtLGr';

      const schema: JSONSchema = {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            '/': { type: 'string' },
          },
        },
      };

      const data = [{ '/': cid1 }, { '/': cid2 }];

      const result = await jsonValidator.validate(data, schema);
      expect(result.valid).toBe(true);
      // IPFS should not be called since pointers are not resolved
      expect(mockIPFSService.fetchContent).not.toHaveBeenCalled();
    });

    it('should handle IPFS fetch errors for CID pointers', async () => {
      const contentCID = 'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG';
      const schemaCID = 'QmPZ9gcCEpqKTo6aq61g2nXGUhM4iCL3ewB6LDXZCtioEB';

      // Mock schema resolution to succeed, then data CID resolution to fail
      vi.mocked(mockIPFSService.fetchContent)
        .mockResolvedValueOnce(Buffer.from(JSON.stringify({ type: 'object' }))) // Schema fetch succeeds
        .mockRejectedValueOnce(new Error('IPFS gateway error')); // Data CID fetch fails

      const schema: JSONSchema = {
        type: 'object',
        properties: {
          content: {
            type: 'string',
            cid: schemaCID,
          },
        },
      };

      const data = { content: { '/': contentCID } };

      const result = await jsonValidator.validate(data, schema);
      expect(result.valid).toBe(false);
      expect(result.errors![0].message).toContain(
        'Failed to resolve CID pointer'
      );
    });
  });

  describe('relative file path resolution', () => {
    it('should resolve relative file paths in data when schema is a CID link', async () => {
      const baseDir = '/test/data';
      const jsonValidatorWithBaseDir = new JsonValidatorService(
        mockIPFSService,
        baseDir
      );
      const schemaCID = 'QmYjtig7VJQ6XsnUjqqJvj7QaMcCAwtrgNdahSiFofrE7o';

      // Mock fs.readFile
      vi.mocked(fsPromises.readFile).mockResolvedValueOnce(
        JSON.stringify({ name: 'John', age: 30 }) as any
      );

      const schemaData = {
        type: 'object',
        properties: {
          name: { type: 'string' },
          age: { type: 'number' },
        },
      };

      vi.mocked(mockIPFSService.fetchContent).mockResolvedValueOnce(
        Buffer.from(JSON.stringify(schemaData))
      );

      const schema: JSONSchema = {
        type: 'object',
        properties: {
          user: {
            type: 'string',
            cid: schemaCID,
          },
        },
      };

      // Data contains a relative file path
      const data = { user: { '/': 'user.json' } };

      const result = await jsonValidatorWithBaseDir.validate(data, schema);

      expect(result.valid).toBe(true);
      expect(fsPromises.readFile).toHaveBeenCalledWith(
        '/test/data/user.json',
        'utf-8'
      );
    });

    it('should NOT resolve relative file paths when schema is not a CID link', async () => {
      const baseDir = '/test/data';
      const jsonValidatorWithBaseDir = new JsonValidatorService(
        mockIPFSService,
        baseDir
      );

      const schema: JSONSchema = {
        type: 'object',
        properties: {
          '/': { type: 'string' },
        },
      };

      // Data contains a relative file path
      const data = { '/': 'user.json' };

      const result = await jsonValidatorWithBaseDir.validate(data, schema);

      expect(result.valid).toBe(true);
      // File system should not be accessed since pointer is not resolved
      expect(fsPromises.readFile).not.toHaveBeenCalled();
    });

    it('should handle nested relative paths when nested schema is a CID link', async () => {
      const baseDir = '/test/data';
      const jsonValidatorWithBaseDir = new JsonValidatorService(
        mockIPFSService,
        baseDir
      );
      const profileSchemaCID = 'QmYjtig7VJQ6XsnUjqqJvj7QaMcCAwtrgNdahSiFofrE7o';

      vi.mocked(fsPromises.readFile).mockResolvedValueOnce(
        JSON.stringify({ bio: 'Developer', location: 'NYC' }) as any
      );

      const profileSchemaData = {
        type: 'object',
        properties: {
          bio: { type: 'string' },
          location: { type: 'string' },
        },
      };

      vi.mocked(mockIPFSService.fetchContent).mockResolvedValueOnce(
        Buffer.from(JSON.stringify(profileSchemaData))
      );

      const schema: JSONSchema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
          profile: {
            type: 'string',
            cid: profileSchemaCID,
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

    it('should fail when file does not exist and property schema is a CID link', async () => {
      const baseDir = '/test/data';
      const jsonValidatorWithBaseDir = new JsonValidatorService(
        mockIPFSService,
        baseDir
      );
      const schemaCID = 'QmYjtig7VJQ6XsnUjqqJvj7QaMcCAwtrgNdahSiFofrE7o';

      vi.mocked(fsPromises.readFile).mockRejectedValueOnce(
        new Error('ENOENT: no such file or directory')
      );

      const schemaData = { type: 'object' };
      vi.mocked(mockIPFSService.fetchContent).mockResolvedValueOnce(
        Buffer.from(JSON.stringify(schemaData))
      );

      const schema: JSONSchema = {
        type: 'object',
        properties: {
          content: { type: 'string', cid: schemaCID },
        },
      };
      const data = { content: { '/': 'nonexistent.json' } };

      const result = await jsonValidatorWithBaseDir.validate(data, schema);

      expect(result.valid).toBe(false);
      expect(result.errors![0].message).toContain('Failed to resolve pointer');
    });

    it('should prefer CID over file path when both are possible and schema is a CID link', async () => {
      const baseDir = '/test/data';
      const jsonValidatorWithBaseDir = new JsonValidatorService(
        mockIPFSService,
        baseDir
      );
      const schemaCID = 'QmYjtig7VJQ6XsnUjqqJvj7QaMcCAwtrgNdahSiFofrE7o';

      // Use a valid CID format
      const validCID = 'QmWUnTmuodSYEuHVPgxtrARGra2VpzsusAp4FqT9FWobuU';

      const schemaData = {
        type: 'object',
        properties: {
          source: { type: 'string' },
        },
      };

      vi.mocked(mockIPFSService.fetchContent)
        .mockResolvedValueOnce(Buffer.from(JSON.stringify(schemaData)))
        .mockResolvedValueOnce(Buffer.from(JSON.stringify({ source: 'ipfs' })));

      const schema: JSONSchema = {
        type: 'object',
        properties: {
          content: {
            type: 'string',
            cid: schemaCID,
          },
        },
      };

      const data = { content: { '/': validCID } };

      const result = await jsonValidatorWithBaseDir.validate(data, schema);

      expect(result.valid).toBe(true);
      expect(mockIPFSService.fetchContent).toHaveBeenCalledWith(validCID);
      // File system should not be accessed for valid CIDs
      expect(fsPromises.readFile).not.toHaveBeenCalled();
    });

    it('should fail when no base directory is provided for relative paths and property schema is a CID link', async () => {
      // Create validator without base directory
      const jsonValidatorNoBaseDir = new JsonValidatorService(mockIPFSService);
      const schemaCID = 'QmYjtig7VJQ6XsnUjqqJvj7QaMcCAwtrgNdahSiFofrE7o';

      const schemaData = { type: 'object' };
      vi.mocked(mockIPFSService.fetchContent).mockResolvedValueOnce(
        Buffer.from(JSON.stringify(schemaData))
      );

      const schema: JSONSchema = {
        type: 'object',
        properties: {
          content: { type: 'string', cid: schemaCID },
        },
      };
      const data = { content: { '/': 'user.json' } }; // Not a valid CID

      const result = await jsonValidatorNoBaseDir.validate(data, schema);

      expect(result.valid).toBe(false);
      expect(result.errors![0].message).toContain('no base directory provided');
    });

    it('should handle absolute file paths when schema is a CID link', async () => {
      // Create validator with base directory (should be ignored for absolute paths)
      const jsonValidatorWithBaseDir = new JsonValidatorService(
        mockIPFSService,
        '/test/data'
      );
      const schemaCID = 'QmYjtig7VJQ6XsnUjqqJvj7QaMcCAwtrgNdahSiFofrE7o';

      vi.mocked(fsPromises.readFile).mockResolvedValueOnce(
        JSON.stringify({ name: 'System User', role: 'admin' }) as any
      );

      const schemaData = {
        type: 'object',
        properties: {
          name: { type: 'string' },
          role: { type: 'string' },
        },
      };

      vi.mocked(mockIPFSService.fetchContent).mockResolvedValueOnce(
        Buffer.from(JSON.stringify(schemaData))
      );

      const schema: JSONSchema = {
        type: 'object',
        properties: {
          content: {
            type: 'string',
            cid: schemaCID,
          },
        },
      };

      // Data contains an absolute file path
      const data = { content: { '/': '/etc/config/user.json' } };

      const result = await jsonValidatorWithBaseDir.validate(data, schema);

      expect(result.valid).toBe(true);
      expect(fsPromises.readFile).toHaveBeenCalledWith(
        '/etc/config/user.json',
        'utf-8'
      );
    });

    it('should handle absolute paths without base directory when schema is a CID link', async () => {
      // Create validator without base directory
      const jsonValidatorNoBaseDir = new JsonValidatorService(mockIPFSService);
      const schemaCID = 'QmYjtig7VJQ6XsnUjqqJvj7QaMcCAwtrgNdahSiFofrE7o';

      vi.mocked(fsPromises.readFile).mockResolvedValueOnce(
        JSON.stringify({ status: 'active' }) as any
      );

      const schemaData = {
        type: 'object',
        properties: {
          status: { type: 'string' },
        },
      };

      vi.mocked(mockIPFSService.fetchContent).mockResolvedValueOnce(
        Buffer.from(JSON.stringify(schemaData))
      );

      const schema: JSONSchema = {
        type: 'object',
        properties: {
          content: {
            type: 'string',
            cid: schemaCID,
          },
        },
      };

      // Data contains an absolute file path
      const data = { content: { '/': '/var/status.json' } };

      const result = await jsonValidatorNoBaseDir.validate(data, schema);

      expect(result.valid).toBe(true);
      expect(fsPromises.readFile).toHaveBeenCalledWith(
        '/var/status.json',
        'utf-8'
      );
    });

    it('should handle paths starting with ./ when schema is a CID link', async () => {
      const baseDir = '/test/data';
      const jsonValidatorWithBaseDir = new JsonValidatorService(
        mockIPFSService,
        baseDir
      );
      const schemaCID = 'QmYjtig7VJQ6XsnUjqqJvj7QaMcCAwtrgNdahSiFofrE7o';

      vi.mocked(fsPromises.readFile).mockResolvedValueOnce(
        JSON.stringify({ value: 'test' }) as any
      );

      const schemaData = {
        type: 'object',
        properties: {
          value: { type: 'string' },
        },
      };

      vi.mocked(mockIPFSService.fetchContent).mockResolvedValueOnce(
        Buffer.from(JSON.stringify(schemaData))
      );

      const schema: JSONSchema = {
        type: 'object',
        properties: {
          content: {
            type: 'string',
            cid: schemaCID,
          },
        },
      };

      // Data contains a relative path with ./
      const data = { content: { '/': './relative/file.json' } };

      const result = await jsonValidatorWithBaseDir.validate(data, schema);

      expect(result.valid).toBe(true);
      expect(fsPromises.readFile).toHaveBeenCalledWith(
        '/test/data/relative/file.json',
        'utf-8'
      );
    });

    it('should handle nested file path pointers when schema is a CID link', async () => {
      const baseDir = '/test/data';
      const jsonValidatorWithBaseDir = new JsonValidatorService(
        mockIPFSService,
        baseDir
      );
      const schemaCID = 'QmYjtig7VJQ6XsnUjqqJvj7QaMcCAwtrgNdahSiFofrE7o';

      // First file contains a pointer to another file
      vi.mocked(fsPromises.readFile)
        .mockResolvedValueOnce(
          JSON.stringify({ '/': 'nested/second.json' }) as any
        )
        .mockResolvedValueOnce(JSON.stringify({ final: 'value' }) as any);

      const schemaData = {
        type: 'object',
        properties: {
          final: { type: 'string' },
        },
      };

      vi.mocked(mockIPFSService.fetchContent).mockResolvedValueOnce(
        Buffer.from(JSON.stringify(schemaData))
      );

      const schema: JSONSchema = {
        type: 'object',
        properties: {
          content: {
            type: 'string',
            cid: schemaCID,
          },
        },
      };

      const data = { content: { '/': 'first.json' } };

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

    it('should handle file read errors with descriptive messages when property schema is a CID link', async () => {
      const baseDir = '/test/data';
      const jsonValidatorWithBaseDir = new JsonValidatorService(
        mockIPFSService,
        baseDir
      );
      const schemaCID = 'QmYjtig7VJQ6XsnUjqqJvj7QaMcCAwtrgNdahSiFofrE7o';

      const fileError = new Error('ENOENT: no such file or directory');
      vi.mocked(fsPromises.readFile).mockRejectedValueOnce(fileError);

      const schemaData = { type: 'object' };
      vi.mocked(mockIPFSService.fetchContent).mockResolvedValueOnce(
        Buffer.from(JSON.stringify(schemaData))
      );

      const schema: JSONSchema = {
        type: 'object',
        properties: {
          content: { type: 'string', cid: schemaCID },
        },
      };
      const data = { content: { '/': 'missing.json' } };

      const result = await jsonValidatorWithBaseDir.validate(data, schema);

      expect(result.valid).toBe(false);
      expect(result.errors![0].message).toContain(
        'not a valid CID or accessible file path: missing.json'
      );
    });

    it('should handle empty string as pointer value when property schema is a CID link', async () => {
      const baseDir = '/test/data';
      const jsonValidatorWithBaseDir = new JsonValidatorService(
        mockIPFSService,
        baseDir
      );
      const schemaCID = 'QmYjtig7VJQ6XsnUjqqJvj7QaMcCAwtrgNdahSiFofrE7o';

      const schemaData = { type: 'object' };
      vi.mocked(mockIPFSService.fetchContent).mockResolvedValueOnce(
        Buffer.from(JSON.stringify(schemaData))
      );

      const schema: JSONSchema = {
        type: 'object',
        properties: {
          content: { type: 'string', cid: schemaCID },
        },
      };
      const data = { content: { '/': '' } };

      const result = await jsonValidatorWithBaseDir.validate(data, schema);

      expect(result.valid).toBe(false);
      expect(result.errors![0].message).toContain(
        'empty string is not a valid CID or file path'
      );
    });

    it('should handle permission errors when reading files and property schema is a CID link', async () => {
      const baseDir = '/test/data';
      const jsonValidatorWithBaseDir = new JsonValidatorService(
        mockIPFSService,
        baseDir
      );
      const schemaCID = 'QmYjtig7VJQ6XsnUjqqJvj7QaMcCAwtrgNdahSiFofrE7o';

      const permissionError = new Error('EACCES: permission denied');
      vi.mocked(fsPromises.readFile).mockRejectedValueOnce(permissionError);

      const schemaData = { type: 'object' };
      vi.mocked(mockIPFSService.fetchContent).mockResolvedValueOnce(
        Buffer.from(JSON.stringify(schemaData))
      );

      const schema: JSONSchema = {
        type: 'object',
        properties: {
          content: { type: 'string', cid: schemaCID },
        },
      };
      const data = { content: { '/': 'protected.json' } };

      const result = await jsonValidatorWithBaseDir.validate(data, schema);

      expect(result.valid).toBe(false);
      expect(result.errors![0].message).toContain(
        'not a valid CID or accessible file path: protected.json'
      );
    });

    it('should handle circular file references gracefully when property schema is a CID link', async () => {
      const baseDir = '/test/data';
      const jsonValidatorWithBaseDir = new JsonValidatorService(
        mockIPFSService,
        baseDir
      );
      const schemaCID = 'QmYjtig7VJQ6XsnUjqqJvj7QaMcCAwtrgNdahSiFofrE7o';

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

      const schemaData = { type: 'object' };
      vi.mocked(mockIPFSService.fetchContent).mockResolvedValueOnce(
        Buffer.from(JSON.stringify(schemaData))
      );

      const schema: JSONSchema = {
        type: 'object',
        properties: {
          content: { type: 'string', cid: schemaCID },
        },
      };
      const data = { content: { '/': 'file1.json' } };

      const result = await jsonValidatorWithBaseDir.validate(data, schema);

      // The implementation will eventually fail due to call stack or other limits
      expect(result.valid).toBe(false);
    });
  });

  describe('CID links with null types', () => {
    it('should handle CID links that allow null values', async () => {
      const schemaCID =
        'bafkreibyij6w2gagmolvnhnprheh6at5vff2ej5mnt6tphb7uvk5vvdhha';

      // Schema from CID that validates string values
      const cidSchema = {
        type: 'string',
        minLength: 5,
      };

      vi.mocked(mockIPFSService.fetchContent).mockResolvedValueOnce(
        Buffer.from(JSON.stringify(cidSchema))
      );

      // Main schema with CID link that allows null
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          flood_storm_info: {
            cid: schemaCID,
            description:
              'Reference to property_to_flood_storm_information relationship schema (can be null)',
            type: ['string', 'null'],
          },
        },
      };

      // Test with null value
      const dataWithNull = { flood_storm_info: null };
      const resultWithNull = await jsonValidator.validate(dataWithNull, schema);

      expect(resultWithNull.valid).toBe(true);
      expect(resultWithNull.errors).toBeUndefined();
    });

    it('should handle CID links that allow null values with string data', async () => {
      const schemaCID =
        'bafkreibyij6w2gagmolvnhnprheh6at5vff2ej5mnt6tphb7uvk5vvdhha';

      // Schema from CID that validates string values
      const cidSchema = {
        type: 'string',
        minLength: 5,
      };

      vi.mocked(mockIPFSService.fetchContent).mockResolvedValueOnce(
        Buffer.from(JSON.stringify(cidSchema))
      );

      // Main schema with CID link that allows null
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          flood_storm_info: {
            cid: schemaCID,
            description:
              'Reference to property_to_flood_storm_information relationship schema (can be null)',
            type: ['string', 'null'],
          },
        },
      };

      // Test with valid string value
      const dataWithString = { flood_storm_info: 'valid string value' };
      const resultWithString = await jsonValidator.validate(
        dataWithString,
        schema
      );

      expect(resultWithString.valid).toBe(true);
      expect(resultWithString.errors).toBeUndefined();
    });

    it('should fail validation when CID link with null type receives invalid string', async () => {
      const schemaCID =
        'bafkreibyij6w2gagmolvnhnprheh6at5vff2ej5mnt6tphb7uvk5vvdhha';

      // Schema from CID that validates string values with minimum length
      const cidSchema = {
        type: 'string',
        minLength: 10,
      };

      vi.mocked(mockIPFSService.fetchContent).mockResolvedValueOnce(
        Buffer.from(JSON.stringify(cidSchema))
      );

      // Main schema with CID link that allows null
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          flood_storm_info: {
            cid: schemaCID,
            description:
              'Reference to property_to_flood_storm_information relationship schema (can be null)',
            type: ['string', 'null'],
          },
        },
      };

      // Test with invalid string value (too short)
      const dataWithInvalidString = { flood_storm_info: 'short' };
      const resultWithInvalidString = await jsonValidator.validate(
        dataWithInvalidString,
        schema
      );

      expect(resultWithInvalidString.valid).toBe(false);
      expect(resultWithInvalidString.errors).toBeDefined();
      expect(resultWithInvalidString.errors!.length).toBeGreaterThan(0);
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
