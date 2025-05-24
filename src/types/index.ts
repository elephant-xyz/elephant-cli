import { Log } from 'ethers';

export interface CommandOptions {
  elephant?: string;
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
  // Add other event properties if necessary
}

export interface ElephantAssignment {
  cid: string;
  elephant: string;
  blockNumber: number;
  transactionHash: string;
}

// For raw event data from ethers
export interface RawEventData extends Log {
  // Log already includes: blockNumber, transactionHash, topics, data
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

// ABI type for ethers v6
// The InterfaceAbi type in ethers is: string | ReadonlyArray<string | Fragment | JsonFragment> | Interface
// We'll use a common subset for our ABI definition.
export type ABI = ReadonlyArray<any>; // Simplified for now, can be more specific using ethers types like JsonFragment[]

// You can also define more specific types if needed, e.g., for event logs
// or transaction receipts, but keep them minimal to what's used.
