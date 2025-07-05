import { describe, it, expect, beforeEach, vi } from 'vitest';
import { JsonValidatorService } from '../../../src/services/json-validator.service';
import { JSONSchema } from '../../../src/services/schema-cache.service';
import { IPFSService } from '../../../src/services/ipfs.service';

describe('JsonValidatorService - Enhanced Error Messages', () => {
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

  describe('Enhanced Format Error Messages', () => {
    it('should provide detailed error message for date format', async () => {
      const schema: JSONSchema = {
        type: 'string',
        format: 'date',
      };

      const result = await jsonValidator.validate('invalid-date', schema);
      expect(result.valid).toBe(false);
      expect(result.errors![0].message).toBe(
        'must be a valid ISO date in YYYY-MM-DD format'
      );
    });

    it('should provide detailed error message for date-time format', async () => {
      const schema: JSONSchema = {
        type: 'string',
        format: 'date-time',
      };

      const result = await jsonValidator.validate('invalid-datetime', schema);
      expect(result.valid).toBe(false);
      expect(result.errors![0].message).toBe(
        'must be a valid ISO date-time in YYYY-MM-DDTHH:mm:ss.sssZ format'
      );
    });

    it('should provide detailed error message for time format', async () => {
      const schema: JSONSchema = {
        type: 'string',
        format: 'time',
      };

      const result = await jsonValidator.validate('invalid-time', schema);
      expect(result.valid).toBe(false);
      expect(result.errors![0].message).toBe(
        'must be a valid ISO time in HH:mm:ss format'
      );
    });

    it('should provide detailed error message for email format', async () => {
      const schema: JSONSchema = {
        type: 'string',
        format: 'email',
      };

      const result = await jsonValidator.validate('not-an-email', schema);
      expect(result.valid).toBe(false);
      expect(result.errors![0].message).toBe('must be a valid email address');
    });

    it('should provide detailed error message for hostname format', async () => {
      const schema: JSONSchema = {
        type: 'string',
        format: 'hostname',
      };

      const result = await jsonValidator.validate('invalid..hostname', schema);
      expect(result.valid).toBe(false);
      expect(result.errors![0].message).toBe('must be a valid hostname');
    });

    it('should provide detailed error message for ipv4 format', async () => {
      const schema: JSONSchema = {
        type: 'string',
        format: 'ipv4',
      };

      const result = await jsonValidator.validate('999.999.999.999', schema);
      expect(result.valid).toBe(false);
      expect(result.errors![0].message).toBe('must be a valid IPv4 address');
    });

    it('should provide detailed error message for ipv6 format', async () => {
      const schema: JSONSchema = {
        type: 'string',
        format: 'ipv6',
      };

      const result = await jsonValidator.validate('invalid-ipv6', schema);
      expect(result.valid).toBe(false);
      expect(result.errors![0].message).toBe('must be a valid IPv6 address');
    });

    it('should provide detailed error message for uri format', async () => {
      const schema: JSONSchema = {
        type: 'string',
        format: 'uri',
      };

      const result = await jsonValidator.validate('not-a-uri', schema);
      expect(result.valid).toBe(false);
      expect(result.errors![0].message).toBe(
        'must be a valid URI starting with http:// or https://'
      );
    });

    it('should provide detailed error message for uuid format', async () => {
      const schema: JSONSchema = {
        type: 'string',
        format: 'uuid',
      };

      const result = await jsonValidator.validate('not-a-uuid', schema);
      expect(result.valid).toBe(false);
      expect(result.errors![0].message).toBe('must be a valid UUID');
    });

    it('should provide detailed error message for custom cid format', async () => {
      const schema: JSONSchema = {
        type: 'string',
        format: 'cid',
      };

      const result = await jsonValidator.validate('not-a-cid', schema);
      expect(result.valid).toBe(false);
      expect(result.errors![0].message).toBe(
        'must be a valid IPFS Content Identifier (CID)'
      );
    });

    it('should provide detailed error message for custom currency format', async () => {
      const schema: JSONSchema = {
        type: 'number',
        format: 'currency',
      };

      const result = await jsonValidator.validate(-10.5, schema);
      expect(result.valid).toBe(false);
      expect(result.errors![0].message).toBe(
        'must be a positive number with at most 2 decimal places'
      );
    });

    it('should provide detailed error message for custom ipfs_uri format', async () => {
      const schema: JSONSchema = {
        type: 'string',
        format: 'ipfs_uri',
      };

      const result = await jsonValidator.validate('http://example.com', schema);
      expect(result.valid).toBe(false);
      expect(result.errors![0].message).toBe(
        'must be a valid IPFS URI in format ipfs://[CID] with CIDv1 using raw codec and sha256'
      );
    });

    it('should provide detailed error message for custom rate_percent format', async () => {
      const schema: JSONSchema = {
        type: 'string',
        format: 'rate_percent',
      };

      const result = await jsonValidator.validate('5.25', schema);
      expect(result.valid).toBe(false);
      expect(result.errors![0].message).toBe(
        'must be a percentage rate with exactly 3 decimal places (e.g., "12.345")'
      );
    });

    it('should fall back to generic message for unknown format', async () => {
      // AJV by default ignores unknown formats, so we need to test with a format
      // that exists but is invalid for the given value
      const schema: JSONSchema = {
        type: 'string',
        format: 'json-pointer',
      };

      const result = await jsonValidator.validate('not-a-json-pointer', schema);
      expect(result.valid).toBe(false);
      expect(result.errors![0].message).toBe('must be a valid JSON Pointer');
    });
  });

  describe('Enhanced Error Messages for Other Validation Types', () => {
    it('should provide detailed error message for required property', async () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
        },
        required: ['name'],
      };

      const result = await jsonValidator.validate({}, schema);
      expect(result.valid).toBe(false);
      expect(result.errors![0].message).toBe(
        "missing required property 'name'"
      );
    });

    it('should provide detailed error message for additional properties', async () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
        },
        additionalProperties: false,
      };

      const result = await jsonValidator.validate(
        { name: 'John', extra: 'field' },
        schema
      );
      expect(result.valid).toBe(false);
      expect(result.errors![0].message).toBe("unexpected property 'extra'");
    });

    it('should provide detailed error message for type mismatch', async () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          age: { type: 'number' },
        },
      };

      const result = await jsonValidator.validate({ age: 'thirty' }, schema);
      expect(result.valid).toBe(false);
      expect(result.errors![0].message).toBe('must be number');
    });

    it('should provide detailed error message for enum mismatch', async () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          status: { enum: ['active', 'inactive', 'pending'] },
        },
      };

      const result = await jsonValidator.validate(
        { status: 'invalid' },
        schema
      );
      expect(result.valid).toBe(false);
      expect(result.errors![0].message).toBe(
        'must be one of: active, inactive, pending'
      );
    });
  });

  describe('Error Message Path Information', () => {
    it('should include correct path information in error messages', async () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          user: {
            type: 'object',
            properties: {
              email: { type: 'string', format: 'email' },
            },
          },
        },
      };

      const result = await jsonValidator.validate(
        {
          user: { email: 'invalid-email' },
        },
        schema
      );

      expect(result.valid).toBe(false);
      const errorMessages = jsonValidator.getErrorMessages(result.errors!);
      expect(errorMessages[0]).toBe(
        '/user/email: must be a valid email address'
      );
    });

    it('should handle array validation error paths', async () => {
      const schema: JSONSchema = {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            email: { type: 'string', format: 'email' },
          },
        },
      };

      const result = await jsonValidator.validate(
        [{ email: 'valid@example.com' }, { email: 'invalid-email' }],
        schema
      );

      expect(result.valid).toBe(false);
      const errorMessages = jsonValidator.getErrorMessages(result.errors!);
      expect(errorMessages[0]).toBe('/1/email: must be a valid email address');
    });
  });

  describe('Multiple Error Handling', () => {
    it('should provide enhanced messages for multiple validation errors', async () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          email: { type: 'string', format: 'email' },
          age: { type: 'number' },
          status: { enum: ['active', 'inactive'] },
        },
        required: ['email', 'age'],
      };

      const result = await jsonValidator.validate(
        {
          email: 'invalid-email',
          status: 'unknown',
        },
        schema
      );

      expect(result.valid).toBe(false);
      expect(result.errors!.length).toBeGreaterThan(1);

      const errorMessages = jsonValidator.getErrorMessages(result.errors!);
      const emailError = errorMessages.find((msg) => msg.includes('email'));
      const ageError = errorMessages.find((msg) => msg.includes('age'));
      const statusError = errorMessages.find((msg) => msg.includes('status'));

      expect(emailError).toContain('must be a valid email address');
      expect(ageError).toContain("missing required property 'age'");
      expect(statusError).toContain('must be one of: active, inactive');
    });
  });
});
