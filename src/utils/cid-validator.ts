import { CID } from 'multiformats/cid';

/**
 * Validates if a string is a valid IPFS CID
 * Uses the CID.parse() method from multiformats for robust validation
 * @param cid - The string to validate
 * @returns true if valid CID, false otherwise
 */
export function isValidCid(cid: string): boolean {
  if (!cid || typeof cid !== 'string') {
    return false;
  }

  try {
    CID.parse(cid);
    return true;
  } catch (error) {
    return false;
  }
}
