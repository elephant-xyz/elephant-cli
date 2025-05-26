# Elephant Network CLI Tool Architecture

## Overview

A TypeScript-based CLI tool for interacting with an elephant network built on Polygon blockchain. The tool enables elephant operators to list and download their assignments from IPFS based on blockchain events.

## Project Structure

```
elephant-network-cli/
├── src/
│   ├── commands/
│   │   └── list-assignments.ts     # Main command implementation
│   ├── services/
│   │   ├── blockchain.service.ts   # Blockchain interaction logic
│   │   ├── ipfs.service.ts         # IPFS download functionality
│   │   └── event-decoder.service.ts # Event parsing and decoding
│   ├── config/
│   │   ├── constants.ts            # Default values and constants
│   │   └── abi.ts                  # Smart contract ABI
│   ├── types/
│   │   └── index.ts                # TypeScript type definitions
│   ├── utils/
│   │   ├── logger.ts               # Logging utilities
│   │   ├── progress.ts             # Progress bar and UI helpers
│   │   └── validation.ts           # Input validation functions
│   └── index.ts                    # CLI entry point
├── dist/                           # Compiled JavaScript output
├── downloads/                      # Default directory for IPFS downloads
├── tests/
│   ├── unit/
│   │   ├── services/
│   │   └── utils/
│   └── integration/
├── .gitignore
├── .npmignore
├── package.json
├── tsconfig.json
├── README.md
├── LICENSE
└── bin/
    └── elephant-cli                  # Executable script

```

## Component Architecture

### 1. Entry Point (`src/index.ts`)

The main entry point that sets up the CLI using Commander.js:

```typescript
#!/usr/bin/env node
import { Command } from 'commander';
import { listAssignments } from './commands/list-assignments';

const program = new Command();

program
  .name('elephant-cli')
  .description('CLI tool for Elephant Network on Polygon')
  .version('1.0.0');

program
  .command('list-assignments')
  .description('List and download elephant assignments from the blockchain')
  .requiredOption('-o, --elephant <address>', 'Elephant address')
  .option(
    '-c, --contract <address>',
    'Smart contract address',
    DEFAULT_CONTRACT_ADDRESS
  )
  .option('-r, --rpc <url>', 'RPC URL', DEFAULT_RPC_URL)
  .option('-g, --gateway <url>', 'IPFS gateway URL', DEFAULT_IPFS_GATEWAY)
  .option('-f, --from-block <number>', 'Starting block number', '0')
  .option('-d, --download-dir <path>', 'Download directory', './downloads')
  .action(listAssignments);

program.parse();
```

### 2. Commands Layer (`src/commands/`)

**`list-assignments.ts`**

- Orchestrates the entire flow
- Validates inputs
- Manages state for the operation
- Handles errors and user feedback

Key responsibilities:

- Parse and validate command options
- Initialize services with configuration
- Coordinate blockchain scanning and IPFS downloads
- Display progress and results

### 3. Services Layer (`src/services/`)

**`blockchain.service.ts`**

- Connects to Polygon RPC endpoint
- Queries blockchain for events
- Handles pagination and block ranges
- Manages web3/ethers.js provider

```typescript
class BlockchainService {
  private provider: ethers.JsonRpcProvider;
  private contract: ethers.Contract;

  async getOracleAssignedEvents(
    elephantAddress: string,
    fromBlock: number,
    toBlock?: number
  ): Promise<OracleAssignedEvent[]>;

  async getCurrentBlock(): Promise<number>;
}
```

**`ipfs.service.ts`**

- Downloads content from IPFS
- Manages concurrent downloads
- Handles retries and errors
- Shows download progress

```typescript
class IPFSService {
  private gateway: string;
  private downloadQueue: Queue;

  async downloadFile(cid: string, outputPath: string): Promise<void>;
  async downloadBatch(assignments: Assignment[]): Promise<DownloadResult[]>;
}
```

**`event-decoder.service.ts`**

- Decodes blockchain event data
- Extracts and validates CIDs
- Transforms raw events to structured data

```typescript
class EventDecoderService {
  decodePropertCid(bytes: string): string;
  parseOracleAssignedEvent(event: ethers.Log): Assignment;
}
```

### 4. Configuration (`src/config/`)

**`constants.ts`**

```typescript
export const DEFAULT_CONTRACT_ADDRESS = '0x...';
export const DEFAULT_RPC_URL = 'https://polygon-rpc.com';
export const DEFAULT_IPFS_GATEWAY = 'https://gateway.pinata.cloud/ipfs/';
export const MAX_CONCURRENT_DOWNLOADS = 5;
export const BLOCKS_PER_QUERY = 10000;
```

