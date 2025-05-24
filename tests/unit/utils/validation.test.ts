import { describe, it, expect } from '@jest/globals';

// Mock multiformats/cid using the __mocks__ directory
jest.mock('multiformats/cid');

// Ensure we are testing against the actual ethers library for validation logic
jest.unmock('ethers'); 

// Import functions directly from the module being tested
import { isValidAddress, isValidUrl, isValidBlock, isValidCID } from '../../../src/utils/validation';

describe('validation utils', () => {
  describe('isValidAddress', () => {
    it('should validate correct Ethereum addresses', () => {
      const validAddresses = [
        '0x0e44bfab0f7e1943cF47942221929F898E181505',
        '0x79D5046e34D4A56D357E12636A18da6eaEfe0586',
        '0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B', // Checksummed
        '0xab5801a7d398351b8be11c439e05c5b3259aec9b', // Lowercase
      ];
      validAddresses.forEach(address => {
        expect(isValidAddress(address)).toBe(true);
      });
    });

    it('should reject invalid Ethereum addresses', () => {
      const invalidAddresses = [
        '0x0e44bfab0f7e1943cF47942221929F898E18150', // Too short
        '0x0e44bfab0f7e1943cF47942221929F898E1815055', // Too long
        '0xG0e44bfab0f7e1943cF47942221929F898E181505', // Invalid char
        'not_an_address', '', null, undefined,
      ];
      invalidAddresses.forEach(address => {
        expect(isValidAddress(address as string)).toBe(false);
      });
    });

    it('should handle mixed case addresses (checksum validation)', () => {
      // Valid checksum (this will be false because ethers is strict about checksum)
      expect(isValidAddress('0x0e44bFaB0f7E1943cf47942221929f898e181505')).toBe(false);
      // All lowercase is valid
      expect(isValidAddress('0x0e44bfab0f7e1943cf47942221929f898e181505')).toBe(true);
      // All uppercase is valid
      expect(isValidAddress('0x0E44BFAB0F7E1943CF47942221929F898E181505')).toBe(true);
    });
  });

  describe('isValidUrl', () => {
    it('should validate correct URLs (http/https)', () => {
      const validUrls = [
        'http://example.com', 'https://example.com', 'http://localhost:3000',
        'https://sub.example.co.uk/path?query=value#hash',
      ];
      validUrls.forEach(url => {
        expect(isValidUrl(url)).toBe(true);
      });
    });

    it('should reject invalid URLs or non-http/https protocols', () => {
      const invalidUrls = [
        'example.com', 'htp://example.com', 'ftp://example.com', 
        'http//example.com', '://example.com',
        '', null, undefined,
      ];
      invalidUrls.forEach(url => {
        expect(isValidUrl(url as string)).toBe(false);
      });
    });
  });

  describe('isValidBlock', () => {
    it('should validate correct block numbers or "latest"', () => {
      const validBlocks = ['0', '123', '1234567890', 'latest'];
      validBlocks.forEach(block => {
        expect(isValidBlock(block)).toBe(true);
      });
    });

    it('should reject invalid block numbers', () => {
      const invalidBlocks = ['-1', 'abc', '1.23', 'latest ', ' latest', '', null, undefined];
      invalidBlocks.forEach(block => {
        expect(isValidBlock(block as string)).toBe(false);
      });
    });
  });

  describe('isValidCID', () => {
    it('should validate correct CIDs (v0 and v1)', () => {
      const validCIDs = [
        'QmWUnTmuodSYEuHVPgxtrARGra2VpzsusAp4FqT9FWobuU', // v0
        'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi', // v1
        'QmRAQB6YaSyaxG6xhL7hEYM23r291g1s28V8vtv2vYZY7i', // another v0
      ];
      validCIDs.forEach(cid => {
        expect(isValidCID(cid)).toBe(true);
      });
    });

    it('should reject invalid CIDs', () => {
      const invalidCIDs = [
        'QmWUnTmuodSYEuHVPgxtrARGra2VpzsusAp4FqT9FWobu', // Too short v0
        'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzd', // Too short v1
        'QmInvalidLength!', // Invalid char
        'bafyInvalidChars!', // Invalid char v1
        '', null, undefined,
      ];
      invalidCIDs.forEach(cid => {
        expect(isValidCID(cid as string)).toBe(false);
      });
    });
  });
});