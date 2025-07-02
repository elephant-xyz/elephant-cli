# Currency Format Validator

## Overview

The `currency` format validator in the Elephant CLI validates numeric values suitable for monetary amounts. It ensures that numbers are positive (greater than zero) and have at most 2 decimal places.

## Format Details

- **Type**: `number` (not string)
- **Value Range**: Must be greater than 0
- **Decimal Places**: Maximum 2
- **Negative Values**: Not allowed
- **Zero**: Not allowed
- **Special Values**: `NaN`, `Infinity`, and `-Infinity` are rejected

## Valid Examples

```javascript
100        // Integer
100.00     // Two decimal places
100.0      // One decimal place
100.5      // One decimal place
100.50     // Two decimal places
0.01       // Smallest value with 2 decimals
0.50       // Fractional value
1.1        // One decimal place
999999.99  // Large value
```

## Invalid Examples

```javascript
0          // Zero (must be greater than 0)
-100       // Negative value
-0.01      // Negative small value
100.123    // Three decimal places
100.001    // Three decimal places
"100"      // String (must be number)
"$100"     // String with currency symbol
NaN        // Not a number
Infinity   // Infinity
null       // Null
undefined  // Undefined
```

## Usage in Schema

```json
{
  "type": "object",
  "properties": {
    "price": {
      "type": "number",
      "format": "currency"
    },
    "tax": {
      "type": "number",
      "format": "currency"
    },
    "total": {
      "type": "number",
      "format": "currency"
    }
  },
  "required": ["price", "total"]
}
```

## Example Data

```json
{
  "price": 19.99,
  "tax": 1.60,
  "total": 21.59
}
```

## Implementation Notes

The validator checks:
1. The value is a valid finite number
2. The value is greater than 0 (positive)
3. If decimals are present, there are at most 2 decimal places
4. Scientific notation is properly handled (e.g., `1.5e2` = `150`)

## Difference from Standard Number Validation

While standard number validation accepts any valid number, the currency format adds these constraints:
- Must be positive (> 0)
- Maximum 2 decimal places

This makes it suitable for monetary values like prices, costs, or fees where:
- Negative amounts are not allowed
- Zero amounts are not valid
- Cents/pence are the smallest unit