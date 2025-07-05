# Elephant Network CLI

A command-line tool for Elephant Network operators to manage their data assignments on the Polygon blockchain. This tool helps you discover, validate, and submit data to the decentralized Elephant Network.

## Quick Start

### Installation

```bash
# Install globally (recommended)
npm install -g @elephant-xyz/cli

# Or use without installation
npx @elephant-xyz/cli --help
```

### Requirements

- Node.js 20.0 or higher
- Internet connection for blockchain and IPFS access
- Polygon mainnet access (via RPC)

## What You Can Do

The Elephant Network CLI provides three main workflows:

1. **📋 List Assignments** - Discover what data you need to submit
2. **✅ Validate & Upload** - Process and upload your data files  
3. **🔗 Submit to Blockchain** - Register your submissions on-chain

## Workflow 1: Discovering Your Assignments

### Step 1: Find Your Assignments

```bash
elephant-cli list-assignments --oracle YOUR_ELEPHANT_ADDRESS
```

**What this does:**
- Scans the Polygon blockchain for assignments to your elephant address
- Downloads the assignment specifications from IPFS
- Shows you what data you need to prepare

**Example output:**
```
✔ Current block: 71876500
✔ Found 2 assignments

Assignment 1:
  CID: QmWUnTmuodSYEuHVPgxtrARGra2VpzsusAp4FqT9FWobuU
  Block: 71875870
  Downloaded to: ./downloads/QmWUnTmuodSYEuHVPgxtrARGra2VpzsusAp4FqT9FWobuU

Summary: 2 assignments found, 2 files downloaded
```

### Step 2: Review Your Assignments

Check the downloaded files in the `./downloads` directory. Each file contains:
- Data schema (what format your data should follow)
- Property requirements
- Validation rules

## Workflow 2: Preparing and Uploading Data

### Step 1: Organize Your Data

Structure your data directory like this:
```
your-data/
├── property1_cid/
│   └── schema_cid.json     # Your data file
├── property2_cid/
│   └── schema_cid.json     # Your data file
└── ...
```

**Important:** 
- Directory names must be property CIDs from your assignments
- File names must be schema CIDs from your assignments
- Files must contain valid JSON data

### Step 2: Get Your Credentials

