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

The file submission process has been split into two commands for better control:

### validate-and-upload Command

This command:
1. Validates file structure in the input directory
2. Confirms file assignments to the user
3. Uses filenames as Schema CIDs to validate JSON data
4. Canonicalizes validated data
5. Uploads canonicalized files to IPFS via Pinata
6. Generates a CSV file with upload results

### submit-to-contract Command

This command:
1. Reads the CSV file from validate-and-upload
2. Verifies consensus data differs from submission
3. Checks user hasn't previously submitted same data
4. Submits data hashes to the smart contract in batches

## Common Tasks for AI Assistants

### Adding New Features

When adding features, follow these patterns:

1. Add types to `src/types/index.ts`
2. Create services in `src/services/`
3. Add command options in `src/index.ts`
4. Update command handler in `src/commands/`

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

# Clean build artifacts
npm run clean

# Run tests
npm run test

# Run specific test files or patterns
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
- `src/commands/validate-and-upload.ts` - Validate and upload to IPFS command
- `src/commands/submit-to-contract.ts` - Submit to blockchain command
- `src/services/blockchain.service.ts` - Ethereum/Polygon interaction
- `src/services/event-decoder.service.ts` - Event data parsing
- `src/services/ipfs.service.ts` - IPFS download logic
- `src/services/pinata.service.ts` - Pinata upload service
- `src/services/chain-state.service.ts` - Chain state queries
- `src/services/transaction-batcher.service.ts` - Batch transaction handling
- `src/services/json-validator.service.ts` - JSON validation with CID support
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

## Security Considerations

- Validates all user inputs (addresses, URLs)
- No private keys or sensitive data handled
- Downloads files only from IPFS (content-addressed)
- Uses HTTPS for all external connections

