export interface FileEntry {
  propertyCid: string;
  dataGroupCid: string;
  filePath: string;
}

export interface ValidationResult {
  success: boolean;
  error?: string;
  filePath: string;
  propertyCid: string;
  dataGroupCid: string;
}

export interface ProcessingState {
  totalFiles: number;
  processed: number;
  errors: number;
  warnings: number;
  uploaded: number;
  submitted: number;
}

export interface ProcessedFile {
  propertyCid: string;
  dataGroupCid: string;
  filePath: string;
  canonicalJson: string;
  calculatedCid: string;
  validationPassed: boolean;
}

export interface UploadResult {
  success: boolean;
  cid?: string;
  error?: string;
  propertyCid: string;
  dataGroupCid: string;
}

export interface ErrorEntry {
  propertyCid: string;
  dataGroupCid: string;
  filePath: string;
  errorPath: string;
  errorMessage: string;
  timestamp: string;
}

export interface WarningEntry {
  propertyCid: string;
  dataGroupCid: string;
  filePath: string;
  reason: string;
  timestamp: string;
}

export interface ReportSummary {
  totalFiles: number;
  processedFiles: number;
  errorCount: number;
  warningCount: number;
  uploadedFiles: number;
  submittedBatches: number;
  startTime: Date;
  endTime: Date;
  duration: number;
}

export interface UnsignedTransaction {
  to: string;
  data: string;
  value: string;
  gasLimit: string;
  gasPrice?: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
  nonce: number;
  chainId: number;
  type: number;
}

export interface UnsignedTransactionEntry {
  batchId: number;
  itemCount: number;
  propertyCids: string;
  dataGroupCids: string;
  dataCids: string;
  to: string;
  data: string;
  value: string;
  gasLimit: string;
  gasPrice?: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
  nonce: number;
  chainId: number;
  type: number;
  timestamp: string;
}

// EIP-1474 compliant transaction object for eth_sendTransaction
export interface EIP1474Transaction {
  from: string;
  to: string;
  gas: string;
  gasPrice?: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
  value: string;
  data: string;
  nonce: string;
  type?: string;
}

// Extended transaction with metadata for JSON output
export interface UnsignedTransactionWithMetadata {
  batchId: number;
  itemCount: number;
  propertyCids: string[];
  dataGroupCids: string[];
  dataCids: string[];
  transaction: EIP1474Transaction;
  timestamp: string;
}
