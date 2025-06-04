# Elephant Network CLI

A command-line tool for interacting with the Elephant Network on Polygon blockchain. This tool allows elephant operators to list and download their assignments from IPFS based on blockchain events, and also to submit new data to the network.

## Installation

### Global Installation

```bash
npm install -g @elephant-xyz/cli
```

### Using NPX (No Installation Required)

```bash
npx @elephant-xyz/cli list-assignments --oracle 0xYourElephantAddress
```

## Usage

### Basic Usage - List Assignments

List all assignments for an elephant address:

```bash
# If installed globally
elephant-cli list-assignments --oracle 0xYourElephantAddress

# Using npx (recommended)
npx @elephant-xyz/cli list-assignments --oracle 0xYourElephantAddress
```

### Command Options - List Assignments

- `-o, --oracle <address>` - Elephant address (required)
- `-c, --contract <address>` - Smart contract address (default: 0x79D5046e34D4A56D357E12636A18da6eaEfe0586)
- `-r, --rpc <url>` - RPC URL (default: https://rpc.therpc.io/polygon)
- `-g, --gateway <url>` - IPFS gateway URL (default: https://gateway.pinata.cloud/ipfs/)
- `-f, --from-block <number>` - Starting block number (default: queries assignments from approximately the last 24 hours if not specified)
- `-d, --download-dir <path>` - Download directory (default: ./downloads)

### Basic Usage - Submit Files

Validate, process, upload, and submit data files to the Elephant Network:

```bash
# If installed globally
elephant-cli submit-files ./path/to/data-directory \
  --private-key "0xYourPrivateKey" \
  --pinata-jwt "YourPinataJWT"

# Using npx (recommended)
npx @elephant-xyz/cli submit-files ./path/to/data-directory \
  --private-key "0xYourPrivateKey" \
  --pinata-jwt "YourPinataJWT"
```

### Command Options - Submit Files

- `<inputDir>`: (Required Argument) Path to the directory containing the data files structured for submission.
- `-k, --private-key <key>`: (Required) Private key for the submitting wallet. Can also be set via `ELEPHANT_PRIVATE_KEY` environment variable.
- `-j, --pinata-jwt <jwt>`: (Required) Pinata JWT for IPFS uploads. Can also be set via `PINATA_JWT` environment variable.
- `--rpc-url <url>`: RPC URL for the blockchain network. (Default: `https://rpc.therpc.io/polygon`)
- `--contract-address <address>`: Address of the submit smart contract. (Default: `0x79D5046e34D4A56D357E12636A18da6eaEfe0586`)
- `--max-concurrent-uploads <number>`: Maximum concurrent IPFS uploads. (Default: 10)
- `--transaction-batch-size <number>`: Number of items per blockchain transaction. (Default: 200)
- `--dry-run`: Perform all checks without uploading or submitting transactions. (Optional, defaults to false if not present)

### Environment Variables

The CLI supports loading environment variables from a `.env` file in your current working directory. This is useful for storing sensitive information like private keys and API tokens securely.

Create a `.env` file in your project directory:

```env
ELEPHANT_PRIVATE_KEY=your_private_key_here
PINATA_JWT=your_pinata_jwt_token_here
```

When using a `.env` file, you can run commands without passing sensitive values as command-line arguments:

```bash
# With .env file, no need to specify private key or JWT
elephant-cli submit-files ./data-directory --dry-run
```

## Features

- 🔍 Query blockchain for elephant assignments
- 📥 Automatic IPFS file downloads
- ⚡ Concurrent downloads (up to 3 files simultaneously)
- 🎯 Progress indicators and colored output
- ⏱️ Execution time tracking
- 📊 Summary statistics

## Requirements

- Node.js 18.0 or higher
- Internet connection for blockchain and IPFS access

## Building from Source

If you want to build and run the CLI from source code:

### Prerequisites

- Node.js 18.0 or higher
- npm (comes with Node.js)
- Git

### Step-by-step Build Instructions

1. **Clone the repository:**

   ```bash
   git clone https://github.com/your-org/elephant-cli-v2.git
   cd elephant-cli-v2
   ```

2. **Install dependencies:**

   ```bash
   npm install
   ```

3. **Build the project:**

   ```bash
   npm run build
   ```

4. **Run the CLI locally:**

   ```bash
   # Using the built executable
   ./bin/elephant-cli list-assignments --oracle 0xYourElephantAddress

   # Or using npm/node directly
   node dist/index.js list-assignments --oracle 0xYourElephantAddress
   ```

5. **Link for global usage (optional):**
   ```bash
   npm link
   # Now you can use 'elephant-cli' globally
   elephant-cli list-assignments --oracle 0xYourElephantAddress
   ```

### Development Commands

- **Build in watch mode:** `npm run dev` - Automatically rebuilds on file changes
- **Run tests:** `npm test`
- **Run tests with coverage:** `npm run test:coverage`
- **Lint code:** `npm run lint`
- **Format code:** `npm run format`
- **Clean build artifacts:** `npm run clean`

### Project Structure

```
elephant-cli/
├── src/
│   ├── commands/          # CLI command implementations
│   ├── services/          # Blockchain and IPFS services
│   ├── utils/             # Utility functions
│   ├── types/             # TypeScript type definitions
│   └── index.ts           # Main CLI entry point
├── tests/                 # Test files
├── bin/                   # Executable scripts
├── dist/                  # Built JavaScript files
└── package.json
```

## Examples

### Example 1: Query Recent Blocks (List Assignments)

Check for assignments in the last 1000 blocks:

```bash
elephant-cli list-assignments \
  --oracle 0x0e44bfab0f7e1943cF47942221929F898E181505 \
  --from-block 71875000
```

### Example 2: Use Custom RPC and Download Directory (List Assignments)

```bash
elephant-cli list-assignments \
  --oracle 0x0e44bfab0f7e1943cF47942221929F898E181505 \
  --rpc https://polygon-mainnet.infura.io/v3/YOUR_KEY \
  --download-dir ./my-assignments
```

### Example 3: Use Different IPFS Gateway (List Assignments)

```bash
elephant-cli list-assignments \
  --oracle 0x0e44bfab0f7e1943cF47942221929F898E181505 \
  --gateway https://ipfs.io/ipfs/ \
  --from-block 71800000
```

### Example 4: Submit Files with Default Settings

Submit data from `./my-data-to-submit` directory:
```bash
npx @elephant-xyz/cli submit-files ./my-data-to-submit \
  --private-key "0xabc123..." \
  --pinata-jwt "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

### Example 5: Submit Files with Custom Options and Dry Run

Submit data with a custom RPC, contract, and batch sizes, performing a dry run:
```bash
npx @elephant-xyz/cli submit-files ./another-data-set \
  --private-key "0xdef456..." \
  --pinata-jwt "YourPinataJWTTokenValue" \
  --rpc-url "https://your-custom-rpc.io/polygon" \
  --contract-address "0x123SubmitContractAddress456" \
  --max-concurrent-uploads 5 \
  --transaction-batch-size 50 \
  --dry-run
```

### Expected Output

```
✔ Current block: 71876500
✔ Found 1 assignments

Assignment 1:
  CID: QmWUnTmuodSYEuHVPgxtrARGra2VpzsusAp4FqT9FWobuU
  Block: 71875870
  Transaction: 0x8c0baf3fa5675f0c05fad8df28de704813b85d10ec01b00a842bb8ac9ba4365c
ℹ Starting downloads...
Downloaded 1 of 1 files...
✓ Downloaded QmWUnTmuodSYEuHVPgxtrARGra2VpzsusAp4FqT9FWobuU to ./downloads/QmWUnTmuodSYEuHVPgxtrARGra2VpzsusAp4FqT9FWobuU
✓ Downloads complete! 1 succeeded, 0 failed.

==================================================
ℹ Summary:
ℹ   Total assignments found: 1
ℹ   Files downloaded: 1
ℹ   Download failures: 0
ℹ   Blocks scanned: 700
ℹ   Execution time: 3.2 seconds
==================================================
```

## Troubleshooting

### Common Issues

#### "Invalid elephant address"

- Ensure your elephant address is a valid Ethereum address (starts with 0x and is 42 characters long)
- Example: `0x0e44bfab0f7e1943cF47942221929F898E181505`

#### "Failed to connect to RPC endpoint"

- Check your internet connection
- Verify the RPC URL is correct
- Try using a different RPC provider

#### "Invalid CID format"

- The smart contract may have returned malformed data
- Try querying a different block range

#### IPFS Download Failures

- The IPFS gateway may be temporarily unavailable
- Try using a different gateway with the `--gateway` option
- Common gateways:
  - `https://ipfs.io/ipfs/`
  - `https://gateway.pinata.cloud/ipfs/`
  - `https://cloudflare-ipfs.com/ipfs/`

#### No Events Found

- Verify the elephant address has assignments in the specified block range
- Try using a wider block range or starting from an earlier block
- Use `--from-block 0` to search from the beginning (may take longer)

### Debug Tips

1. Start with a recent block number to reduce query time
2. Use smaller block ranges when testing
3. Check the contract address matches your elephant network deployment

## License

MIT

