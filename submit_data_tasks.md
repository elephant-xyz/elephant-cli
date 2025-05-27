# Submit Data Implementation Tasks

## Phase 1: Foundation Types and Interfaces

### Task 1.1: Create submit-specific types
- Create `src/types/submit.types.ts`
- Define `FileEntry` interface with propertyCid, dataGroupCid, filePath
- Define `ValidationResult` interface with success, error, filePath
- Add unit test to verify type exports

### Task 1.2: Create contract types
- Create `src/types/contract.types.ts`
- Define `DataItem` interface matching smart contract struct
- Define `ContractMethods` interface with method signatures
- Add getCurrentFieldDataCID and getParticipantsForConsensusDataCID signatures
- Add submitBatchData signature

### Task 1.3: Create processing state types
- Extend `src/types/submit.types.ts`
- Add `ProcessingState` interface with counters
- Add `ProcessedFile` interface with all metadata
- Add `UploadResult` interface

### Task 1.4: Create error/warning types
- Extend `src/types/submit.types.ts`
- Add `ErrorEntry` interface with propertyCid, dataGroupCid, error
- Add `WarningEntry` interface with propertyCid, dataGroupCid, reason
- Add `ReportSummary` interface

## Phase 2: Configuration

### Task 2.1: Create submit configuration
- Create `src/config/submit.config.ts`
- Define default concurrency limits
- Define batch sizes
- Export `SubmitConfig` interface and defaults

### Task 2.2: Add contract configuration
- Update `src/config/constants.ts`
- Add contract ABI for new methods
- Ensure contract address is defined
- Add Pinata configuration constants

## Phase 3: Basic Services Setup

### Task 3.1: Create CSV reporter service skeleton
- Create `src/services/csv-reporter.service.ts`
- Implement constructor with file paths
- Add `logError` method that writes to errors.csv
- Add `logWarning` method that writes to warnings.csv
- Add basic unit test writing one entry

### Task 3.2: Create file scanner service skeleton
- Create `src/services/file-scanner.service.ts`
- Implement `validateStructure` method checking directory exists
- Add method to check if directory name is valid CID format
- Add unit test with mock directory

### Task 3.3: Implement file scanner directory traversal
- Add `scanDirectory` async generator method
- Yield batches of FileEntry objects
- Validate property CID directories
- Validate data group CID filenames
- Add test with mock file system

## Phase 4: Schema Management

### Task 4.1: Create schema cache service skeleton
- Create `src/services/schema-cache.service.ts`
- Implement LRU cache initialization
- Add `has` method to check cache
- Add unit test for cache initialization

### Task 4.2: Add schema downloading
- Implement `getSchema` method
- Use existing IPFS service for download
- Parse downloaded JSON
- Store in cache
- Add test with mock IPFS service

### Task 4.3: Add schema batch preloading
- Implement `preloadSchemas` method
- Download schemas in parallel (max 10)
- Handle errors gracefully
- Add test for batch loading

## Phase 5: CID Calculation

### Task 5.1: Create CID calculator service
- Create `src/services/cid-calculator.service.ts`
- Implement `calculateCidV0` using multiformats
- Add method to convert string to Buffer
- Add unit test with known CID

### Task 5.2: Add batch CID calculation
- Implement `calculateBatch` method
- Process array of buffers
- Return array of CIDs
- Add performance test

## Phase 6: JSON Processing Setup

### Task 6.1: Create JSON canonicalizer service
- Create `src/services/json-canonicalizer.service.ts`
- Install json-canonicalize dependency
- Implement `canonicalize` method
- Add unit test with sample JSON

### Task 6.2: Create JSON validator service skeleton
- Create `src/services/json-validator.service.ts`
- Install ajv dependency
- Initialize AJV with draft-07 support
- Add basic validation method
- Test with simple schema

## Phase 7: Worker Infrastructure

### Task 7.1: Create worker pool utility
- Create `src/utils/worker-pool.ts`
- Implement basic worker pool class
- Add spawn and terminate methods
- Add task distribution logic
- Unit test with simple worker

### Task 7.2: Create validation worker
- Create `src/workers/validation.worker.ts`
- Set up worker message handling
- Implement AJV validation logic
- Handle validation errors
- Test worker in isolation

### Task 7.3: Create serialization worker
- Create `src/workers/serialization.worker.ts`
- Set up worker message handling
- Implement canonicalization logic
- Handle serialization errors
- Test worker in isolation

### Task 7.4: Integrate workers with services
- Update JsonValidatorService to use worker pool
- Update JsonCanonicalizerService to use worker pool
- Add batch processing methods
- Test with concurrent operations

## Phase 8: Queue Management

### Task 8.1: Create queue manager utility
- Create `src/utils/queue-manager.ts`
- Implement async queue with concurrency control
- Add push, process, and drain methods
- Unit test queue behavior

### Task 8.2: Create progress tracker utility
- Create `src/utils/progress-tracker.ts`
- Track files processed, uploaded, submitted
- Calculate rates and ETA
- Add method to get current metrics
- Test calculations

## Phase 9: Blockchain Integration

### Task 9.1: Create chain state service skeleton
- Create `src/services/chain-state.service.ts`
- Extend BlockchainService
- Add method signatures
- Set up ethers contract instance

### Task 9.2: Implement getCurrentDataCid
- Implement single query method
- Handle CID encoding/decoding
- Add retry logic
- Test with mock contract

