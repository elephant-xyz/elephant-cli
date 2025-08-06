# CLAUDE.md - AI Assistant Context

This document provides context for AI assistants (like Claude) to understand and work with the Elephant Network CLI project effectively.

## Project Overview

The Elephant Network CLI is a TypeScript-based command-line tool that:

- Queries the Polygon blockchain for OracleAssigned events
- Decodes IPFS CIDs from blockchain event data
- Downloads assigned files from IPFS gateways
- Validates JSON data against schemas
- Uploads validated data to IPFS via Pinata
- Submits data hashes to smart contracts
- Provides progress tracking and error handling

## Key Technical Details

### Smart Contract Integration

- **Contract Address**: `0x79D5046e34D4A56D357E12636A18da6eaEfe0586` (Polygon mainnet)
- **Event**: `OracleAssigned(bytes propertyCid, address indexed elephant)`
- **CID Format**: The contract stores CIDs with a leading dot (e.g., `.QmXXX...`), which must be stripped

### Important Code Patterns

1. **Event Decoding**: The CID is ABI-encoded as a dynamic string in the event data:

```typescript
const abiCoder = ethers.AbiCoder.defaultAbiCoder();
const decoded = abiCoder.decode(['string'], bytes)[0];
const cid = decoded.startsWith('.') ? decoded.substring(1) : decoded;
```

2. **Concurrent Downloads**: Uses a queue system with max 3 concurrent downloads
3. **Error Handling**: Specific error messages for RPC, IPFS, and validation failures

### Gas Price Handling

The `submit-to-contract` command includes a `--gas-price` option that accepts a numeric value in Gwei (e.g., `35.5`) or the string `'auto'`.

1.  **CLI Input**: The option is defined in `src/commands/submit-to-contract.ts` with a default of `30`. Input is validated to be a number or `'auto'`.

2.  **Service Layer**: The `gasPrice` value is passed to the `TransactionBatcherService` constructor.

3.  **Transaction Creation**: Inside `TransactionBatcherService.submitBatch`, the `gasPrice` is used to construct the transaction options:
   *   If `gasPrice` is a number, it's converted to Wei and set as the `gasPrice` in the transaction overrides. This forces a legacy-style transaction with a fixed gas price.
   *   If `gasPrice` is `'auto'`, no gas-related options are set in the overrides, allowing `ethers.js` to automatically determine the optimal gas price from the RPC provider (usually using EIP-1559 fee mechanism if available).

```typescript
// src/services/transaction-batcher.service.ts
const txOptions: Overrides = {
  gasLimit: 
    estimatedGas + BigInt(Math.floor(Number(estimatedGas) * 0.2)),
};

if (this.gasPrice !== 'auto') {
  txOptions.gasPrice = ethers.parseUnits(
    this.gasPrice.toString(),
      'gwei'
   );
}
//...
const txResponse: TransactionResponse = await this.contract.submitBatch(
  preparedBatch, 
  txOptions
);
```

### Testing Information

- **Test Elephant Address**: `0x0e44bfab0f7e1943cF47942221929F898E181505`
- **Test Block with Event**: `71875870`
- **Test CID**: `QmWUnTmuodSYEuHVPgxtrARGra2VpzsusAp4FqT9FWobuU`

## New Split Workflow Commands

The file submission process has been split into three commands for better control:

### validate Command

This command:
1. Validates file structure in the input directory or ZIP file
2. Uses filenames as Schema CIDs to validate JSON data
3. **Validates that schemas are valid data group schemas** (must have exactly two properties: `label` and `relationships`)
4. Handles seed datagroup processing (validates seed files first, skips directories with failed seeds)
5. Writes validation errors to CSV file (default: `submit_errors.csv`)
6. Shows validation summary
7. **Does NOT upload anything to IPFS**
8. **Does NOT calculate CIDs or generate HTML files**
9. **Supports both directory and ZIP file inputs**

### validate-and-upload Command

This command:
1. Validates file structure in the input directory
2. Confirms file assignments to the user
3. Uses filenames as Schema CIDs to validate JSON data
4. **Validates that schemas are valid data group schemas** (must have exactly two properties: `label` and `relationships`)
5. Handles seed datagroup processing (uploads seed files first to get their CIDs)
6. Canonicalizes validated data
7. Uploads canonicalized files to IPFS via Pinata
8. Generates a CSV file with upload results

### submit-to-contract Command

This command:
1. Reads the CSV file from validate-and-upload
2. Verifies consensus data differs from submission
3. Checks user hasn't previously submitted same data
4. Submits data hashes to the smart contract in batches
5. In dry-run mode, can optionally generate unsigned transactions CSV for later signing and submission

### reconstruct-data Command

