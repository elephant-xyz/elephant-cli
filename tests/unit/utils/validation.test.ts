import { describe, it, expect } from '@jest/globals';
import { isValidAddress, isValidUrl } from '../../../src/utils/validation';

describe('validation utils', () => {
  describe('isValidAddress', () => {
    it('should validate correct Ethereum addresses', () => {
      const validAddresses = [
        '0x0e44bfab0f7e1943cF47942221929F898E181505',
        '0x1234567890123456789012345678901234567890',
        '0xAbCdEf1234567890123456789012345678901234',
        '0x0000000000000000000000000000000000000000',
        '0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF',
      ];

      validAddresses.forEach(address => {
        expect(isValidAddress(address)).toBe(true);
      });
    });

    it('should reject invalid Ethereum addresses', () => {
      const invalidAddresses = [
        // Wrong length
        '0x123',
        '0x12345678901234567890123456789012345678901', // 41 hex chars
        '0x123456789012345678901234567890123456789', // 39 hex chars
        
        // Missing 0x prefix
        '1234567890123456789012345678901234567890',
        
        // Invalid characters
        '0xGHIJKL1234567890123456789012345678901234',
        '0x123456789012345678901234567890123456789G',
        '0x12345678901234567890123456789012345678 0', // space
        '0x12345678901234567890123456789012345678-0', // dash
        
        // Empty or null-like values
        '',
        '0x',
        '0x0',
        
        // Case variations of prefix (should be lowercase)
        '0X1234567890123456789012345678901234567890',
        '0x1234567890123456789012345678901234567890 ', // trailing space
        ' 0x1234567890123456789012345678901234567890', // leading space
      ];

      invalidAddresses.forEach(address => {
        expect(isValidAddress(address)).toBe(false);
      });
    });

    it('should handle edge cases', () => {
      // Undefined/null should be handled by TypeScript, but test string edge cases
      expect(isValidAddress('undefined')).toBe(false);
      expect(isValidAddress('null')).toBe(false);
      expect(isValidAddress('0xundefined')).toBe(false);
    });

    it('should be case insensitive for hex characters', () => {
      expect(isValidAddress('0xabcdef1234567890123456789012345678901234')).toBe(true);
      expect(isValidAddress('0xABCDEF1234567890123456789012345678901234')).toBe(true);
      expect(isValidAddress('0xAbCdEf1234567890123456789012345678901234')).toBe(true);
    });
  });

  describe('isValidUrl', () => {
    it('should validate correct URLs', () => {
      const validUrls = [
        'http://example.com',
        'https://example.com',
        'https://example.com:8080',
        'https://example.com/path',
        'https://example.com/path/to/resource',
        'https://example.com/path?query=value',
        'https://example.com/path?query=value&another=test',
        'https://example.com/path#fragment',
        'https://subdomain.example.com',
        'https://sub.sub.example.com',
        'https://example.com:3000/path?q=1#hash',
        'ftp://example.com',
        'ws://example.com',
        'wss://example.com',
        'https://192.168.1.1',
        'https://192.168.1.1:8080',
        'https://localhost',
        'https://localhost:3000',
        'https://user:pass@example.com',
        'https://gateway.pinata.cloud/ipfs/',
        'https://rpc.therpc.io/polygon',
      ];

      validUrls.forEach(url => {
        expect(isValidUrl(url)).toBe(true);
      });
    });

    it('should reject invalid URLs', () => {
      const invalidUrls = [
        // Missing protocol
        'example.com',
        'www.example.com',
        '192.168.1.1',
        
        // Invalid protocol
        'htp://example.com',
        'htps://example.com',
        'http//example.com',
        'http:example.com',
        
        // Malformed URLs
        'http://',
        'https://',
        'http://.',
        'http://..',
        'http://../',
        'http://?',
        'http://??',
        'http://??/',
        'http://#',
        'http://##',
        'http://##/',
        'http:///a',
        '///',
        '//a',
        '///a',
        'foo.com',
        
        // Empty or whitespace
        '',
        ' ',
        '\t',
        '\n',
        
        // Just protocol
        'http',
        'https',
        
        // Invalid characters
        'http://example com', // space
        'http://example.com/path with spaces',
        'http://exa mple.com',
        
        // Incomplete URLs
        'http://192.168.1.',
        'http://192.168.1',
        'http://example.',
        'http://.com',
      ];

      invalidUrls.forEach(url => {
        expect(isValidUrl(url)).toBe(false);
      });
    });

    it('should handle special protocols', () => {
      const specialProtocols = [
        'file:///home/user/file.txt',
        'mailto:test@example.com',
        'tel:+1234567890',
        'data:text/plain;base64,SGVsbG8sIFdvcmxkIQ==',
        'blob:https://example.com/uuid',
      ];

      specialProtocols.forEach(url => {
        expect(isValidUrl(url)).toBe(true);
      });
    });

    it('should handle URLs with special characters', () => {
      expect(isValidUrl('https://example.com/path-with-dash')).toBe(true);
      expect(isValidUrl('https://example.com/path_with_underscore')).toBe(true);
      expect(isValidUrl('https://example.com/path.with.dots')).toBe(true);
      expect(isValidUrl('https://example.com/~user')).toBe(true);
      expect(isValidUrl('https://example.com/path%20with%20encoded%20spaces')).toBe(true);
    });

    it('should handle international domain names', () => {
      expect(isValidUrl('https://münchen.de')).toBe(true);
      expect(isValidUrl('https://例え.jp')).toBe(true);
      expect(isValidUrl('https://xn--fsq.com')).toBe(true); // Punycode
    });

    it('should handle very long URLs', () => {
      const longPath = 'a'.repeat(2000);
      const longUrl = `https://example.com/${longPath}`;
      expect(isValidUrl(longUrl)).toBe(true);
    });

    it('should handle URLs with authentication', () => {
      expect(isValidUrl('https://user@example.com')).toBe(true);
      expect(isValidUrl('https://user:password@example.com')).toBe(true);
      expect(isValidUrl('https://user:pass:word@example.com')).toBe(true);
    });

    it('should handle edge cases', () => {
      // These should all return false
      expect(isValidUrl('undefined')).toBe(false);
      expect(isValidUrl('null')).toBe(false);
      expect(isValidUrl('[object Object]')).toBe(false);
      expect(isValidUrl('NaN')).toBe(false);
      expect(isValidUrl('Infinity')).toBe(false);
    });
  });
});