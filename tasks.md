# Oracle Network CLI MVP Build Plan

## Phase 1: Project Setup

### Task 1.1: Initialize TypeScript Project

**Start**: Empty directory  
**End**: Basic TypeScript project with package.json and tsconfig.json  
**Test**: Run `npm run build` successfully

### Task 1.2: Add Project Dependencies

**Start**: Basic TypeScript project  
**End**: All required dependencies installed (commander, ethers, axios, chalk, ora)  
**Test**: Import each dependency in a test file without errors

### Task 1.3: Create Folder Structure

**Start**: Project with dependencies  
**End**: All folders created as per architecture (src/, src/commands/, etc.)  
**Test**: Verify folder structure matches architecture document

### Task 1.4: Setup Build Scripts

**Start**: Project with folders  
**End**: package.json with build, dev, and clean scripts  
**Test**: `npm run build` creates dist/ folder

## Phase 2: Basic Types and Constants

### Task 2.1: Create Type Definitions

**Start**: Empty src/types/index.ts  
**End**: File with Assignment, CommandOptions, and DownloadResult interfaces  
**Test**: Import types in a test file, create sample objects

### Task 2.2: Create Constants File

**Start**: Empty src/config/constants.ts  
**End**: File with DEFAULT_CONTRACT_ADDRESS (use placeholder), DEFAULT_RPC_URL, DEFAULT_IPFS_GATEWAY  
**Test**: Import and console.log each constant

### Task 2.3: Create ABI File

**Start**: Empty src/config/abi.ts  
**End**: File with ORACLE_CONTRACT_ABI containing the OracleAssigned event  
**Test**: Import ABI and verify it's an array with one event object

## Phase 3: Basic CLI Entry Point

### Task 3.1: Create Minimal CLI Entry

**Start**: Empty src/index.ts  
**End**: CLI that accepts 'list-assignments' command with --oracle flag only  
**Test**: Run `node dist/index.js list-assignments --oracle 0x123` (should not error)

### Task 3.2: Add Remaining CLI Options

**Start**: CLI with oracle flag  
**End**: CLI with all flags (contract, rpc, gateway, from-block, download-dir)  
**Test**: Run with all flags, verify they're parsed correctly

### Task 3.3: Create Stub Command Handler

**Start**: CLI with all options  
**End**: src/commands/list-assignments.ts that logs received options  
**Test**: Run CLI and verify options are logged correctly

## Phase 4: Validation Utilities

### Task 4.1: Create Address Validator

**Start**: Empty src/utils/validation.ts  
**End**: Function `isValidAddress(address: string): boolean`  
**Test**: Test with valid/invalid Ethereum addresses

### Task 4.2: Create URL Validator

**Start**: validation.ts with address validator  
**End**: Add function `isValidUrl(url: string): boolean`  
**Test**: Test with valid/invalid URLs

### Task 4.3: Add Validation to Command

**Start**: Command handler without validation  
**End**: Command validates oracle address and URLs before proceeding  
**Test**: Run with invalid inputs, verify error messages

## Phase 5: Blockchain Service Core

### Task 5.1: Create BlockchainService Class Shell

**Start**: Empty src/services/blockchain.service.ts  
**End**: Class with constructor accepting rpcUrl, contractAddress, abi  
**Test**: Instantiate service with test values

### Task 5.2: Add Provider Connection

**Start**: BlockchainService shell  
**End**: Service creates ethers.JsonRpcProvider in constructor  
**Test**: Create service, verify provider exists (mock if needed)

### Task 5.3: Add Contract Instance

**Start**: BlockchainService with provider  
**End**: Service creates ethers.Contract instance  
**Test**: Verify contract has expected methods

### Task 5.4: Implement getCurrentBlock

**Start**: BlockchainService with contract  
**End**: Method `getCurrentBlock(): Promise<number>`  
**Test**: Call method, verify it returns a number

### Task 5.5: Create Event Query Method Stub

**Start**: BlockchainService with getCurrentBlock  
**End**: Method `getOracleAssignedEvents` that returns empty array  
**Test**: Call method, verify empty array returned

## Phase 6: Event Decoder Service

### Task 6.1: Create EventDecoderService Class

**Start**: Empty src/services/event-decoder.service.ts  
**End**: Class with empty methods  
**Test**: Instantiate service

### Task 6.2: Implement CID Decoder

**Start**: EventDecoderService class  
**End**: Method `decodePropertyCid(bytes: string): string` using ethers.toUtf8String  
**Test**: Test with sample hex string

### Task 6.3: Add CID Validation

**Start**: CID decoder without validation  
**End**: Decoder validates output is valid CID format  
**Test**: Test with valid/invalid hex inputs

## Phase 7: Connect Blockchain to Decoder

### Task 7.1: Implement Basic Event Query

**Start**: Stub getOracleAssignedEvents  
**End**: Query events for specific oracle address (hardcode block range 0-1000)  
**Test**: Run against Polygon mainnet, log raw events

### Task 7.2: Add Event Parsing

**Start**: Raw event query  
**End**: Parse events using EventDecoder, return Assignment objects  
**Test**: Verify Assignment objects have correct structure