This command:
1. Downloads data from IPFS starting from a root CID
2. Fetches schema manifest from Elephant Network API to get datagroup CIDs
3. Recursively follows all CID references in the data
4. Replaces CID references with local file paths
5. Saves all data locally in a structured directory
6. Names root datagroup files using their schema CID from manifest

Key features:
- **Automatic CID Resolution**: Handles `{"/": "CID"}` references automatically
- **Path Replacement**: Converts CID pointers to relative file paths
- **Rate Limiting**: Handles IPFS gateway rate limits with exponential backoff
- **Progress Tracking**: Shows detailed download progress
- **Schema Manifest Integration**: Fetches datagroup CIDs from `https://lexicon.elephant.xyz/json-schemas/schema-manifest.json`
- **Smart Filename Mapping**: Uses datagroup schema CIDs for root files based on their label

## Common Tasks for AI Assistants

### Adding New Features

When adding features, follow these patterns:

1. Add types to `src/types/index.ts`
2. Create services in `src/services/`
3. Add command options in `src/index.ts`
4. Update command handler in `src/commands/`

### ZIP File Support

The CLI now supports processing ZIP files containing the expected directory structure:

- `validate` command accepts ZIP files as input
- ZIP files are automatically detected by file extension and magic bytes
- Files are extracted to a temporary directory that's cleaned up after processing
- The same validation and upload logic applies to extracted files
- Temporary directories are properly cleaned up even if errors occur

### Data Reconstruction Command

The `reconstruct-data` command supports two modes:

1. **CID Mode**: Reconstructs data tree from an IPFS CID
   - Downloads the root CID and recursively follows all CID references
   - Replaces CID references with local file paths
   - Uses schema manifest for proper file naming
   - Creates directory: `output-dir/<CID>/` (no "data_" prefix)

2. **Transaction Hash Mode**: Extracts and reconstructs data from blockchain transactions
   - Fetches transaction data from blockchain using RPC
   - Decodes `submitBatchData` calls to extract property, data group, and data hashes
   - Converts hashes to CIDs using `CidHexConverterService.hexToCid` (raw codec, base32 encoding)
   - Creates directory structure: `output-dir/propertyCID/` with dataGroup and referenced files directly inside
   - Downloads and reconstructs data for each item in the transaction

Key implementation details:
- Transaction decoding uses ethers.js Interface to parse ABI-encoded data
- Hash-to-CID conversion uses `CidHexConverterService` which creates CID v1 with raw codec (0x55)
- Each property in a transaction gets its own directory
- DataGroup files are saved directly in the property directory with their CID as filename
- Referenced files (e.g., property_seed) are named based on their field names in the data structure

File naming convention:
- Root dataGroup file: `<dataGroupCid>.json`
- Direct CID references: `<fieldName>.json` (e.g., `property_seed.json`)
- Nested references: `<fieldName>_<subKey>.json` (e.g., `property_seed_from.json`, `property_seed_to.json`)

### Debugging Issues

Common issues to check:

1. **CID Decoding**: Ensure the leading dot is removed
2. **Block Ranges**: Recent blocks work; very old blocks may be pruned
3. **IPFS Gateways**: Some gateways may be slow or unavailable
4. **Log Files**: Check `elephant-cli.log` for detailed debugging information. The log shows blockchain queries, RPC calls, and other internal operations.
5. **Timeout Issues**: The default `DEFAULT_FROM_BLOCK` (72310501) can cause timeouts as it requires querying millions of blocks. In tests, use mock services or skip blockchain queries in dry-run mode.

### Code Style

- TypeScript with strict mode
- Async/await for promises
- Error types for better error handling
- Colored console output using chalk
- Progress indicators using ora

## Architecture Decisions

1. **Service Layer**: Separates business logic from CLI concerns
2. **Queue System**: Prevents overwhelming IPFS gateways
3. **Event Decoder**: Handles contract-specific data encoding
4. **Validation**: Input validation before processing
5. **JSON Validator with CID Support**: Advanced schema validation with IPFS integration
6. **ZIP File Support**: Allows users to provide data as ZIP files for easier distribution

## Improvement Opportunities

1. Add caching for blockchain queries
2. Implement retry logic for blockchain queries
3. Add support for multiple elephant addresses
4. Create a config file option
5. Add automated tests

## Important Constants

- **Default RPC**: `https://rpc.therpc.io/polygon`
- **Default IPFS Gateway**: `https://gateway.pinata.cloud/ipfs/`
- **Max Concurrent Downloads**: 3
- **Download Timeout**: 30 seconds
- **Retry Count**: 1 retry on IPFS failure
- **CID Version**: v1 (base32 encoding) for all uploads
- **CID Codec**: DAG-JSON (0x0129) for IPLD linked data, DAG-PB (0x70) for regular files
- **Seed Datagroup Schema CID**: `bafkreigpfi4pqur43wj3x2dwm43hnbtrxabgwsi3hobzbtqrs3iytohevu`

