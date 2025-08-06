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

The Elephant Network CLI provides three main workflows:

1. **🔍 Validate Only** - Check your data files for errors without uploading
2. **✅ Validate & Upload** - Process and upload your data files
3. **🔗 Submit to Blockchain** - Register your submissions on-chain

Plus utility commands:

- **🔄 CID-Hex Conversion** - Convert between IPFS CIDs and Ethereum hex hashes

## Workflow 1: Preparing and Uploading Data

### Step 1: Organize Your Data

You can provide your data in two ways:

#### Option 1: Directory Structure

Structure your data directory like this:

```
your-data/
├── root_cid1/
│   └── data_group_schema_cid.json     # Your data file
├── root_cid2/
│   └── data_group_schema_cid.json     # Your data file
└── ...
```

#### Option 2: ZIP File

Alternatively, you can provide a ZIP file containing the same directory structure:

```bash
# Create a ZIP file of your data directory
zip -r your-data.zip your-data/

# Use the ZIP file with the CLI
elephant-cli validate your-data.zip
```

**Important:**

- Directory names must be root CIDs (a.k.a. seed CIDs) OR contain a seed datagroup file
- File names must be schema CIDs
- Files must contain valid JSON data
- Schema CIDs must point to valid data group schemas (see [Data Group Schema Requirements](#data-group-schema-requirements))

### **Seed Datagroup Support:**

Alternatively, you can use directories with any name as long as they contain a file named with the hardcoded seed datagroup schema CID: `bafkreif7ywbjxu3s6jfi6ginvmsufeux3cd5eujuivg2y7tmqt2qk4rsoe.json`

```
your-data/
├── property_data_set_1/          # Any name (not a CID)
│   ├── bafkreif7ywbjxu3s6jfi6ginvmsufeux3cd5eujuivg2y7tmqt2qk4rsoe.json  # Seed file
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

### Step 2: Validate Your Data (Optional but Recommended)

Before uploading, you can validate your data files without any credentials:

```bash
# Validate all files in your data directory
elephant-cli validate ./your-data

# Or validate from a ZIP file
elephant-cli validate ./your-data.zip
```

This command:

- Checks directory structure
- Validates JSON syntax
- Verifies data against schemas
- Reports all errors to `submit_errors.csv`
- Shows validation summary

No Pinata JWT or private key needed for validation!

### Step 3: Get Your Credentials

You'll need:

- **Private Key**: Your oracle wallet private key
- **Pinata JWT**: Token for IPFS uploads (get from [Pinata](https://pinata.cloud))

Set up environment variables (recommended):

```bash
# Create a .env file in your project directory
echo "ELEPHANT_PRIVATE_KEY=your_private_key_here" >> .env
echo "PINATA_JWT=your_pinata_jwt_here" >> .env
```

### Step 4: Validate and Upload (Dry Run First)

Always test first with `--dry-run`:

```bash
# Test without uploading (from directory)
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

### Step 5: Upload for Real

If dry run succeeds, upload your data:

```bash
# Upload from directory
elephant-cli validate-and-upload ./your-data --output-csv upload-results.csv
```

**What this does:**

- Validates all your data files
- Uploads valid files to IPFS via Pinata
- **NEW**: Automatically generates HTML fact sheets for each property
- Uploads HTML files to IPFS for easy web viewing
- Creates a CSV file with upload results and HTML links (needed for next step)

**HTML Fact Sheet Generation:**

The CLI now automatically generates beautiful HTML fact sheets for your properties:

- Installs/updates the fact-sheet tool automatically
- Generates self-contained HTML files with inline CSS and JavaScript
- Uploads HTML files to IPFS in parallel for faster processing
- Provides web-accessible links in the format: `http://dweb.link/ipfs/<cid>`
- Shows the first 5 property links in the console output
- All HTML links are saved in the CSV file for reference

Example output:

```
🌐 Property Fact Sheet Links:
  (Note: It may take a few minutes for pages to propagate through IPFS gateways)

  1. Property: bafkreitest1
     http://dweb.link/ipfs/bafkreihtmlcid1

  2. Property: bafkreitest2
     http://dweb.link/ipfs/bafkreihtmlcid2

  3. Property: bafkreitest3
     http://dweb.link/ipfs/bafkreihtmlcid3

  4. Property: bafkreitest4
     http://dweb.link/ipfs/bafkreihtmlcid4

  5. Property: bafkreitest5
     http://dweb.link/ipfs/bafkreihtmlcid5

  ... and 15 more properties.

📄 All HTML links have been saved to: upload-results.csv
  Please check this file for the complete list of property fact sheet URLs.
```

## Workflow 2: Submitting to Blockchain

### Step 1: Review Upload Results

Check the CSV file from the previous step (`upload-results.csv`). It contains:

- Root CIDs (a.k.a. seed CIDs)
- Data group CIDs
- Your uploaded data CIDs
- File paths and timestamps
- HTML fact sheet links for web viewing

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
- **NEW**: Returns immediately after submission (no waiting for confirmations)
- **NEW**: Saves transaction IDs to a CSV file for tracking
- **NEW**: Displays transaction IDs in console when less than 5 transactions

**Transaction Tracking:**

The CLI now automatically tracks all submitted transactions:

- Generates a CSV file with transaction details (hash, batch index, item count, timestamp, status)
- Default filename: `transaction-ids-{timestamp}.csv` in the reports directory
- Use `--transaction-ids-csv` to specify a custom output path
- When submitting less than 5 transactions, IDs are displayed directly in the console
- **All transactions are marked as "pending" - use `check-transaction-status` to check their status**

Example output for small submissions:

```
📝 Transaction IDs:
  0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef
  0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890
  0xfedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321
```

### Step 4: Check Transaction Status

Check the status of your submitted transactions:

```bash
elephant-cli check-transaction-status transaction-ids.csv
```

**What this does:**

- Reads transaction IDs from the CSV file
- Checks current status on the blockchain (success/failed/pending)
- Updates the CSV with current status, block numbers, and gas used
- Shows a summary of transaction statuses

**Options:**

```bash
# Specify output file
elephant-cli check-transaction-status transaction-ids.csv --output-csv status-update.csv

# Control concurrent checks
elephant-cli check-transaction-status transaction-ids.csv --max-concurrent 20

# Use custom RPC
elephant-cli check-transaction-status transaction-ids.csv --rpc-url https://polygon-rpc.com
```

## Utility Commands

### Data Fetching

The `fetch-data` command allows you to download and fetch entire data trees from IPFS, following all CID references recursively. It supports two input modes:

#### Mode 1: Fetch from CID

Download data starting from a root CID:

```bash
# Basic usage
elephant-cli fetch-data bafybeiabc123...

# With custom output directory
elephant-cli fetch-data bafybeiabc123... --output-dir ./my-data

# With custom IPFS gateway
elephant-cli fetch-data bafybeiabc123... --gateway https://ipfs.io/ipfs/
```

#### Mode 2: Fetch from Transaction Hash

Extract and download data from a blockchain transaction (must be a submitBatchData transaction):

```bash
# Basic usage (requires RPC access)
# Transaction hash must be 32 bytes (64 hex characters)
elephant-cli fetch-data 0x1234567890abcdef...

# With custom RPC URL
elephant-cli fetch-data 0x1234567890abcdef... --rpc-url https://polygon-rpc.com

# With all options
elephant-cli fetch-data 0x1234567890abcdef... \
  --rpc-url https://polygon-rpc.com \
  --gateway https://ipfs.io/ipfs/ \
  --output-dir ./tx-data
```

**Transaction Mode Details:**
- Fetches transaction data from the blockchain
- Decodes `submitBatchData` calls to extract property, data group, and data hashes
- Converts hashes to CIDs using the `CidHexConverterService` (raw codec, base32 encoding)
- Creates folder structure: `output-dir/propertyCID/` with data files directly inside
- Downloads all referenced data recursively

**Features:**
- Recursively follows all CID references in JSON data
- Replaces CID references with local file paths
- Preserves data structure and relationships
- Supports rate limiting with automatic retries
- Uses schema manifest from Elephant Network for proper file naming

**Output Structure:**
```
data/
├── bafybeiabc123.../           # Property CID (transaction mode)
│   ├── bafkreidef456.json     # Data group file
│   ├── property_seed.json     # Referenced files
│   ├── property_seed_from.json
│   └── property_seed_to.json
├── bafybeiabc456.../           # Another property
│   ├── bafkreidef789.json     # Data group file
│   └── other_data.json        # Referenced files
└── bafybeicid123.../          # CID mode output (no data_ prefix)
    ├── bafkreiroot.json        # Root data file
    └── bafkreiref456.json      # Referenced files
```

### CID-Hex Conversion

The CLI provides utilities to convert between IPFS CIDs and Ethereum hex hashes:

#### hex-to-cid

Convert an Ethereum hex hash to a CID v1 with raw codec:

```bash
# Convert hex to CID
elephant-cli hex-to-cid 0xb94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9
# Output: CID: bafkreifzjut3te2nhyekklss27nh3k72ysco7y32koao5eei66wof36n5e

# Works with or without 0x prefix
elephant-cli hex-to-cid b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9

# Validate input format
elephant-cli hex-to-cid 0xb94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9 --validate
# Output: ✓ Valid hex format
#         CID: bafkreifzjut3te2nhyekklss27nh3k72ysco7y32koao5eei66wof36n5e

# Quiet mode for scripting
elephant-cli hex-to-cid 0xb94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9 --quiet
# Output: bafkreifzjut3te2nhyekklss27nh3k72ysco7y32koao5eei66wof36n5e
```

#### cid-to-hex

Convert a CID v1 to an Ethereum hex hash:

```bash
# Convert CID to hex
elephant-cli cid-to-hex bafkreifzjut3te2nhyekklss27nh3k72ysco7y32koao5eei66wof36n5e
# Output: Hex: 0xb94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9

# Validate CID format
elephant-cli cid-to-hex bafkreifzjut3te2nhyekklss27nh3k72ysco7y32koao5eei66wof36n5e --validate
# Output: ✓ Valid CID format
#         Hex: 0xb94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9

# Quiet mode for scripting
elephant-cli cid-to-hex bafkreifzjut3te2nhyekklss27nh3k72ysco7y32koao5eei66wof36n5e --quiet
# Output: 0xb94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9
```

**Technical Details:**

- Only supports CID v1 with raw codec (0x55) and SHA-256 hash (0x12)
- Hex output always includes the `0x` prefix for Ethereum compatibility
- Input hex can be provided with or without the `0x` prefix
- Both commands validate input format and provide clear error messages

**Use Cases:**

- Converting between IPFS CIDs and smart contract hash representations
- Debugging blockchain transactions that reference IPFS content
- Integrating with systems that use different hash representations
- Scripting and automation with the `--quiet` flag

## Advanced Features

### Custom Configuration

```bash
# Control upload concurrency
elephant-cli validate-and-upload ./data --max-concurrent-uploads 5

# Custom gas price for submissions
elephant-cli submit-to-contract results.csv --gas-price 50
# Or let the network decide
elephant-cli submit-to-contract results.csv --gas-price auto

# Save transaction IDs to a specific file
elephant-cli submit-to-contract results.csv --transaction-ids-csv my-transactions.csv
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
- **NEW**: Returns immediately after submission (no waiting)
- Reports status as "pending" in `transaction-status.csv`
- Use `check-transaction-status` command to check transaction status

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

### Validate Options

- `--output-csv <file>` - Error report file name (default: submit_errors.csv)
- `--max-concurrent-tasks <num>` - Control validation speed

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
- `--transaction-ids-csv <file>` - Output CSV file for transaction IDs (default: transaction-ids-{timestamp}.csv)

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
elephant-cli validate --help
elephant-cli validate-and-upload --help
elephant-cli submit-to-contract --help
elephant-cli fetch-data --help
elephant-cli hex-to-cid --help
elephant-cli cid-to-hex --help
```

### Debug Mode

Set `DEBUG=elephant:*` environment variable for detailed logging:

```bash
# Debug with directory input
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