### Task 9.3: Implement getSubmittedParticipants
- Implement participants query
- Parse address array response
- Add current address checking
- Test with mock data

### Task 9.4: Add batch chain queries
- Implement multicall for batch queries
- Create batch getCurrentDataCid method
- Add result mapping
- Test batch performance

## Phase 10: IPFS Upload

### Task 10.1: Create Pinata service skeleton
- Create `src/services/pinata.service.ts`
- Install @pinata/sdk dependency
- Initialize Pinata client
- Add authentication setup

### Task 10.2: Implement single file upload
- Implement `uploadFile` method
- Handle Buffer to IPFS upload
- Add pinning metadata
- Test with small file

### Task 10.3: Add upload queue
- Integrate queue manager
- Limit concurrent uploads to 10
- Add retry logic
- Test queue behavior

### Task 10.4: Implement batch upload
- Add `uploadBatch` method
- Track upload progress
- Handle failures gracefully
- Test with multiple files

## Phase 11: Transaction Management

### Task 11.1: Create transaction batcher skeleton
- Create `src/services/transaction-batcher.service.ts`
- Set up contract interface
- Add wallet management
- Initialize with private key

### Task 11.2: Implement transaction batching logic
- Create method to group items by 200
- Calculate data encoding
- Estimate gas for batch
- Test batch creation

### Task 11.3: Implement single batch submission
- Implement `submitBatch` method
- Add gas price optimization
- Handle transaction sending
- Wait for confirmation
- Test with mock blockchain

### Task 11.4: Implement multi-batch submission
- Add `submitAll` async generator
- Handle nonce management
- Add retry for failed transactions
- Test sequential submission

## Phase 12: Main Command Integration

### Task 12.1: Create submit command skeleton
- Create `src/commands/submit-files.ts`
- Add basic command structure
- Parse command arguments
- Validate input directory

### Task 12.2: Implement discovery phase
- Use FileScannerService
- Count total files
- Initialize progress tracking
- Set up CSV reporters

### Task 12.3: Implement validation phase
- Set up validation queue
- Process files through validator
- Route errors to CSV
- Update progress

### Task 12.4: Implement processing phase
- Canonicalize valid files
- Calculate CIDs
- Check chain state
- Route warnings to CSV

### Task 12.5: Implement upload phase
- Queue processed files
- Upload to IPFS
- Track uploaded CIDs
- Update progress

### Task 12.6: Implement transaction phase
- Batch uploaded items
- Submit transactions
- Monitor completion
- Final summary

### Task 12.7: Add error handling
- Wrap phases in try-catch
- Handle graceful shutdown
- Save checkpoint on interrupt
- Clean up resources

## Phase 13: CLI Integration

### Task 13.1: Add submit command to CLI
- Update `src/index.ts`
- Add command definition
- Add all options
- Wire to command handler

### Task 13.2: Add environment validation
- Check for PRIVATE_KEY env var
- Check for PINATA_JWT env var
- Validate RPC URL option
- Show helpful errors

### Task 13.3: Add dry-run support
- Add --dry-run flag
- Skip upload phase if enabled
- Skip transaction phase if enabled
- Show what would be done

## Phase 14: Progress and Monitoring

### Task 14.1: Integrate progress bars
- Use existing ProgressIndicator
- Show phase progress
- Show file counts
- Update ETA regularly

### Task 14.2: Add detailed logging
- Use existing logger
- Log phase transitions
- Log batch completions
- Log error summaries

### Task 14.3: Add performance metrics
- Track processing rates
- Calculate throughput
- Monitor memory usage
- Log metrics periodically

## Phase 15: Testing

### Task 15.1: Create integration test setup
- Create test directory structure
- Add sample JSON files
- Add test schemas
- Mock blockchain responses

### Task 15.2: Test full flow with small dataset
- Test 10 files end-to-end
- Verify CSV outputs
- Check transaction creation
- Validate final state

### Task 15.3: Test error scenarios
- Test invalid JSON
- Test schema validation failures
- Test duplicate detection
- Verify error handling

### Task 15.4: Test resume capability
- Interrupt processing
- Check checkpoint creation
- Resume from checkpoint
- Verify completion

## Phase 16: Optimization

### Task 16.1: Profile memory usage
- Run with 10,000 files
- Monitor memory consumption
- Identify memory leaks
- Optimize object creation

### Task 16.2: Optimize worker performance
- Benchmark worker throughput
- Tune batch sizes
- Optimize message passing
- Measure improvements

### Task 16.3: Optimize network calls
- Batch more aggressively
- Add connection pooling
- Tune retry delays
- Measure latency reduction

## Phase 17: Documentation

### Task 17.1: Add command documentation
- Update README with new command
- Document all options
- Add usage examples
- Include performance tips

### Task 17.2: Update CLAUDE.md
- Add submit command context
- Document architecture decisions
- Add troubleshooting section
- Include test examples

### Task 17.3: Add inline documentation
- Document service methods
- Add JSDoc comments
- Document complex algorithms
- Add error code descriptions

## Completion Checklist

- [ ] All services have unit tests
- [ ] Integration tests pass
- [ ] Memory usage is acceptable
- [ ] Progress tracking works
- [ ] Error handling is comprehensive
- [ ] Documentation is complete
- [ ] Code follows project style
- [ ] Performance meets requirements