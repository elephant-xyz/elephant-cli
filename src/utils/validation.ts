import { CID } from 'multiformats/cid';
import { sha256 } from 'multiformats/hashes/sha2';
import { create as createDigest } from 'multiformats/hashes/digest';
import { isAddress } from 'ethers'; // ethers v6
import { logger } from './logger.js';

export const isValidAddress = (address: string | undefined | null): boolean => {
  if (!address) return false;
  return isAddress(address);
};

export const isValidUrl = (url: string | undefined | null): boolean => {
  if (!url) return false;
  try {
    const parsedUrl = new URL(url);
    return parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:';
  } catch {
    return false;
  }
};

export const isValidBlock = (block: string | undefined | null): boolean => {
  if (!block) return false;
  if (block === 'latest') {
    return true;
  }
  return /^\d+$/.test(block) && parseInt(block, 10) >= 0;
};

export const isValidCID = (cid: string | undefined | null): boolean => {
  if (!cid) return false;
  try {
    CID.parse(cid);
    return true;
  } catch (e: unknown) {
    logger.error(String(e));
    return false;
  }
};

export const deriveCIDFromHash = (hash: string): string => {
  try {
    // Remove 0x prefix if present
    const cleanHash = hash.startsWith('0x') ? hash.slice(2) : hash;

    // Convert hex string to Uint8Array
    const hashBytes = new Uint8Array(
      cleanHash.match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16))
    );

    // Create a multihash digest directly from the existing SHA-256 hash
    // sha256.code is 0x12, length is 32 bytes for SHA-256
    const multihash = createDigest(sha256.code, hashBytes);

    // Create CID v1 from the multihash using dag-json codec (0x0129)
    // This is the proper codec for IPLD compliance
    const cid = CID.create(1, 0x0129, multihash);

    return cid.toString();
  } catch (e: unknown) {
    logger.error(`Failed to derive CID from hash: ${String(e)}`);
    throw new Error(`Invalid hash format: ${hash}`);
  }
};

export const extractHashFromCID = (cid: string): string => {
  try {
    const parsedCid = CID.parse(cid);

    // Check if the multihash is SHA-256 (code 0x12)
    if (parsedCid.multihash.code !== sha256.code) {
      throw new Error(
        `Only SHA-256 hash is supported, got hash function code ${parsedCid.multihash.code}`
      );
    }

    // Extract the hash bytes from the multihash
    // This works for both CID v0 and v1 as long as they use SHA-256
    const hashBytes = parsedCid.multihash.digest;

    // Convert to hex string with 0x prefix
    const hexHash =
      '0x' +
      Array.from(hashBytes)
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');

    return hexHash;
  } catch (e: unknown) {
    logger.error(`Failed to extract hash from CID: ${String(e)}`);
    throw new Error(`Invalid CID format: ${cid}`);
  }
};
