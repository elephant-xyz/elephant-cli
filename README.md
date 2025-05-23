# Elephant Network CLI

A command-line tool for interacting with the Elephant Network on Polygon blockchain. This tool allows elephant operators to list and download their assignments from IPFS based on blockchain events.

## Installation

### Global Installation

```bash
npm install -g @elephant/cli
```

### Using NPX (No Installation Required)

```bash
npx @elephant/cli list-assignments --elephant 0xYourElephantAddress
```

## Usage

### Basic Usage

List all assignments for an elephant address:

```bash
# If installed globally
elephant-cli list-assignments --elephant 0xYourElephantAddress

# Using npx (recommended)
npx @elephant/cli list-assignments --elephant 0xYourElephantAddress
```

### Command Options

- `-e, --elephant <address>` - Elephant address (required)
- `-c, --contract <address>` - Smart contract address (default: 0x79D5046e34D4A56D357E12636A18da6eaEfe0586)
- `-r, --rpc <url>` - RPC URL (default: https://rpc.therpc.io/polygon)
- `-g, --gateway <url>` - IPFS gateway URL (default: https://gateway.pinata.cloud/ipfs/)
- `-f, --from-block <number>` - Starting block number (default: 0)
- `-d, --download-dir <path>` - Download directory (default: ./downloads)

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

## Examples

### Example 1: Query Recent Blocks

Check for assignments in the last 1000 blocks:

```bash
elephant-cli list-assignments \
  --elephant 0x0e44bfab0f7e1943cF47942221929F898E181505 \
  --from-block 71875000
```

### Example 2: Use Custom RPC and Download Directory

```bash
elephant-cli list-assignments \
  --elephant 0x0e44bfab0f7e1943cF47942221929F898E181505 \
  --rpc https://polygon-mainnet.infura.io/v3/YOUR_KEY \
  --download-dir ./my-assignments
```

### Example 3: Use Different IPFS Gateway

```bash
elephant-cli list-assignments \
  --elephant 0x0e44bfab0f7e1943cF47942221929F898E181505 \
  --gateway https://ipfs.io/ipfs/ \
  --from-block 71800000
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