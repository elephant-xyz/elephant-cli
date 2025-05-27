# Submit Data Implementation Tasks (Simplified - No Multiprocessing)

## Phase 1: Foundation Types and Interfaces ✅

### Task 1.1: Create submit-specific types ✅
### Task 1.2: Create contract types ✅
### Task 1.3: Create processing state types ✅
### Task 1.4: Create error/warning types ✅

## Phase 2: Configuration ✅

### Task 2.1: Create submit configuration ✅
### Task 2.2: Add contract configuration ✅

## Phase 3: Basic Services Setup ✅

### Task 3.1: Create CSV reporter service skeleton ✅
### Task 3.2: Create file scanner service skeleton ✅
### Task 3.3: Implement file scanner directory traversal ✅

## Phase 4: Schema Management ✅

### Task 4.1: Create schema cache service skeleton ✅
### Task 4.2: Add schema downloading ✅
### Task 4.3: Add schema batch preloading ✅

## Phase 5: CID Calculation ✅

### Task 5.1: Create CID calculator service ✅
### Task 5.2: Add batch CID calculation ✅

## Phase 6: JSON Processing Setup (Simplified) ✅

### Task 6.1: Create JSON canonicalizer service ✅
- Remove worker pool integration ✅
- Keep synchronous canonicalization ✅

### Task 6.2: Create JSON validator service skeleton ✅
- Remove worker pool integration ✅
- Keep synchronous validation ✅

## Phase 7: Queue Management (Simplified) ✅

### Task 7.1: Create simple queue manager utility ✅
- Single-threaded processing ✅
- No worker pool needed ✅

### Task 7.2: Create progress tracker utility ✅

## Phase 8: Skip Worker Infrastructure ✅
- No workers needed ✅
- Process files sequentially or with simple async concurrency ✅

## Phase 9: Blockchain Integration

### Task 9.1: Create chain state service skeleton
- Extend BlockchainService
- Add method signatures
- Set up ethers contract instance

### Task 9.2: Implement getCurrentDataCid
- Implement single query method
- Handle CID encoding/decoding
- Add retry logic

### Task 9.3: Implement getSubmittedParticipants
- Implement participants query
- Parse address array response
- Add current address checking

### Task 9.4: Add batch chain queries
- Simple Promise.all for concurrent queries
- Create batch getCurrentDataCid method
- Add result mapping

## Phase 10: IPFS Upload

### Task 10.1: Create Pinata service skeleton
- Initialize Pinata client
- Add authentication setup

### Task 10.2: Implement single file upload
- Implement `uploadFile` method
- Handle Buffer to IPFS upload
- Add pinning metadata

### Task 10.3: Add upload queue
- Use simple queue manager (no workers)
- Limit concurrent uploads
- Add retry logic

### Task 10.4: Implement batch upload
- Add `uploadBatch` method
- Track upload progress
- Handle failures gracefully

## Phase 11: Transaction Management

### Task 11.1: Create transaction batcher skeleton
- Set up contract interface
- Add wallet management
- Initialize with private key

### Task 11.2: Implement transaction batching logic
- Create method to group items by 200
- Calculate data encoding
- Estimate gas for batch

### Task 11.3: Implement single batch submission
- Implement `submitBatch` method
- Add gas price optimization
- Handle transaction sending
- Wait for confirmation

### Task 11.4: Implement multi-batch submission
- Add `submitAll` async generator
- Handle nonce management
- Add retry for failed transactions

## Phase 12: Main Command Integration

### Task 12.1: Create submit command skeleton
- Add basic command structure
- Parse command arguments
- Validate input directory

### Task 12.2: Implement discovery phase
- Use FileScannerService
- Count total files
- Initialize progress tracking
- Set up CSV reporters

### Task 12.3: Implement validation phase
- Process files sequentially or with controlled concurrency
- Use JsonValidatorService directly (no workers)
- Route errors to CSV
- Update progress

### Task 12.4: Implement processing phase
- Canonicalize valid files directly (no workers)
- Calculate CIDs
- Check chain state
- Route warnings to CSV

### Task 12.5: Implement upload phase
- Queue processed files
- Upload to IPFS with concurrency control
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

### Task 16.2: Optimize async concurrency
- Tune concurrent operations
- Balance memory vs speed
- Optimize batch sizes
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