You'll need:
- **Private Key**: Your elephant wallet private key
- **Pinata JWT**: Token for IPFS uploads (get from [Pinata](https://pinata.cloud))

Set up environment variables (recommended):
```bash
# Create a .env file in your project directory
echo "ELEPHANT_PRIVATE_KEY=your_private_key_here" >> .env
echo "PINATA_JWT=your_pinata_jwt_here" >> .env
```

### Step 3: Validate and Upload (Dry Run First)

Always test first with `--dry-run`:

```bash
# Test without uploading
elephant-cli validate-and-upload ./your-data --dry-run --output-csv test-results.csv
```

**What this does:**
- Validates your JSON files against the required schemas
- Converts file path references to IPFS CIDs
- Shows what would be uploaded (without actually uploading)
- Creates a CSV report

### Step 4: Upload for Real

If dry run succeeds, upload your data:

```bash
elephant-cli validate-and-upload ./your-data --output-csv upload-results.csv
```

**What this does:**
- Validates all your data files
- Uploads valid files to IPFS via Pinata
- Creates a CSV file with upload results (needed for next step)

## Workflow 3: Submitting to Blockchain

### Step 1: Review Upload Results

Check the CSV file from the previous step (`upload-results.csv`). It contains:
- Property CIDs
- Data group CIDs  
- Your uploaded data CIDs
- File paths and timestamps

### Step 2: Submit to Contract (Dry Run First)

Test the blockchain submission:

```bash
elephant-cli submit-to-contract upload-results.csv --dry-run
```

**What this does:**
- Verifies your data differs from existing consensus
- Checks you haven't already submitted the same data
- Shows what transactions would be sent (without sending them)

### Step 3: Submit for Real

If dry run succeeds, submit to the blockchain:

```bash
elephant-cli submit-to-contract upload-results.csv --gas-price 30
```

**What this does:**
- Submits your data hashes to the Elephant Network smart contract
- Groups submissions into batches for efficiency
- Provides transaction confirmations

## Advanced Features

### Custom Configuration

```bash
# Use custom RPC endpoint
elephant-cli list-assignments --oracle YOUR_ADDRESS --rpc https://your-rpc.com

# Use custom IPFS gateway
elephant-cli list-assignments --oracle YOUR_ADDRESS --gateway https://your-gateway.com/ipfs/

# Control upload concurrency
elephant-cli validate-and-upload ./data --max-concurrent-uploads 5

# Custom gas price for submissions
elephant-cli submit-to-contract results.csv --gas-price 50
# Or let the network decide
elephant-cli submit-to-contract results.csv --gas-price auto
```

### IPLD Links Support

Your JSON data can reference other files using IPLD links:

```json
{
  "title": "Main Document",
  "metadata": {
    "/": "./metadata.json"
  },
  "license": {
    "/": "../shared/license.json"  
  }
}
```

The CLI automatically:
- Uploads referenced files to IPFS
- Converts file paths to IPFS CIDs
- Creates proper IPLD-linked data structures

### Block Range Optimization

```bash
# Search recent blocks only (faster)
elephant-cli list-assignments --oracle YOUR_ADDRESS --from-block 71800000

# Search specific range
elephant-cli list-assignments --oracle YOUR_ADDRESS --from-block 71000000
```

## Common Command Options

### List Assignments Options
- `--oracle <address>` - Your elephant address (required)
- `--from-block <number>` - Starting block to search from
- `--download-dir <path>` - Where to save assignments (default: ./downloads)
- `--rpc <url>` - Custom RPC endpoint
- `--gateway <url>` - Custom IPFS gateway

### Validate and Upload Options  
- `--pinata-jwt <token>` - Pinata API token (or use PINATA_JWT env var)
- `--output-csv <file>` - Results file name (default: upload-results.csv)
- `--max-concurrent-uploads <num>` - Control upload speed
- `--dry-run` - Test without uploading

### Submit to Contract Options
- `--private-key <key>` - Wallet private key (or use ELEPHANT_PRIVATE_KEY env var)
- `--gas-price <value>` - Gas price in Gwei or 'auto' (default: 30)
- `--transaction-batch-size <num>` - Items per transaction (default: 200)
- `--dry-run` - Test without submitting

## Troubleshooting

### Common Issues

**"Invalid elephant address"**
- Use a valid Ethereum address format: `0x1234...` (42 characters)

**"No assignments found"**
- Check your elephant address is correct
- Try a wider block range with `--from-block`
- Verify you have assignments in the specified period

**"Validation failed"**
- Check your JSON files match the required schema
- Ensure file paths exist for IPLD links
- Review error details in the generated error CSV

**"Upload failed"**
- Verify your Pinata JWT token is valid
- Check your internet connection
- Try reducing `--max-concurrent-uploads`

**"Transaction failed"**
- Ensure your private key has sufficient MATIC for gas
- Try increasing `--gas-price`
- Check you haven't already submitted the same data

### Getting Help

```bash
# View all commands
elephant-cli --help

# Get help for specific command
elephant-cli list-assignments --help
elephant-cli validate-and-upload --help
elephant-cli submit-to-contract --help
```

### Debug Mode

Set `DEBUG=elephant:*` environment variable for detailed logging:

```bash
DEBUG=elephant:* elephant-cli list-assignments --oracle YOUR_ADDRESS
```

## Network Information

- **Blockchain**: Polygon Mainnet
- **Smart Contract**: `0x79D5046e34D4A56D357E12636A18da6eaEfe0586`
- **Default RPC**: `https://rpc.therpc.io/polygon`
- **Default IPFS Gateway**: `https://gateway.pinata.cloud/ipfs/`

## Security Notes

- Never share your private keys
- Use environment variables for sensitive data
- Always test with `--dry-run` first
- Keep your `.env` file secure and never commit it to version control

## Support

- **Documentation**: [Elephant Lexicon](https://lexicon.elephant.xyz/)
- **Issues**: Report problems via GitHub issues
- **Community**: Join the Elephant Network community for support

## License

MIT