# CLAUDE.md - AI Assistant Context

This document provides context for AI assistants (like Claude) to understand and work with the Elephant Network CLI project effectively.

## Project Overview

The Elephant Network CLI is a TypeScript-based command-line tool that:

- Queries the Polygon blockchain for OracleAssigned events
- Decodes IPFS CIDs from blockchain event data
- Downloads assigned files from IPFS gateways
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

### Testing Information

- **Test Elephant Address**: `0x0e44bfab0f7e1943cF47942221929F898E181505`
- **Test Block with Event**: `71875870`
- **Test CID**: `QmWUnTmuodSYEuHVPgxtrARGra2VpzsusAp4FqT9FWobuU`

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

## Development Commands

```bash
# Install dependencies
npm install

# Build project
npm run build

# Development mode (auto-rebuild)
npm run dev

# Test the CLI
./bin/elephant-cli list-assignments --elephant 0x0e44bfab0f7e1943cF47942221929F898E181505 --from-block 71875850

# Clean build artifacts
npm run clean
```

## File Structure Context

- `src/index.ts` - CLI entry point and command definitions
- `src/commands/list-assignments.ts` - Main command logic
- `src/services/blockchain.service.ts` - Ethereum/Polygon interaction
- `src/services/event-decoder.service.ts` - Event data parsing
- `src/services/ipfs.service.ts` - IPFS download logic
- `src/utils/` - Logging, validation, and progress utilities

## Known Limitations

1. No resume capability for interrupted downloads
2. No caching of blockchain queries
3. Single elephant address at a time
4. No export formats (only console output)

## Security Considerations

- Validates all user inputs (addresses, URLs)
- No private keys or sensitive data handled
- Downloads files only from IPFS (content-addressed)
- Uses HTTPS for all external connections