## Development Commands

```bash
# Install dependencies
npm install

# Build project
npm run build

# Development mode (auto-rebuild)
npm run dev

# Test the CLI - List assignments
./bin/elephant-cli list-assignments --oracle 0x0e44bfab0f7e1943cF47942221929F898E181505 --from-block 71875850

# Test the CLI - Validate only (no upload)
./bin/elephant-cli validate ./test-data \
  --output-csv validation_errors.csv

# Test the CLI - Validate only from ZIP file
./bin/elephant-cli validate ./test-data.zip \
  --output-csv validation_errors.csv

# Test the CLI - Validate and upload
./bin/elephant-cli validate-and-upload ./test-data \
  --private-key "0x..." \
  --pinata-jwt "..." \
  --output-csv results.csv \
  --dry-run

# Test the CLI - Submit to contract  
./bin/elephant-cli submit-to-contract results.csv \
  --private-key "0x..." \
  --gas-price 50 \
  --dry-run

# Test the CLI - Submit to contract with unsigned transactions JSON
./bin/elephant-cli submit-to-contract results.csv \
  --private-key "0x..." \
  --gas-price 50 \
  --dry-run \
  --unsigned-transactions-json unsigned_txs.json

# Test the CLI - Reconstruct data from CID
./bin/elephant-cli reconstruct-data bafybeiabc123... \
  --gateway https://ipfs.io/ipfs/ \
  --output-dir ./reconstructed

# Test the CLI - Reconstruct data from transaction hash
./bin/elephant-cli reconstruct-data 0x1234567890abcdef... \
  --rpc-url https://polygon-rpc.com \
  --gateway https://ipfs.io/ipfs/ \
  --output-dir ./tx-data

# Clean build artifacts
npm run clean

# Run tests
npm run test

# Run specific test files or patterns
npm run test -- tests/unit/commands/validate.test.ts
npm run test -- tests/unit/commands/validate-and-upload.test.ts
npm run test -- tests/integration/split-commands.test.ts
npm run test -- json-validator

# Run tests with watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage
```

## File Structure Context

- `src/index.ts` - CLI entry point and command definitions
- `src/commands/list-assignments.ts` - List assignments command
- `src/commands/validate.ts` - Validate data without uploading
- `src/commands/validate-and-upload.ts` - Validate and upload to IPFS command
- `src/commands/submit-to-contract.ts` - Submit to blockchain command
- `src/commands/reconstruct-data.ts` - Reconstruct data from IPFS command
- `src/services/blockchain.service.ts` - Ethereum/Polygon interaction
- `src/services/event-decoder.service.ts` - Event data parsing
- `src/services/ipfs.service.ts` - IPFS download logic
- `src/services/pinata.service.ts` - Pinata upload service
- `src/services/chain-state.service.ts` - Chain state queries
- `src/services/transaction-batcher.service.ts` - Batch transaction handling
- `src/services/json-validator.service.ts` - JSON validation with CID support
- `src/services/zip-extractor.service.ts` - ZIP file extraction and handling
- `src/services/ipfs-reconstructor.service.ts` - IPFS data reconstruction service
- `src/utils/` - Logging, validation, and progress utilities

## Known Limitations

1. No resume capability for interrupted downloads
2. No caching of blockchain queries
3. Single elephant address at a time
4. No export formats (only console output)

## JSON Validator with CID Support

The `JsonValidatorService` provides advanced JSON schema validation with IPFS integration:

### CID Schema References
Schemas can reference other schemas stored in IPFS using CID:
```json
{
  "type": "string",
  "cid": "QmYjtig7VJQ6XsnUjqqJvj7QaMcCAwtrgNdahSiFofrE7o"
}
```

### CID Pointer Resolution
Data can contain CID pointers that are automatically resolved:
```json
{
  "/": "QmWUnTmuodSYEuHVPgxtrARGra2VpzsusAp4FqT9FWobuU"
}
```

### File Path Linking
Data can reference local files using relative paths:
```json
{
  "/": "./names.json"
}
```
**Important**: File paths are resolved relative to the file containing the reference, not the data directory root. For example:
- If `data/propertyA/file1.json` contains `{"/": "./file2.json"}`, it resolves to `data/propertyA/file2.json`
- If `data/propertyA/file1.json` contains `{"/": "../propertyB/file3.json"}`, it resolves to `data/propertyB/file3.json`

