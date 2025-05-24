import { JsonFragment } from 'ethers';

export interface CommandOptions {
  oracle: string;
  contract?: string;
  rpc?: string;
  gateway?: string;
  fromBlock?: string;
  toBlock?: string; // Added
  abiPath?: string; // Added
  downloadDir?: string;
  maxConcurrentDownloads?: number; // Added
  retries?: number;
  timeout?: number;
}

export interface Event {
  data: string;
  topics: string[];
  blockNumber: number;
  transactionHash: string;
}

export interface ElephantAssignment {
  cid: string;
  elephant: string;
  blockNumber: number;
  transactionHash: string;
}

// For event data after parsing by EventDecoderService
export interface ElephantAssignedEventData {
  propertyCid: string; // This is the raw 'bytes' value from the event
  elephant: string; // The indexed address
}

export interface DownloadResult {
  cid: string;
  success: boolean;
  path?: string;
  error?: Error;
}

export type ABI = ReadonlyArray<JsonFragment>; // Simplified for now, can be more specific using ethers types like JsonFragment[]
