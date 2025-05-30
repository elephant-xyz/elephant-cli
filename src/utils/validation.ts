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

    // Create CID v0 from the multihash
    const cid = CID.createV0(multihash);

    return cid.toString();
  } catch (e: unknown) {
    logger.error(`Failed to derive CID from hash: ${String(e)}`);
    throw new Error(`Invalid hash format: ${hash}`);
  }
};
