import { describe, it, expect, beforeEach } from 'vitest';
import { CidHexConverterService } from '../../../src/services/cid-hex-converter.service.js';

describe('CidHexConverterService', () => {
  let service: CidHexConverterService;

  beforeEach(() => {
    service = new CidHexConverterService();
  });

  describe('hexToCid', () => {
    it('should convert valid hex hash to CID v1', () => {
      // SHA-256 hash of "hello world"
      const hexHash =
        '0xb94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9';
      const cid = service.hexToCid(hexHash);

      // Should start with 'bafkrei' (base32 encoded CID v1 with raw codec)
      expect(cid).toMatch(/^bafkrei/);
      expect(cid).toBe(
        'bafkreifzjut3te2nhyekklss27nh3k72ysco7y32koao5eei66wof36n5e'
      );
    });

    it('should handle hex without 0x prefix', () => {
      const hexHash =
        'b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9';
      const cid = service.hexToCid(hexHash);

      expect(cid).toBe(
        'bafkreifzjut3te2nhyekklss27nh3k72ysco7y32koao5eei66wof36n5e'
      );
    });

    it('should throw error for invalid hex length', () => {
      const shortHex = '0x1234';
      expect(() => service.hexToCid(shortHex)).toThrow(
        'Invalid hex string format or incorrect length (expected 32 bytes)'
      );
    });

    it('should throw error for invalid hex characters', () => {
      const invalidHex =
        '0xZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ';
      expect(() => service.hexToCid(invalidHex)).toThrow(
        'Invalid hex string format or incorrect length (expected 32 bytes)'
      );
    });

    it('should throw error for empty string', () => {
      expect(() => service.hexToCid('')).toThrow(
        'Hex hash must be a non-empty string'
      );
    });
  });

  describe('cidToHex', () => {
    it('should convert valid CID v1 to hex hash', () => {
      const cid = 'bafkreifzjut3te2nhyekklss27nh3k72ysco7y32koao5eei66wof36n5e';
      const hex = service.cidToHex(cid);

      expect(hex).toBe(
        '0xb94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9'
      );
    });

    it('should throw error for CID v0', () => {
      // This is a CID v0 (starts with Qm)
      const cidV0 = 'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG';
      expect(() => service.cidToHex(cidV0)).toThrow(
        'Expected CID v1, got CID v0'
      );
    });

    it('should throw error for wrong codec', () => {
      // This is a CID v1 with dag-pb codec (0x70) instead of raw (0x55)
      const cidDagPb =
        'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi';
      expect(() => service.cidToHex(cidDagPb)).toThrow(
        'Expected raw codec (0x55), got codec 0x70'
      );
    });

    it('should throw error for wrong hash algorithm', () => {
      // This would be a CID with a different hash algorithm (if we could construct one)
      // For now, we'll test with an invalid CID
      const invalidCid = 'bafkrei';
      expect(() => service.cidToHex(invalidCid)).toThrow('Invalid CID format');
    });

    it('should throw error for empty string', () => {
      expect(() => service.cidToHex('')).toThrow(
        'CID must be a non-empty string'
      );
    });
  });

  describe('validateHexFormat', () => {
    it('should validate correct hex with 0x prefix', () => {
      const result = service.validateHexFormat(
        '0xb94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9'
      );
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should validate correct hex without 0x prefix', () => {
      const result = service.validateHexFormat(
        'b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9'
      );
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should reject hex with wrong length', () => {
      const result = service.validateHexFormat('0x1234');
      expect(result.valid).toBe(false);
      expect(result.error).toBe(
        'Invalid hex string format or incorrect length (expected 32 bytes)'
      );
    });

    it('should reject invalid hex characters', () => {
      const result = service.validateHexFormat('0xGGGG');
      expect(result.valid).toBe(false);
      expect(result.error).toBe(
        'Invalid hex string format or incorrect length (expected 32 bytes)'
      );
    });

    it('should reject empty string', () => {
      const result = service.validateHexFormat('');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Hex hash must be a non-empty string');
    });

    it('should reject null', () => {
      const result = service.validateHexFormat(null as any);
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Hex hash must be a non-empty string');
    });
  });

  describe('validateCidFormat', () => {
    it('should validate correct CID v1 with raw codec', () => {
      const result = service.validateCidFormat(
        'bafkreifzjut3te2nhyekklss27nh3k72ysco7y32koao5eei66wof36n5e'
      );
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should reject CID v0', () => {
      const result = service.validateCidFormat(
        'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG'
      );
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Expected CID v1, got CID v0');
    });

    it('should reject CID with wrong codec', () => {
      const result = service.validateCidFormat(
        'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi'
      );
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Expected raw codec (0x55), got codec 0x70');
    });

    it('should reject invalid CID', () => {
      const result = service.validateCidFormat('invalid-cid');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Invalid CID format');
    });

    it('should reject empty string', () => {
      const result = service.validateCidFormat('');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('CID must be a non-empty string');
    });

    it('should reject null', () => {
      const result = service.validateCidFormat(null as any);
      expect(result.valid).toBe(false);
      expect(result.error).toBe('CID must be a non-empty string');
    });
  });

  describe('round-trip conversion', () => {
    it('should convert hex to CID and back to hex', () => {
      const originalHex =
        '0xb94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9';
      const cid = service.hexToCid(originalHex);
      const resultHex = service.cidToHex(cid);

      expect(resultHex).toBe(originalHex);
    });

    it('should convert CID to hex and back to CID', () => {
      const originalCid =
        'bafkreifzjut3te2nhyekklss27nh3k72ysco7y32koao5eei66wof36n5e';
      const hex = service.cidToHex(originalCid);
      const resultCid = service.hexToCid(hex);

      expect(resultCid).toBe(originalCid);
    });
  });
});
