/** Errors per check of a county CAR. */
export interface CarSummary {
  blocks: number;
  properties: number;
  groups: number;
  lookups: number;
  errors: Record<'integrity' | 'root' | 'index' | 'graph' | 'lexicon' | 'orphans', number>;
}

export interface ValidateOptions {
  /** A property directory or ZIP, a directory of properties, or a county `.car`. */
  input: string;
  outputCsv?: string;
  cwd?: string;
}

export interface ValidateResult {
  success: boolean;
  totalFiles: number;
  errors: number;
  processed: number;
  skipped: number;
  errorCsvPath: string;
  error?: string;
  car?: CarSummary;
}

export interface HashOptions {
  input: string;
  outputZip?: string;
  outputCsv?: string;
  outputCar?: string;
  cwd?: string;
}

export interface HashResult {
  success: boolean;
  outputZipPath: string;
  outputCsvPath: string;
  outputCarPath?: string;
  carRoot?: string;
  propertyCid?: string;
  totalFiles: number;
  processed: number;
  errors: number;
  error?: string;
}

export interface ExportTablesOptions {
  input: string;
  output: string;
  partSize?: string | number;
  outputJson?: string;
  atlasPage?: string;
  county?: string;
  state?: string;
  fips?: string;
  cwd?: string;
}

export interface ExportTablesResult {
  success: boolean;
  error?: string;
  output?: string;
  car?: string;
  root?: string;
  countyRoot?: string;
  partSizeBytes?: number;
  codec?: string;
  tables?: Record<string, { rows: number; parts: number }>;
  parts?: number;
  exportedAt?: string;
  atlas?: { page: string; group: string };
}

export interface UploadOptions {
  /** A county `.car` or a tables directory written by `exportTables`. */
  input: string;
  api?: string;
  token?: string;
  gateway?: string;
  timeout?: number | string;
  outputJson?: string;
  cwd?: string;
}

export interface UploadResult {
  success: boolean;
  cid?: string;
  error?: string;
  api?: string;
  root?: string;
  blocks?: number;
  countyRoot?: string;
  parts?: number;
  gatewayUrl?: string;
  uploadedAt?: string;
}

export interface TransformOptions {
  inputZip: string;
  outputZip?: string;
  scriptsZip?: string;
  transformZip?: string;
  transformVersion?: 2 | '2';
  dataGroup?: string;
  cwd?: string;
}

export interface TransformFailureDetail {
  message: string;
  stdout?: string;
  stderr?: string;
}

export interface TransformResult {
  success: boolean;
  outputPath: string;
  error?: string;
  scriptFailure?: TransformFailureDetail;
}

export interface PrepareOptions {
  clickContinue?: boolean;
  continueButtonSelector?: string;
  useBrowser?: boolean;
  browserFlowTemplate?: string;
  browserFlowParameters?: string;
  browserFlowFile?: string;
  browserFlowVersion?: 2 | '2';
  browserFlowZip?: string;
  ignoreCaptcha?: boolean;
  proxy?: string;
  multiRequestFlowFile?: string;
  inputCsv?: string;
  cwd?: string;
}

export function validate(options: ValidateOptions): Promise<ValidateResult>;
export function hash(options: HashOptions): Promise<HashResult>;
export function exportTables(options: ExportTablesOptions): Promise<ExportTablesResult>;
export function upload(options: UploadOptions): Promise<UploadResult>;
export function transform(options: TransformOptions): Promise<TransformResult>;
/** Resolves when the output ZIP is written; rejects with the reason otherwise. */
export function prepare(inputZip: string | undefined, outputZip: string, options?: PrepareOptions): Promise<void>;
