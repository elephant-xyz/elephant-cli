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
  error: string;
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