**`abi.ts`**

```typescript
export const ELEPHANT_CONTRACT_ABI = [
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: 'bytes',
        name: 'propertyCid',
        type: 'bytes',
      },
      {
        indexed: true,
        internalType: 'address',
        name: 'elephant',
        type: 'address',
      },
    ],
    name: 'OracleAssigned',
    type: 'event',
  },
];
```

### 5. Types (`src/types/index.ts`)

```typescript
export interface Assignment {
  cid: string;
  elephant: string;
  blockNumber: number;
  transactionHash: string;
  timestamp?: number;
}

export interface CommandOptions {
  elephant: string;
  contract?: string;
  rpc?: string;
  gateway?: string;
  fromBlock?: string;
  downloadDir?: string;
}

export interface DownloadResult {
  cid: string;
  success: boolean;
  path?: string;
  error?: Error;
}
```

### 6. Utilities (`src/utils/`)

**`logger.ts`**

- Colored console output
- Log levels (info, warn, error, debug)
- Formatted timestamps

**`progress.ts`**

- Progress bars for blockchain scanning
- Download progress indicators
- Spinner for ongoing operations

**`validation.ts`**

- Ethereum address validation
- URL validation
- CID format validation

## State Management

### Application State Flow

1. **Configuration State**: Immutable configuration passed through service constructors
2. **Operation State**: Managed within command handlers using local variables
3. **Progress State**: Managed by progress utilities, updated via callbacks
4. **Download Queue State**: Internal to IPFS service, manages concurrent operations

### No Global State

The architecture avoids global state by:

- Passing configuration through dependency injection
- Using service instances with encapsulated state
- Returning results rather than storing them globally

## Service Connections

### Dependency Flow

```
CLI Entry Point
    ↓
Command Handler (list-assignments)
    ↓
┌─────────────────┬────────────────┬──────────────┐
│                 │                │              │
BlockchainService │ EventDecoder   │ IPFSService  │
│                 │                │              │
└─────────────────┴────────────────┴──────────────┘
         ↑                ↑               ↑
         └────────────────┴───────────────┘
                    Utilities
```

### Service Initialization

Services are initialized in the command handler with their dependencies:

```typescript
const blockchainService = new BlockchainService(rpcUrl, contractAddress, abi);
const eventDecoder = new EventDecoderService();
const ipfsService = new IPFSService(gatewayUrl, {
  maxConcurrent: 5,
  timeout: 30000,
});
```

## Error Handling

### Hierarchical Error Handling

1. **Service Level**: Services throw specific errors
2. **Command Level**: Commands catch and categorize errors
3. **CLI Level**: Top-level handler for unexpected errors

### Error Types

```typescript
export class BlockchainConnectionError extends Error {}
export class InvalidAddressError extends Error {}
export class IPFSDownloadError extends Error {}
export class EventDecodingError extends Error {}
```

## Testing Strategy

### Unit Tests

- Test services in isolation with mocked dependencies
- Test utilities with various inputs
- Test event decoding with sample data

### Integration Tests

- Test against local blockchain (Hardhat/Ganache)
- Test with mock IPFS gateway
- End-to-end command execution tests

## Package Distribution

### NPM Package Structure

**`package.json`**

```json
{
  "name": "@elephant-network/cli",
  "version": "1.0.0",
  "description": "CLI tool for Elephant Network on Polygon",
  "main": "dist/index.js",
  "bin": {
    "elephant-cli": "./bin/elephant-cli"
  },
  "scripts": {
    "build": "tsc",
    "prepare": "npm run build",
    "test": "jest"
  },
  "files": ["dist", "bin", "README.md"]
}
```

### Binary Executable

**`bin/elephant-cli`**

```bash
#!/usr/bin/env node
require('../dist/index.js');
```

## Performance Considerations

1. **Blockchain Queries**: Batch events by block ranges
2. **IPFS Downloads**: Concurrent downloads with configurable limit
3. **Memory Management**: Stream large files instead of loading into memory
4. **Progress Updates**: Throttled UI updates to avoid flickering

## Security Considerations

1. **Input Validation**: All addresses and URLs validated
2. **RPC Security**: Support for authenticated RPC endpoints
3. **File System**: Sanitize filenames from CIDs
4. **Error Messages**: Avoid exposing sensitive information

## Future Extensibility

The architecture supports future additions:

- Additional commands (submit-report, verify-assignment)
- Multiple blockchain support
- Different storage backends (not just IPFS)
- Plugin system for custom handlers
- Configuration file support (.elephant-cli.json)
