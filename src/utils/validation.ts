import { isAddress } from 'ethers'; // ethers v6
import { logger } from './logger';

// Allow potentially undefined/null inputs, as they are checked.
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

export const isValidCID = async (
  cid: string | undefined | null
): Promise<boolean> => {
  if (!cid) return false;
  try {
    const { CID } = await import('multiformats/cid');
    CID.parse(cid);
    return true;
  } catch (e: unknown) {
    logger.error(String(e));
    return false;
  }
};