### Features
1. **Automatic CID Resolution**: When validating data containing `{"/": <cid>}`, the validator:
   - Fetches the content from IPFS
   - Replaces the pointer with actual content
   - Validates against the schema

2. **Schema CID References**: Schemas with `{"type": "string", "cid": <cid>}`:
   - Fetch the schema from IPFS
   - Use it for validation
   - Cache for performance

3. **Recursive Resolution**: Works with nested structures and arrays

4. **CID Format Validation**: Validates CID strings using multiformats library

5. **File Path Resolution**: Relative file paths in IPLD links are resolved relative to the containing file's directory, not the data directory root

6. **Enhanced Error Messages**: Provides detailed, user-friendly error messages for validation failures:
   - Format errors include specific format requirements (e.g., "must be a valid ISO date in YYYY-MM-DD format")
   - Custom format errors explain the expected format (e.g., "must be a positive number with at most 2 decimal places")
   - Validation errors specify the issue clearly (e.g., "missing required property 'name'")

### Example Flow
```typescript
// Schema references another schema via CID
const schema = {
  type: "string",
  cid: "QmSchemaCID..."
};

// Data is a CID pointer
const data = {
  "/": "QmDataCID..."
};

// Both are fetched from IPFS and validated
const result = await validator.validate(data, schema);
```

## Seed Datagroup Feature

The validate-and-upload command supports a special "seed datagroup" workflow:

### Directory Structure
Two types of directories are supported:
1. **Standard CID directories**: Directory name is a valid IPFS CID
2. **Seed datagroup directories**: Directory name can be anything, but must contain a file named `bafkreigpfi4pqur43wj3x2dwm43hnbtrxabgwsi3hobzbtqrs3iytohevu.json`

### Processing Workflow
1. **Phase 1**: All seed files (`bafkreigpfi4pqur43wj3x2dwm43hnbtrxabgwsi3hobzbtqrs3iytohevu.json`) are processed first
2. **Phase 2**: All other files are processed, with files in seed datagroup directories using the uploaded seed CID as their `propertyCid`

### Implementation Details
- Files are scanned and marked with `SEED_PENDING:${dirName}` for seed datagroup directories
- Seed files are uploaded first and their CIDs are stored in a map
- Non-seed files in seed datagroup directories get their `propertyCid` updated to the uploaded seed CID
- All files (seed and non-seed) from the same directory share the same `propertyCid` in the final CSV output

### File Scanner Service Changes
- `validateStructure()`: Accepts directories with seed files even if directory name isn't a CID
- `scanDirectory()`: Marks seed datagroup files with special `SEED_PENDING:` prefix
- `getAllDataGroupCids()`: Includes the hardcoded seed datagroup schema CID when found

## Unsigned Transactions Feature

The `submit-to-contract` command supports generating unsigned transactions for later signing and submission when used with `--dry-run` and `--unsigned-transactions-json` options.

### Use Cases
- **Cold wallet signing**: Generate transactions on an online machine, transfer to offline machine for signing
- **Multi-signature workflows**: Prepare transactions for multiple signers
- **Batch preparation**: Generate all transactions at once for later submission
- **Gas price optimization**: Generate transactions and submit when gas prices are favorable

### JSON Format
The unsigned transactions JSON contains an array of EIP-1474 compliant transaction objects with the following fields:
- `from`: Sender address
- `to`: Contract address
- `gas`: Estimated gas limit with 20% buffer (hex-encoded)
- `value`: Transaction value (always '0x0' for these calls)
- `data`: Encoded function call data (hex-encoded)
- `nonce`: Transaction nonce (hex-encoded)
- `type`: Transaction type ('0x0' for legacy, '0x2' for EIP-1559)
- `gasPrice`: Gas price in Wei (legacy transactions, hex-encoded)
- `maxFeePerGas`: Maximum fee per gas in Wei (EIP-1559 transactions, hex-encoded)
- `maxPriorityFeePerGas`: Priority fee per gas in Wei (EIP-1559 transactions, hex-encoded)

### Transaction Types
- **Legacy transactions** (type 0): Used when `--gas-price` is specified as a number
- **EIP-1559 transactions** (type 2): Used when `--gas-price auto` is specified

### Security Notes
- Unsigned transactions contain no private information
- Generated nonces are sequential starting from the current account nonce
- Gas estimates are fetched from the RPC provider when possible
- All CIDs are properly converted to hashes for contract calls

## Security Considerations

- Validates all user inputs (addresses, URLs)
- No private keys or sensitive data handled
- Downloads files only from IPFS (content-addressed)
- Uses HTTPS for all external connections
- ZIP files are extracted to temporary directories that are automatically cleaned up
- ZIP extraction validates file structure before processing
