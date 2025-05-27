# Submit Data Architecture

## Overview

The submit-files command is designed to handle millions of files efficiently by validating JSON data against schemas, checking on-chain state, uploading to IPFS, and submitting batched transactions to the blockchain.

## File Structure

```
src/
├── commands/
│   └── submit-files.ts              # Main command handler and orchestration
├── services/
│   ├── file-scanner.service.ts      # Directory traversal and file discovery
│   ├── schema-cache.service.ts      # JSON schema caching with LRU
│   ├── json-validator.service.ts    # JSON validation against schemas
│   ├── json-canonicalizer.service.ts # RFC8785 canonicalization
│   ├── cid-calculator.service.ts    # CID v0 calculation
│   ├── chain-state.service.ts       # On-chain data queries
│   ├── pinata.service.ts            # IPFS upload via Pinata
│   ├── transaction-batcher.service.ts # Transaction batching and submission
│   └── csv-reporter.service.ts      # Error/warning CSV generation
├── workers/
│   ├── validation.worker.ts         # Worker process for JSON validation
│   └── serialization.worker.ts      # Worker process for canonicalization
├── types/
│   ├── submit.types.ts              # Submit-specific types
│   └── contract.types.ts            # Smart contract ABI types
├── utils/
│   ├── worker-pool.ts               # Worker process pool management
│   ├── queue-manager.ts             # Async queue with concurrency control
│   └── progress-tracker.ts          # Progress tracking with ETA
└── config/
    └── submit.config.ts             # Submit command configuration

```

## Core Components

### 1. File Scanner Service
**Purpose**: Discovers and validates directory structure
```typescript
interface FileEntry {
  propertyCid: string;
  dataGroupCid: string;
  filePath: string;
}

class FileScannerService {
  async scanDirectory(path: string): AsyncGenerator<FileEntry[]>;
  validateStructure(path: string): ValidationResult;
}
```
- Uses async generators for memory-efficient streaming
- Validates directory naming (property CIDs)
- Validates file naming (data group CIDs)
- Batches files for processing

### 2. Schema Cache Service
**Purpose**: Downloads and caches JSON schemas from IPFS
```typescript
class SchemaCacheService {
  private cache: LRUCache<string, JSONSchema>;
  
  async getSchema(dataGroupCid: string): Promise<JSONSchema>;
  preloadSchemas(cids: string[]): Promise<void>;
}
```
- LRU cache with configurable size
- Parallel schema downloads
- Persistent disk cache option
- Retry logic for failed downloads

### 3. JSON Validator Service
**Purpose**: Validates JSON files against schemas using worker processes
```typescript
class JsonValidatorService {
  private workerPool: WorkerPool;
  
  async validateBatch(files: ValidationTask[]): Promise<ValidationResult[]>;
}
```
- Worker pool for CPU-intensive validation
- Ajv for JSON schema validation
- Batch processing for efficiency
- Error message formatting

### 4. JSON Canonicalizer Service
**Purpose**: Serializes JSON using RFC8785 standard
```typescript
class JsonCanonicalizerService {
  private workerPool: WorkerPool;
  
  async canonicalizeBatch(files: SerializationTask[]): Promise<CanonicalResult[]>;
}
```
- Worker pool for serialization
- json-canonicalize library
- Batch processing
- Memory-efficient streaming

### 5. CID Calculator Service
**Purpose**: Calculates IPFS CID v0 for canonicalized JSON
```typescript
class CidCalculatorService {
  calculateCidV0(data: Buffer): string;
  calculateBatch(dataArray: Buffer[]): string[];
}
```
- Uses multiformats/cid library
- Supports batch calculation
- Memory-efficient buffer handling

### 6. Chain State Service
**Purpose**: Queries on-chain state for existing data
```typescript
class ChainStateService {
  async getCurrentDataCid(propertyCid: string, dataGroupCid: string): Promise<string>;
  async getSubmittedParticipants(
    propertyCid: string, 
    dataGroupCid: string, 
    dataCid: string
  ): Promise<string[]>;
  
  // Batch methods for efficiency
  async batchGetCurrentDataCids(items: DataQuery[]): Promise<Map<string, string>>;
}
```
- Batch RPC calls using multicall
- Result caching
- Connection pooling
- Retry logic

