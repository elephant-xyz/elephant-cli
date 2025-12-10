# API Submission Mode

The Elephant CLI now supports submitting data through a centralized API as an alternative to direct blockchain submission. This mode is useful when you want to delegate transaction signing to a centralized service.

## Overview

In API submission mode, the CLI:

1. Generates unsigned transactions locally
2. Submits them to the centralized API
3. Waits for the API to sign and broadcast the transactions
4. Monitors transaction confirmation on the blockchain
5. Reports the final status

## Usage

To use API submission mode, provide these three parameters together:

```bash
elephant-cli submit-to-contract <csv-file> \
  --domain oracles.staircaseapi.com \
  --api-key YOUR_API_KEY \
  --oracle-key-id YOUR_ORACLE_KEY_ID \
  --from-address 0xYOUR_ADDRESS
```

### Required Parameters

- `--domain`: The API domain (e.g., `oracles.staircaseapi.com`)
- `--api-key`: Your API authentication key
- `--oracle-key-id`: Your oracle key identifier

### Optional Parameters

- `--from-address`: The address to use as the transaction sender (defaults to zero address if not provided)
- `--gas-price`: Gas price in Gwei or 'auto' (default: 30)
- `--gas-buffer`: Percent buffer to add to the estimated gas limit (default: 20)
- `--dry-run`: Test mode without actually submitting transactions
- `--transaction-ids-csv`: Output CSV file for transaction IDs (default: transaction-ids-{timestamp}.csv)

### Important Notes

1. **No Private Key**: When using API mode, you must NOT provide a private key. The API handles transaction signing.
2. **All Three Required**: You must provide all three API parameters (`--domain`, `--api-key`, `--oracle-key-id`) together.
3. **HTTPS Only**: The domain is automatically upgraded to HTTPS for security.

## Example

```bash
# Submit data via API
elephant-cli submit-to-contract ./results.csv \
  --domain oracles.staircaseapi.com \
  --api-key abc123def456 \
  --oracle-key-id 550e8400-e29b-41d4-a716-446655440000 \
  --from-address 0x1234567890123456789012345678901234567890 \
  --gas-price auto \
  --gas-buffer 25

# Dry run to test without submitting
elephant-cli submit-to-contract ./results.csv \
  --domain oracles.staircaseapi.com \
  --api-key abc123def456 \
  --oracle-key-id 550e8400-e29b-41d4-a716-446655440000 \
  --dry-run
```

## Output

The command generates two CSV files:

### 1. Transaction Status CSV (`transaction-status.csv`)

Contains detailed status information:

- Batch index
- Transaction hash
- Status (pending/success/failed)
- Block number
- Gas used
- Item count
- Error message (if any)
- Timestamp

### 2. Transaction IDs CSV

Contains simplified transaction tracking:

- Transaction hash
- Batch index
- Item count
- Timestamp
- Status

Default filename: `transaction-ids-{timestamp}.csv` (or specify with `--transaction-ids-csv`)

When submitting less than 5 transactions, the transaction IDs are also displayed in the console for quick reference.

## API Endpoint

The CLI sends POST requests to:

```
https://{domain}/oracles/submit-data
```

With headers:

- `x-api-key: YOUR_API_KEY`
- `Content-Type: application/json`

Request body:

```json
{
  "oracle_key_id": "YOUR_ORACLE_KEY_ID",
  "unsigned_transaction": [
    {
      "from": "0x...",
      "to": "0x...",
      "gas": "0x...",
      "value": "0x0",
      "data": "0x...",
      "nonce": "0x...",
      "type": "0x2",
      "maxFeePerGas": "0x...",
      "maxPriorityFeePerGas": "0x..."
    }
  ]
}
```

Response:

```json
{
  "transaction_hash": "0x..."
}
```

## Error Handling

- Network errors are retried up to 3 times with exponential backoff
- API errors (4xx, 5xx) are not retried and fail immediately
- Transaction confirmation timeout is 5 minutes by default
- All errors are logged to the transaction status CSV

## Security Considerations

1. **API Key Protection**: Never commit your API key to version control
2. **HTTPS Enforcement**: All API calls use HTTPS
3. **No Private Keys**: Private keys are never sent to the API
4. **Input Validation**: All parameters are validated before use
