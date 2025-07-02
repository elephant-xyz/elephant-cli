import { describe, it, expect, beforeEach, vi } from 'vitest';
import { JsonValidatorService } from '../../../src/services/json-validator.service';
import { JSONSchema } from '../../../src/services/schema-cache.service';
import { IPFSService } from '../../../src/services/ipfs.service';
import { CID } from 'multiformats/cid';
import * as raw from 'multiformats/codecs/raw';
import { sha256 } from 'multiformats/hashes/sha2';

describe('JsonValidatorService - Custom Formats', () => {
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

  describe('Currency Format', () => {
    const currencySchema: JSONSchema = {
      type: 'number',
      format: 'currency',
    };

    it('should validate valid currency values', async () => {
      const validValues = [
        100, 100.5, 100.5, 0.01, 0.99, 999999.99, 1, 1.1, 1.11, 12345.67,
      ];

      for (const value of validValues) {
        const result = await jsonValidator.validate(value, currencySchema);
        expect(result.valid, `Failed for value: ${value}`).toBe(true);
      }
    });

    it('should reject invalid currency values', async () => {
      const invalidValues = [
        0, // Must be greater than 0
        -100, // Negative values not allowed
        -0.01, // Negative values not allowed
        100.123, // Three decimal places
        1.999, // Three decimal places
        0.001, // Three decimal places
        NaN, // Not a valid number
        Infinity, // Not finite
        -Infinity, // Not finite
        '100', // String, not number
        null, // Not a number
        undefined, // Not a number
      ];

      for (const value of invalidValues) {
        const result = await jsonValidator.validate(value, currencySchema);
        expect(result.valid, `Should reject value: ${value}`).toBe(false);
      }
    });
  });

  describe('Date Format (ISO)', () => {
    const dateSchema: JSONSchema = {
      type: 'string',
      format: 'date',
    };

    it('should validate valid ISO date values', async () => {
      const validValues = [
        '2024-01-01',
        '2023-12-31',
        '2020-02-29', // Leap year
        '1999-06-15',
        '2000-10-05',
        '2024-12-25',
      ];

      for (const value of validValues) {
        const result = await jsonValidator.validate(value, dateSchema);
        expect(result.valid, `Failed for value: ${value}`).toBe(true);
      }
    });

    it('should reject invalid date values', async () => {
      const invalidValues = [
        '2024-13-01', // Month > 12
        '2024-00-01', // Month = 0
        '2024-01-32', // Day > 31
        '2024-01-00', // Day = 0
        '01/01/2024', // MM/DD/YYYY format
        '2024/01/01', // Wrong separator
        '24-01-01', // Two digit year
        'abc', // Non-date
        '', // Empty
      ];

      for (const value of invalidValues) {
        const result = await jsonValidator.validate(value, dateSchema);
        expect(result.valid, `Should reject value: ${value}`).toBe(false);
      }
    });
  });

  describe('URI Format', () => {
    const uriSchema: JSONSchema = {
      type: 'string',
      format: 'uri',
    };

    it('should validate valid URI values', async () => {
      const validValues = [
        'http://example.com',
        'https://example.com',
        'https://sub.example.com',
        'https://example.com/path',
        'https://example.com/path/to/resource',
        'https://example.com?query=value',
        'https://example.com#anchor',
        'https://example.com:8080',
        'https://example.com/path?query=value#anchor',
        'https://user@example.com',
      ];

      for (const value of validValues) {
        const result = await jsonValidator.validate(value, uriSchema);
        expect(result.valid, `Failed for value: ${value}`).toBe(true);
      }
    });

    it('should reject invalid URI values', async () => {
      const invalidValues = [
        'ftp://example.com', // Not http/https
        'https://example', // No TLD
        'example.com', // No protocol
        'https://', // No domain
        'https://example com', // Space in domain
        'https://example..com', // Double dot
        '', // Empty
      ];

      for (const value of invalidValues) {
        const result = await jsonValidator.validate(value, uriSchema);
        expect(result.valid, `Should reject value: ${value}`).toBe(false);
      }
    });
  });

  describe('IPFS URI Format', () => {
    const ipfsUriSchema: JSONSchema = {
      type: 'string',
      format: 'ipfs_uri',
    };

    it('should validate valid IPFS URI values', async () => {
      const validValues = [
        'ipfs://bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku', // CIDv1 raw
        'ipfs://bafkreiggtrptmp32pl3to7x2tw5eedceyfld6sv25dlcdro6lowvxc5ili',
        'ipfs://bafkreichjl4lzxm5257p6jzvmm4zq4cu3s55torjiqju3crhstofeikvxm',
      ];

      for (const value of validValues) {
        const result = await jsonValidator.validate(value, ipfsUriSchema);
        expect(result.valid, `Failed for value: ${value}`).toBe(true);
      }
    });

    it('should reject invalid IPFS URI values', async () => {
      const invalidValues = [
        'http://QmYjtig7VJQ6XsnUjqqJvj7QaMcCAwtrgNdahSiFofrE7o', // Wrong protocol
        'ipfs://baguqeeraevt2kit5iquvk554xn7jfr63skcsixiipv3wyexx65g7vyqh5rsq', //wrong codec
        'ipfs://QmdfTbBqBPQ7VNxZEYEj14VmRuZBkqFbiwReogJgS1zR1n', // v0 long
      ];

      for (const value of invalidValues) {
        const result = await jsonValidator.validate(value, ipfsUriSchema);
        expect(result.valid, `Should reject value: ${value}`).toBe(false);
      }
    });

    it('should validate IPFS URI with CIDv1 raw codec sha256', async () => {
      // Create a proper CIDv1 with raw codec (0x55) and sha256
      const data = new TextEncoder().encode('test data');
      const hash = await sha256.digest(data);
      const cid = CID.create(1, raw.code, hash);
      const cidString = cid.toString();

      const value = `ipfs://${cidString}`;
      const result = await jsonValidator.validate(value, ipfsUriSchema);

      // First check if it passes the basic pattern
      expect(result.valid, `Failed for CIDv1 raw codec: ${value}`).toBe(true);
    });
  });

  describe('Rate Percent Format', () => {
    const ratePercentSchema: JSONSchema = {
      type: 'string',
      format: 'rate_percent',
    };

    it('should validate valid rate percent values', async () => {
      const validValues = [
        '5.250',
        '0.000',
        '10.375',
        '99.999',
        '100.000',
        '3.141',
      ];

      for (const value of validValues) {
        const result = await jsonValidator.validate(value, ratePercentSchema);
        expect(result.valid, `Failed for value: ${value}`).toBe(true);
      }
    });

    it('should reject invalid rate percent values', async () => {
      const invalidValues = [
        '5.25', // Only 2 decimal places
        '5.2500', // 4 decimal places
        '5', // No decimal
        '.250', // No integer part
        '5.', // No decimal part
        '5.25a', // Non-numeric character
        '-5.250', // Negative (not in pattern)
        '', // Empty
      ];

      for (const value of invalidValues) {
        const result = await jsonValidator.validate(value, ratePercentSchema);
        expect(result.valid, `Should reject value: ${value}`).toBe(false);
      }
    });
  });

  describe('Complex Schema with Custom Formats', () => {
    it('should validate complex object with multiple custom formats', async () => {
      const complexSchema: JSONSchema = {
        type: 'object',
        properties: {
          price: {
            type: 'string',
            format: 'currency',
          },
          date: {
            type: 'string',
            format: 'date',
          },
          website: {
            type: 'string',
            format: 'uri',
          },
          document: {
            type: 'string',
            format: 'ipfs_uri',
          },
          interestRate: {
            type: 'string',
            format: 'rate_percent',
          },
        },
        required: ['price', 'date'],
      };

      const validData = {
        price: '$1,234.56',
        date: '2024-12-25',
        website: 'https://example.com',
        document:
          'ipfs://bafkreid4f4hwpiwnmqjfilgvp2m6emrsemaynlbexyx72zmsjiydqsgk6a',
        interestRate: '5.250',
      };

      const result = await jsonValidator.validate(validData, complexSchema);
      expect(result.valid).toBe(true);
    });
  });
});
