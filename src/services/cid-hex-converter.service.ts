import { CID } from 'multiformats/cid';
import { sha256 } from 'multiformats/hashes/sha2';
import { base32 } from 'multiformats/bases/base32';
import * as raw from 'multiformats/codecs/raw';
import { hexlify, getBytes, isHexString } from 'ethers';
import { create as createDigest } from 'multiformats/hashes/digest';
import { logger } from '../utils/logger.js';

export class CidHexConverterService {
  /**
   * Convert Ethereum hex hash to CID v1 with raw codec
   * @param hexHash - Ethereum-style hex string (with or without 0x prefix)
   * @returns CID v1 string in base32 encoding
   */
  hexToCid(hexHash: string): string {
    try {
      // Validate hex format
      const validation = this.validateHexFormat(hexHash);
      if (!validation.valid) {
        throw new Error(validation.error);
      }

      // Normalize hex string - add 0x prefix if missing
      const normalizedHex = hexHash.startsWith('0x') ? hexHash : `0x${hexHash}`;

      // Use ethers to convert hex to bytes
      const hashBytes = getBytes(normalizedHex);

      // Create a multihash digest with SHA-256 (code 0x12)
      const multihash = createDigest(sha256.code, hashBytes);

      // Create CID v1 with raw codec (0x55)
      const cid = CID.create(1, raw.code, multihash);

      // Return base32 encoded string (standard for CID v1)
      const cidString = cid.toString(base32);

      logger.debug(`Converted hex ${hexHash} to CID ${cidString}`);
      return cidString;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error(`Failed to convert hex to CID: ${errorMessage}`);
      throw new Error(`Failed to convert hex to CID: ${errorMessage}`);
    }
  }

  /**
   * Convert CID v1 to Ethereum hex hash
   * @param cidString - CID v1 string
   * @returns Ethereum-style hex string with 0x prefix
   */
  cidToHex(cidString: string): string {
    try {
      // Validate CID format
      const validation = this.validateCidFormat(cidString);
      if (!validation.valid) {
        throw new Error(validation.error);
      }

      // Parse the CID
      const cid = CID.parse(cidString);

      // Extract the hash bytes from the multihash
      const hashBytes = cid.multihash.digest;

      // Convert to hex string with 0x prefix using ethers
      const hexHash = hexlify(hashBytes);

      logger.debug(`Converted CID ${cidString} to hex ${hexHash}`);
      return hexHash;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error(`Failed to convert CID to hex: ${errorMessage}`);
      throw new Error(`Failed to convert CID to hex: ${errorMessage}`);
    }
  }

  /**
   * Validate that a CID uses the expected format
   * @param cidString - CID string to validate
   * @returns Validation result with error message if invalid
   */
  validateCidFormat(cidString: string): { valid: boolean; error?: string } {
    try {
      if (!cidString || typeof cidString !== 'string') {
        return { valid: false, error: 'CID must be a non-empty string' };
      }

      // Parse the CID
      const cid = CID.parse(cidString);

      // Check CID version
      if (cid.version !== 1) {
        return {
          valid: false,
          error: `Expected CID v1, got CID v${cid.version}`,
        };
      }

      // Check codec
      if (cid.code !== raw.code) {
        return {
          valid: false,
          error: `Expected raw codec (0x55), got codec 0x${cid.code.toString(16)}`,
        };
      }

      // Check hash algorithm
      if (cid.multihash.code !== sha256.code) {
        return {
          valid: false,
          error: `Expected SHA-256 hash (0x12), got hash algorithm 0x${cid.multihash.code.toString(16)}`,
        };
      }

      // Check hash length (SHA-256 should be 32 bytes)
      if (cid.multihash.digest.length !== 32) {
        return {
          valid: false,
          error: `Expected 32-byte hash, got ${cid.multihash.digest.length} bytes`,
        };
      }

      return { valid: true };
    } catch (error) {
      return {
        valid: false,
        error: `Invalid CID format: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Validate hex hash format
   * @param hexHash - Hex string to validate
   * @returns Validation result with error message if invalid
   */
  validateHexFormat(hexHash: string): { valid: boolean; error?: string } {
    try {
      if (!hexHash || typeof hexHash !== 'string') {
        return { valid: false, error: 'Hex hash must be a non-empty string' };
      }

      // Normalize hex string - add 0x prefix if missing
      const normalizedHex = hexHash.startsWith('0x') ? hexHash : `0x${hexHash}`;

      // Use ethers isHexString with length parameter (32 bytes for SHA-256)
      if (!isHexString(normalizedHex, 32)) {
        return {
          valid: false,
          error:
            'Invalid hex string format or incorrect length (expected 32 bytes)',
        };
      }

      return { valid: true };
    } catch (error) {
      return {
        valid: false,
        error: `Invalid hex format: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}