### 7. Pinata Service
**Purpose**: Uploads files to IPFS via Pinata
```typescript
class PinataService {
  private uploadQueue: Queue;
  
  async uploadFile(data: Buffer, metadata: PinMetadata): Promise<string>;
  async uploadBatch(files: UploadTask[]): Promise<UploadResult[]>;
}
```
- Concurrent upload queue (max 10)
- Retry logic with backoff
- Progress tracking per file
- Pinning metadata support

### 8. Transaction Batcher Service
**Purpose**: Batches and submits blockchain transactions
```typescript
class TransactionBatcherService {
  private batchSize = 200;
  
  async submitBatch(items: DataItem[]): Promise<TransactionReceipt>;
  async submitAll(items: DataItem[]): AsyncGenerator<BatchResult>;
}
```
- Batches items into 200-item transactions
- Gas estimation and optimization
- Transaction monitoring
- Retry failed transactions
- Nonce management

### 9. CSV Reporter Service
**Purpose**: Generates error and warning CSV files
```typescript
class CsvReporterService {
  private errorWriter: CsvWriter;
  private warningWriter: CsvWriter;
  
  async logError(entry: ErrorEntry): Promise<void>;
  async logWarning(entry: WarningEntry): Promise<void>;
  async finalize(): Promise<ReportSummary>;
}
```
- Streaming CSV writers
- Buffered writes for performance
- Atomic file operations
- Summary statistics

## Data Flow

### 1. Discovery Phase
```
Directory → FileScannerService → FileEntry[] → Queue
```
- Scan directory structure
- Validate naming conventions
- Generate file entries
- Push to processing queue

### 2. Validation Phase (Parallel)
```
FileEntry → SchemaCache → Validator → ValidationResult
    ↓           ↓            ↓
  Schema    Worker Pool   Pass/Fail
```
- Fetch schema (cached)
- Validate in worker process
- Route to next phase or error log

### 3. Processing Phase (Parallel)
```
ValidFile → Canonicalizer → CID Calculator → Chain State Check
    ↓            ↓               ↓                  ↓
  Worker     Canonical        CID v0          Skip/Continue
```
- Canonicalize JSON
- Calculate CID
- Check if already on-chain
- Check if already submitted by user

### 4. Upload Phase (Queued)
```
ProcessedFile → Upload Queue → Pinata → CID → Transaction Queue
                    ↓            ↓       ↓
                Rate Limit    Retry   Store
```
- Queue for rate limiting
- Upload with retries
- Store CID for transaction

### 5. Transaction Phase (Batched)
```
DataItems[] → Batcher → Transaction → Receipt
    ↓           ↓           ↓           ↓
  Groups     Gas Est    Submit      Monitor
```
- Batch into 200-item groups
- Estimate gas
- Submit transactions
- Monitor completion

## State Management

### 1. In-Memory State
```typescript
interface ProcessingState {
  totalFiles: number;
  processed: number;
  errors: number;
  warnings: number;
  uploaded: number;
  submitted: number;
  
  // Queues
  validationQueue: Queue<FileEntry>;
  uploadQueue: Queue<ProcessedFile>;
  transactionQueue: Queue<DataItem>;
}
```

### 2. Persistent State
```typescript
interface CheckpointState {
  lastProcessedFile: string;
  uploadedCids: Map<string, string>;
  submittedBatches: string[];
  timestamp: number;
}
```
- Checkpoint files for resume capability
- SQLite for larger datasets
- Periodic snapshots

### 3. Cache State
- Schema cache (LRU in-memory + disk)
- Chain state cache (TTL-based)
- CID calculation cache

## Concurrency Model

### 1. Worker Pools
- **Validation Workers**: CPU cores - 1
- **Serialization Workers**: CPU cores / 2
- Each worker handles batches of 100 files