### Task 7.3: Add Block Range Parameters

**Start**: Hardcoded block range  
**End**: Use fromBlock and toBlock parameters  
**Test**: Query different block ranges

## Phase 8: Basic IPFS Service

### Task 8.1: Create IPFSService Class Shell

**Start**: Empty src/services/ipfs.service.ts  
**End**: Class with constructor accepting gateway URL  
**Test**: Instantiate service

### Task 8.2: Implement Single File Download

**Start**: IPFSService shell  
**End**: Method `downloadFile(cid: string, outputPath: string): Promise<void>`  
**Test**: Download a known test CID

### Task 8.3: Add Download Directory Creation

**Start**: Download without directory handling  
**End**: Create directory if it doesn't exist  
**Test**: Download to non-existent directory

### Task 8.4: Add Error Handling

**Start**: Download without error handling  
**End**: Proper try/catch, return success/failure status  
**Test**: Try downloading invalid CID

## Phase 9: Connect Everything in Command

### Task 9.1: Instantiate All Services

**Start**: Command with validation only  
**End**: Create all three services in command handler  
**Test**: Run command, verify no instantiation errors

### Task 9.2: Implement Event Fetching

**Start**: Services instantiated  
**End**: Fetch events using BlockchainService  
**Test**: Run command, see events logged

### Task 9.3: Implement Sequential Downloads

**Start**: Events fetched  
**End**: Download each CID one by one (no concurrency yet)  
**Test**: Run command, verify files downloaded

## Phase 10: Add Progress Indicators

### Task 10.1: Create Simple Logger

**Start**: Empty src/utils/logger.ts  
**End**: Functions for info, error, success using chalk  
**Test**: Call each function, see colored output

### Task 10.2: Add Logging to Command

**Start**: Command without logging  
**End**: Log start, progress, completion  
**Test**: Run command, see formatted output

### Task 10.3: Add Simple Spinner

**Start**: Command with basic logging  
**End**: Show spinner during blockchain query using ora  
**Test**: See spinner while querying

## Phase 11: Concurrent Downloads

### Task 11.1: Create Download Queue

**Start**: Sequential downloads  
**End**: IPFSService with internal queue (limit 3 concurrent)  
**Test**: Download 5 files, verify max 3 at once

### Task 11.2: Implement Batch Download

**Start**: Single file download method  
**End**: Method `downloadBatch(assignments: Assignment[]): Promise<DownloadResult[]>`  
**Test**: Download multiple files, get results array

### Task 11.3: Add Download Progress Counter

**Start**: Batch download without progress  
**End**: Log "Downloaded X of Y files"  
**Test**: See progress updates during download

## Phase 12: Error Handling and Edge Cases

### Task 12.1: Handle No Events Found

**Start**: Command assumes events exist  
**End**: Show message when no events found  
**Test**: Query address with no events

### Task 12.2: Handle RPC Connection Errors

**Start**: No RPC error handling  
**End**: Catch and show friendly error message  
**Test**: Use invalid RPC URL

### Task 12.3: Handle IPFS Gateway Errors

**Start**: Basic IPFS error handling  
**End**: Retry failed downloads once  
**Test**: Use invalid gateway URL

## Phase 13: Final Polish

### Task 13.1: Add Execution Time

**Start**: Command without timing  
**End**: Show total execution time at end  
**Test**: Run command, see "Completed in X seconds"

### Task 13.2: Add Summary Statistics

**Start**: Basic completion message  
**End**: Show events found, files downloaded, failures  
**Test**: See summary after execution

### Task 13.3: Create Binary Entry Point

**Start**: No bin/ folder  
**End**: bin/oracle-cli with proper shebang  
**Test**: Run ./bin/oracle-cli

### Task 13.4: Update Package.json for NPM

**Start**: Basic package.json  
**End**: Add bin field, files field, prepare script  
**Test**: Run `npm pack`, verify .tgz contents

## Phase 14: Documentation

### Task 14.1: Create Basic README

**Start**: No README  
**End**: README with installation and basic usage  
**Test**: Follow README instructions as new user

### Task 14.2: Add Usage Examples

**Start**: Basic README  
**End**: Add 3 example commands with expected output  
**Test**: Run each example

### Task 14.3: Add Troubleshooting Section

**Start**: README without troubleshooting  
**End**: Common issues and solutions  
**Test**: Verify solutions work

## Testing Checkpoints

After each phase, run these tests:

- **Phase 3**: CLI runs without errors
- **Phase 5**: Can connect to Polygon RPC
- **Phase 7**: Can fetch real events
- **Phase 9**: Can download real files
- **Phase 11**: Downloads work concurrently
- **Phase 13**: Can install as npm package

## MVP Completion Criteria

The MVP is complete when:

1. ✓ CLI accepts all specified inputs
2. ✓ Fetches events from Polygon blockchain
3. ✓ Decodes CIDs from event data
4. ✓ Downloads files from IPFS
5. ✓ Shows progress during operation
6. ✓ Handles basic errors gracefully
7. ✓ Can be installed via npm
