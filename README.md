# Elephant Network CLI

A command-line tool for Elephant Network oracles to manage their data on the Polygon blockchain. This tool helps you validate and submit data to the decentralized Elephant Network.

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

The Elephant Network CLI provides two main workflows:

1. **✅ Validate & Upload** - Process and upload your data files
2. **🔗 Submit to Blockchain** - Register your submissions on-chain

## Workflow 1: Preparing and Uploading Data

### Step 1: Organize Your Data

Structure your data directory like this:

```
your-data/
├── root_cid1/
│   └── data_group_schema_cid.json     # Your data file
├── root_cid2/
│   └── data_group_schema_cid.json     # Your data file
└── ...
```

**Important:**

- Directory names must be root CIDs (a.k.a. seed CIDs)
- File names must be schema CIDs
- Files must contain valid JSON data

### Step 2: Get Your Credentials

You'll need:

- **Private Key**: Your oracle wallet private key
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

**IPLD Links Support:**
Your JSON data can reference other files using IPLD links:

Before upload

```json
{
  "from": { "/": "./property.json" },
  "to": { "/": "./address.json" }
}
```

After upload

```json
{
  "from": { "/": "bafybeifxyz123propertydata456..." },
  "to": { "/": "bafybeiabc789addressdata012..." }
}
```

You can also build arrays of links. After transformation, the array will be sorted alphabetically by CID:

Before upload:

```json
[
  {
    "/": "./property.json"
  },
  {
    "/": "./address.json"
  }
]
```

After upload:

```json
[
  {
    "/": "bafybeifxyz123propertydata456..."
  },
  {
    "/": "bafybeiabc789addressdata012..."
  }
]
```

The CLI automatically:

- Uploads referenced files to IPFS
- Converts file paths to IPFS CIDs (CIDv1 format)
- Creates proper IPLD-linked data structures
- Canonicalize the JSON files

Learn more: [IPLD Course](https://proto.school/course/ipld) | [IPFS Course](https://proto.school/course/ipfs)

### Step 4: Upload for Real

If dry run succeeds, upload your data:

```bash
elephant-cli validate-and-upload ./your-data --output-csv upload-results.csv
```

**What this does:**

- Validates all your data files
- Uploads valid files to IPFS via Pinata
- Creates a CSV file with upload results (needed for next step)

## Workflow 2: Submitting to Blockchain

### Step 1: Review Upload Results

Check the CSV file from the previous step (`upload-results.csv`). It contains:

- Root CIDs (a.k.a. seed CIDs)
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
# Control upload concurrency
elephant-cli validate-and-upload ./data --max-concurrent-uploads 5

# Custom gas price for submissions
elephant-cli submit-to-contract results.csv --gas-price 50
# Or let the network decide
elephant-cli submit-to-contract results.csv --gas-price auto
```

## Common Command Options

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

**"Invalid oracle address"**

- Use a valid Ethereum address format: `0x1234...` (42 characters)

**"No data found"**

- Check your oracle address is correct
- Verify you have data in the specified period

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
elephant-cli validate-and-upload --help
elephant-cli submit-to-contract --help
```

### Debug Mode

Set `DEBUG=elephant:*` environment variable for detailed logging:

```bash
DEBUG=elephant:* elephant-cli validate-and-upload ./your-data
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