### 2. Async Queues
- **File Reading**: 100 concurrent
- **Schema Downloads**: 10 concurrent
- **Chain Queries**: 20 concurrent
- **IPFS Uploads**: 10 concurrent
- **Transactions**: Sequential (nonce management)

### 3. Batching Strategy
- **File Discovery**: 1000 files per batch
- **Validation**: 100 files per worker task
- **Chain Queries**: 50 queries per multicall
- **Uploads**: Individual (rate limited)
- **Transactions**: 200 items per tx

## Error Handling

### 1. Recoverable Errors
- Network timeouts → Retry with backoff
- Rate limits → Queue with delay
- Gas estimation failures → Adjust and retry

### 2. Non-Recoverable Errors
- Invalid JSON structure → Log to errors.csv
- Schema validation failure → Log to errors.csv
- Insufficient funds → Halt with clear message

### 3. Warnings
- Duplicate data (already on-chain) → Log to warnings.csv
- Already submitted by user → Log to warnings.csv
- Schema download slow → Continue with warning

## Progress Tracking

```typescript
interface ProgressMetrics {
  // Rates
  filesPerSecond: number;
  uploadsPerSecond: number;
  
  // Estimates
  estimatedTimeRemaining: number;
  estimatedCost: BigNumber;
  
  // Current state
  currentPhase: ProcessingPhase;
  queueDepths: QueueMetrics;
}
```

## Configuration

```typescript
interface SubmitConfig {
  // Concurrency
  maxConcurrentReads: number;
  maxConcurrentValidations: number;
  maxConcurrentUploads: number;
  
  // Batching
  validationBatchSize: number;
  transactionBatchSize: number;
  
  // Caching
  schemaCacheSize: number;
  enableDiskCache: boolean;
  
  // Retry
  maxRetries: number;
  retryDelay: number;
  
  // Output
  errorCsvPath: string;
  warningCsvPath: string;
  checkpointPath: string;
}
```

## Integration Points

### 1. CLI Command
```typescript
program
  .command('submit-files')
  .argument('<directory>', 'Directory containing property/data files')
  .option('--rpc-url <url>', 'RPC endpoint')
  .option('--max-concurrent <number>', 'Max concurrent operations')
  .option('--checkpoint <path>', 'Checkpoint file for resume')
  .option('--dry-run', 'Validate without submitting')
  .action(submitFilesCommand);
```

### 2. Environment Variables
- `PRIVATE_KEY`: Wallet private key
- `PINATA_JWT`: Pinata API token
- `RPC_URL`: Blockchain RPC endpoint

### 3. Existing Services
- Reuse `BlockchainService` for RPC connection
- Extend `IpfsService` for Pinata integration
- Utilize `ProgressIndicator` for UI

## Performance Optimizations

1. **Memory Management**
   - Stream large files instead of loading into memory
   - Use object pools for frequently created objects
   - Clear caches periodically

2. **I/O Optimization**
   - Batch file reads
   - Use memory-mapped files for large datasets
   - Parallel directory scanning

3. **Network Optimization**
   - Connection pooling
   - Request batching
   - Compression for large payloads

4. **CPU Optimization**
   - Worker processes for CPU-intensive tasks
   - SIMD operations for CID calculation
   - Batch processing to reduce overhead

## Monitoring and Metrics

```typescript
interface PerformanceMetrics {
  // Timing
  avgValidationTime: number;
  avgUploadTime: number;
  avgTransactionTime: number;
  
  // Throughput
  filesProcessedPerMinute: number;
  mbUploadedPerMinute: number;
  
  // Resources
  memoryUsage: number;
  cpuUsage: number;
  networkBandwidth: number;
}
```

## Future Enhancements

1. **Resume Capability**
   - Persistent checkpoint system
   - Transaction recovery
   - Partial batch resubmission

2. **Distributed Processing**
   - Redis queue for multi-machine processing
   - Shared cache layer
   - Coordinated transaction submission

3. **Advanced Features**
   - Real-time progress dashboard
   - Cost estimation and optimization
   - Automatic gas price adjustment
   - Multi-chain support