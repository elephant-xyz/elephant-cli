import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import path from 'path';

const __dirname = process.cwd();
const CLI_PATH = path.join(__dirname, 'bin/elephant-cli');

describe('CID-Hex Conversion Integration Tests', () => {
  describe('hex-to-cid command', () => {
    it('should convert hex to CID', () => {
      const hexHash =
        '0xb94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9';
      const result = execSync(`${CLI_PATH} hex-to-cid ${hexHash} --quiet`, {
        encoding: 'utf8',
      }).trim();

      expect(result).toBe(
        'bafkreifzjut3te2nhyekklss27nh3k72ysco7y32koao5eei66wof36n5e'
      );
    });

    it('should convert hex without 0x prefix', () => {
      const hexHash =
        'b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9';
      const result = execSync(`${CLI_PATH} hex-to-cid ${hexHash} --quiet`, {
        encoding: 'utf8',
      }).trim();

      expect(result).toBe(
        'bafkreifzjut3te2nhyekklss27nh3k72ysco7y32koao5eei66wof36n5e'
      );
    });

    it('should show validation message with --validate flag', () => {
      const hexHash =
        '0xb94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9';
      const result = execSync(`${CLI_PATH} hex-to-cid ${hexHash} --validate`, {
        encoding: 'utf8',
      });

      expect(result).toContain('✓ Valid hex format');
      expect(result).toContain('CID:');
      expect(result).toContain(
        'bafkreifzjut3te2nhyekklss27nh3k72ysco7y32koao5eei66wof36n5e'
      );
    });

    it('should fail for invalid hex', () => {
      const invalidHex = '0x1234';

      expect(() => {
        execSync(`${CLI_PATH} hex-to-cid ${invalidHex}`, {
          encoding: 'utf8',
        });
      }).toThrow();
    });
  });

  describe('cid-to-hex command', () => {
    it('should convert CID to hex', () => {
      const cid = 'bafkreifzjut3te2nhyekklss27nh3k72ysco7y32koao5eei66wof36n5e';
      const result = execSync(`${CLI_PATH} cid-to-hex ${cid} --quiet`, {
        encoding: 'utf8',
      }).trim();

      expect(result).toBe(
        '0xb94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9'
      );
    });

    it('should show validation message with --validate flag', () => {
      const cid = 'bafkreifzjut3te2nhyekklss27nh3k72ysco7y32koao5eei66wof36n5e';
      const result = execSync(`${CLI_PATH} cid-to-hex ${cid} --validate`, {
        encoding: 'utf8',
      });

      expect(result).toContain('✓ Valid CID format');
      expect(result).toContain('Hex:');
      expect(result).toContain(
        '0xb94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9'
      );
    });

    it('should fail for CID v0', () => {
      const cidV0 = 'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG';

      expect(() => {
        execSync(`${CLI_PATH} cid-to-hex ${cidV0}`, {
          encoding: 'utf8',
        });
      }).toThrow();
    });

    it('should fail for wrong codec', () => {
      const cidDagPb =
        'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi';

      expect(() => {
        execSync(`${CLI_PATH} cid-to-hex ${cidDagPb}`, {
          encoding: 'utf8',
        });
      }).toThrow();
    });
  });

  describe('round-trip conversion', () => {
    it('should convert hex to CID and back to hex', () => {
      const originalHex =
        '0xb94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9';

      // Convert hex to CID
      const cid = execSync(`${CLI_PATH} hex-to-cid ${originalHex} --quiet`, {
        encoding: 'utf8',
      }).trim();

      // Convert CID back to hex
      const resultHex = execSync(`${CLI_PATH} cid-to-hex ${cid} --quiet`, {
        encoding: 'utf8',
      }).trim();

      expect(resultHex).toBe(originalHex);
    });

    it('should convert CID to hex and back to CID', () => {
      const originalCid =
        'bafkreifzjut3te2nhyekklss27nh3k72ysco7y32koao5eei66wof36n5e';

      // Convert CID to hex
      const hex = execSync(`${CLI_PATH} cid-to-hex ${originalCid} --quiet`, {
        encoding: 'utf8',
      }).trim();

      // Convert hex back to CID
      const resultCid = execSync(`${CLI_PATH} hex-to-cid ${hex} --quiet`, {
        encoding: 'utf8',
      }).trim();

      expect(resultCid).toBe(originalCid);
    });
  });
});
