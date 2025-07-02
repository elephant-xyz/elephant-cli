# Custom Format Validators in Elephant CLI

## Overview

The Elephant CLI's JSON validator service supports several custom format validators in addition to the standard formats provided by `ajv-formats`. These custom formats are designed to validate specific data types used in the Elephant Network.

## Supported Custom Formats

### 1. Currency Format (`currency`)

Validates monetary values with optional dollar sign and thousands separators.

**Pattern**: `^\$?([0-9]{1,3}(,[0-9]{3})*|[0-9]+)(\.[0-9]{2})?$`

**Valid Examples**:

- `100`
- `100.00`
- `$100`
- `$1,234.56`
- `$1,000,000.50`

**Schema Example**:

```json
{
  "type": "string",
  "format": "currency"
}
```

### 2. Date Format (`date`)

Validates ISO 8601 date format (YYYY-MM-DD).

**Valid Examples**:

- `2024-01-01`
- `2023-12-31`
- `2020-02-29` (leap year)

**Schema Example**:

```json
{
  "type": "string",
  "format": "date"
}
```

### 3. URI Format (`uri`)

Validates HTTP/HTTPS URLs with specific pattern requirements. This overrides the default `uri` format.

**Pattern**: `^https?://([\w-]+@)?[\w-]+(\.[\w-]+)+([\w\-.,@?^=%&:/~+#]*[\w\-@?^=%&/~+#])?$`

**Valid Examples**:

- `http://example.com`
- `https://sub.example.com`
- `https://example.com/path`
- `https://user@example.com`
- `https://example.com:8080/path?query=value#anchor`

**Schema Example**:

```json
{
  "type": "string",
  "format": "uri"
}
```

### 4. IPFS URI Format (`ipfs_uri`)

Validates IPFS URIs with Content Identifiers (CIDs).

**Pattern**: `^ipfs://[A-Za-z0-9]{46,59}$`

**Additional Validation**:

- Validates that the CID portion is a valid IPFS CID
- Supports both CIDv1
- Supports only raw codec (0x055)
- Supports only sha2-256 hash (0x12)

**Valid Examples**:

- `ipfs://QmYjtig7VJQ6XsnUjqqJvj7QaMcCAwtrgNdahSiFofrE7o` (CIDv0)
- `ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi` (CIDv1)

**Schema Example**:

```json
{
  "type": "string",
  "format": "ipfs_uri"
}
```

### 5. Rate Percent Format (`rate_percent`)

Validates interest rate percentages with exactly 3 decimal places.

**Pattern**: `^\d+\.\d{3}$`

**Valid Examples**:

- `5.250`
- `0.000`
- `10.375`
- `100.000`

**Schema Example**:

```json
{
  "type": "string",
  "format": "rate_percent"
}
```

## Using Custom Formats in Schemas

Custom formats can be used in JSON schemas just like standard formats:

```json
{
  "type": "object",
  "properties": {
    "price": {
      "type": "string",
      "format": "currency"
    },
    "interestRate": {
      "type": "string",
      "format": "rate_percent"
    },
    "document": {
      "type": "string",
      "format": "ipfs_uri"
    },
    "website": {
      "type": "string",
      "format": "uri"
    },
    "date": {
      "type": "string",
      "format": "date"
    }
  }
}
```

## Combining Formats with Patterns

When using both `format` and `pattern` in a schema, both validations must pass. The custom format validators are designed to work alongside pattern validation:

```json
{
  "type": "string",
  "format": "currency",
  "pattern": "^\\$[0-9,]+\\.[0-9]{2}$"
}
```

## Implementation Details

The custom formats are implemented in `src/services/json-validator.service.ts` in the `setupCustomFormats()` method. They are added after the default `ajv-formats` to ensure proper override behavior.

### Technical Notes

1. **Unicode Mode**: AJV compiles patterns in Unicode mode, so escape sequences in character classes must be carefully handled
2. **Format Override**: The `date` and `uri` formats override the defaults from `ajv-formats`
3. **CID Validation**: The `cid` and `ipfs_uri` formats use the `multiformats` library for proper CID validation

## Testing

Comprehensive tests for all custom formats are located in:

- `tests/unit/services/json-validator-custom-formats.test.ts`

Run tests with:

```bash
npm test tests/unit/services/json-validator-custom-formats.test.ts
```

