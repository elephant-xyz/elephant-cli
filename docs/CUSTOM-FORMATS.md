# Custom Format Validators in Elephant CLI

## Overview

The Elephant CLI's JSON validator service supports several custom format validators in addition to the standard formats provided by `ajv-formats`. These custom formats are designed to validate specific data types used in the Elephant Network.

## Supported Custom Formats

### 1. Currency Format (`currency`)

Validates positive numeric values with a maximum of 2 decimal places. Suitable for monetary amounts like prices, costs, or fees.

**Type**: `number`

**Validation Rules**:

- Must be greater than 0
- Maximum 2 decimal places
- No special values (NaN, Infinity)

**Valid Examples**:

- `100`
- `100.50`
- `0.01`
- `999999.99`

**Invalid Examples**:

- `0` (must be greater than 0)
- `-100` (negative values not allowed)
- `100.123` (3 decimal places)
- `"100"` (string, not number)

**Schema Example**:

```json
{
  "type": "number",
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
- For CIDv1, requires raw codec (0x55) with SHA-256 hash
- CIDv0 is not accepted

**Valid Examples**:

- `ipfs://bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku` (CIDv1 raw)
- `ipfs://bafkreiggtrptmp32pl3to7x2tw5eedceyfld6sv25dlcdro6lowvxc5ili`

**Invalid Examples**:

- `ipfs://QmYjtig7VJQ6XsnUjqqJvj7QaMcCAwtrgNdahSiFofrE7o` (CIDv0)
- `ipfs://baguqeeraevt2kit5iquvk554xn7jfr63skcsixiipv3wyexx65g7vyqh5rsq` (wrong codec)

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
      "type": "number",
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
  "format": "rate_percent",
  "pattern": "^[0-9]+\\.[0-9]{3}$"
}
```

## Implementation Details

The custom formats are implemented in `src/services/json-validator.service.ts` in the `setupCustomFormats()` method. They are added after the default `ajv-formats` to ensure proper override behavior.

### Technical Notes

1. **Unicode Mode**: AJV compiles patterns in Unicode mode, so escape sequences in character classes must be carefully handled
2. **Format Override**: The `date` and `uri` formats override the defaults from `ajv-formats`
3. **CID Validation**: The `cid` and `ipfs_uri` formats use the `multiformats` library for proper CID validation
4. **Type Checking**: Each format validator checks the value type to ensure it matches the expected type

## Testing

Comprehensive tests for all custom formats are located in:

- `tests/unit/services/json-validator-currency-format.test.ts` (for currency format)
- `tests/unit/services/json-validator.service.test.ts` (for other formats)

Run tests with:

```bash
npm test
```

