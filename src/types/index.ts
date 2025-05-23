export interface Assignment {
  cid: string;
  oracle: string;
  blockNumber: number;
  transactionHash: string;
  timestamp?: number;
}

export interface CommandOptions {
  oracle: string;
  contract?: string;
  rpc?: string;
  gateway?: string;
  fromBlock?: string;
  downloadDir?: string;
}

export interface DownloadResult {
  cid: string;
  success: boolean;
  path?: string;
  error?: Error;
}