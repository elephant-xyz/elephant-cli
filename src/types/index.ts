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

export interface OracleAssignment {
  cid: string;
  elephant: string;
  blockNumber: number;
  transactionHash: string;
}

// For event data after parsing by EventDecoderService
export interface OracleAssignedEventData {
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

// Consensus Status Types
export interface DataSubmittedEvent {
  propertyHash: string;
  dataGroupHash: string;
  submitter: string;
  dataHash: string;
  blockNumber: number;
  transactionHash: string;
}

export interface ConsensusGroup {
  propertyHash: string;
  dataGroupHash: string;
  submissions: Map<string, Set<string>>; // dataHash -> Set<submitter>
}

export interface ConsensusAnalysis {
  propertyHash: string;
  dataGroupHash: string;
  consensusReached: boolean | 'partial';
  submissionsByDataHash: Map<string, string[]>; // dataHash -> submitters[]
  submitterData: Map<string, { hash: string; cid: string }>; // submitter -> {hash, cid}
  totalSubmitters: number;
  uniqueDataHashes: number;
  comparisonResult?: MultiComparisonResult; // Added for partial consensus differences
}

export interface MultiComparisonResult {
  propertyHash: string;
  dataGroupHash: string;
  cids: string[];
  pairwiseComparisons: ComparisonResult[];
  summary: string;
  totalDifferences: number;
}

export interface ComparisonResult {
  cid1: string;
  cid2: string;
  differences: DifferenceDetail[];
  differenceCount: number;
  hasDifferences: boolean;
}

export interface DifferenceDetail {
  path: string;
  type: 'ADD' | 'UPDATE' | 'REMOVE';
  oldValue?: any;
  newValue?: any;
  description: string;
}

export interface ConsensusState {
  groups: Map<string, ConsensusGroup>;
  allSubmitters: Set<string>;
}

export interface ConsensusStatusOptions {
  fromBlock: number;
  toBlock?: number;
  rpcUrl: string;
  outputCsv: string;
  contractAddress?: string;
  blockChunkSize?: number;
  eventBatchSize?: number;
  parallelWorkers?: number;
  memoryLimit?: number;
  gatewayUrl?: string; // IPFS gateway URL for fetching data
  analyzeDifferences?: boolean; // Whether to analyze differences for partial consensus
  progressInterval?: number;
}

export interface StreamingOptions {
  blockChunkSize?: number;
  eventBatchSize?: number;
  retryAttempts?: number;
  retryDelay?: number;
}
