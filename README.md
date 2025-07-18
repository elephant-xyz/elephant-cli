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

To use this tool, the oracle needs to have:
1.  Node.js 20.0 or higher.
2.  A custom JSON RPC URL for Polygon (e.g., from Alchemy or Infura).
3.  An exported Polygon private key (e.g., from MetaMask). For institutional oracles, an API key, domain, and oracle key ID are required.
4.  A Pinata JWT for IPFS uploads.
5.  Stable internet access.


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

- Directory names must be root CIDs (a.k.a. seed CIDs) OR contain a seed datagroup file
- File names must be schema CIDs
- Files must contain valid JSON data
- Schema CIDs must point to valid data group schemas (see [Data Group Schema Requirements](#data-group-schema-requirements))

**Seed Datagroup Support:**

Alternatively, you can use directories with any name as long as they contain a file named with the hardcoded seed datagroup schema CID: `bafkreieyzdh647glz5gtzewydfqe42cfs2p3veuipxgc7qmqvcpx6rvnoy.json`

```
your-data/
├── property_data_set_1/          # Any name (not a CID)
│   ├── bafkreieyzdh647glz5gtzewydfqe42cfs2p3veuipxgc7qmqvcpx6rvnoy.json  # Seed file
│   └── other_schema_cid.json     # Other data files
├── bafybe.../                    # Traditional CID directory
│   └── schema_cid.json           # Data file
└── ...
```

When using seed datagroup directories:

- The seed file is uploaded first to IPFS
- The CID of the uploaded seed file becomes the propertyCid for ALL files in that directory
- This allows flexible directory naming while maintaining traceability

### Data Group Schema Requirements

All schema CIDs used as file names must point to valid **data group schemas**. A data group schema is a JSON schema that describes an object with exactly two properties:

1. **`label`** - Can be any valid JSON schema definition
2. **`relationships`** - Can be any valid JSON schema definition

**Valid Data Group Schema Example:**

```json
{
  "type": "object",
  "properties": {
    "label": {
      "type": "string",
      "description": "Human-readable label for the data group"
    },
    "relationships": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "type": { "type": "string" },
          "target": { "type": "string" }
        }
      }
    }
  },
  "required": ["label", "relationships"]
}
```

**Invalid Examples:**

```json
// ❌ Wrong: Missing relationships property
{
  "type": "object",
  "properties": {
    "label": { "type": "string" }
  }
}

// ❌ Wrong: Has extra properties
{
  "type": "object",
  "properties": {
    "label": { "type": "string" },
    "relationships": { "type": "array" },
    "extra": { "type": "string" }
  }
}

// ❌ Wrong: Not describing an object
{
  "type": "string"
}
```

**Where to Find Valid Schemas:**

Visit [https://lexicon.elephant.xyz](https://lexicon.elephant.xyz) to find valid data group schemas for your use case.

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

### Cold Wallet & External Signing

For enhanced security, you can generate unsigned transactions for signing on an offline device:

```bash
# Generate unsigned transactions without exposing your private key
elephant-cli submit-to-contract upload-results.csv \
  --dry-run \
  --unsigned-transactions-json unsigned-txs.json \
  --from-address 0x742d35Cc6634C0532925a3b844Bc9e7595f89ce0
```

### Centralized API Submission

Submit data through a centralized API instead of directly to the blockchain:

```bash
# Submit via API (no private key needed)
elephant-cli submit-to-contract upload-results.csv \
  --domain oracles.staircaseapi.com \
  --api-key YOUR_API_KEY \
  --oracle-key-id YOUR_ORACLE_KEY_ID \
  --from-address 0x742d35Cc6634C0532925a3b844Bc9e7595f89ce0
```

This mode:

- Generates unsigned transactions locally
- Submits them to the API for signing
- Monitors transaction confirmation
- Reports status in `transaction-status.csv`

See [API Submission Documentation](./docs/API-SUBMISSION.md) for details.

**What this does:**

- Creates a JSON file with EIP-1474 compatible unsigned transactions
- No private key required - specify the sender address directly
- Perfect for cold wallet workflows and hardware wallet signing
- Transactions can be signed offline and submitted later

**Output Format:**

The generated JSON follows the [EIP-1474 standard](https://eips.ethereum.org/EIPS/eip-1474) for `eth_sendTransaction`:

```json
[
  {
    "from": "0x742d35Cc6634C0532925a3b844Bc9e7595f89ce0",
    "to": "0x79D5046e34D4A56D357E12636A18da6eaEfe0586",
    "gas": "0x18741",
    "gasPrice": "0x6fc23ac00",
    "value": "0x0",
    "data": "0xb35d6ef2...",
    "nonce": "0x0",
    "type": "0x0"
  }
]
```

**Use Cases:**

- **Cold Storage**: Generate transactions on an online machine, sign on offline device
- **Hardware Wallets**: Export transactions for signing with Ledger, Trezor, etc.
- **Multi-signature**: Prepare transactions for multiple signers
- **Gas Optimization**: Generate now, submit when gas prices are lower

## Common Command Options

### Validate and Upload Options

- `--pinata-jwt <token>` - Pinata API token (or use PINATA_JWT env var)
- `--output-csv <file>` - Results file name (default: upload-results.csv)
- `--max-concurrent-uploads <num>` - Control upload speed
- `--dry-run` - Test without uploading

### Submit to Contract Options

- `--private-key <key>` - Wallet private key (or use ELEPHANT_PRIVATE_KEY env var)
- `--rpc-url <url>` - Custom RPC endpoint
- `--contract-address <address>` - Custom smart contract address
- `--gas-price <value>` - Gas price in Gwei or 'auto' (default: 30)
- `--transaction-batch-size <num>` - Items per transaction (default: 200)
- `--dry-run` - Test without submitting
- `--unsigned-transactions-json <file>` - Generate unsigned transactions for external signing (dry-run only)
- `--from-address <address>` - Specify sender address for unsigned transactions (makes private key optional)

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

**"Schema CID is not a valid data group schema"**

- Verify the schema CID points to a valid data group schema
- Data group schemas must have exactly two properties: `label` and `relationships`
- Visit [https://lexicon.elephant.xyz](https://lexicon.elephant.xyz) to find valid schemas

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
