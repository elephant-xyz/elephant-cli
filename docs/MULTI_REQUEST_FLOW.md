# Multi-Request Flow Feature

## Table of Contents

- [Overview](#overview)
- [When to Use Multi-Request Flow](#when-to-use-multi-request-flow)
- [Flow Configuration Format](#flow-configuration-format)
- [Template Variables](#template-variables)
- [Request Types](#request-types)
- [Output Format](#output-format)
- [Usage Examples](#usage-examples)
- [Validation Rules](#validation-rules)
- [Troubleshooting](#troubleshooting)

## Overview

The Multi-Request Flow feature allows you to fetch property data through a sequence of HTTP requests instead of relying on a single request or browser automation. This is particularly useful when:

- Property data is distributed across multiple API endpoints
- Different aspects of property information require separate API calls
- A single page view or request cannot capture all necessary data

## When to Use Multi-Request Flow

Use multi-request flow when:

1. **Multiple endpoints**: Property data is spread across multiple API endpoints (e.g., owner info, sales history, tax data)
2. **Sequential dependencies**: You need to make multiple requests to different endpoints for the same property
3. **API-based access**: The property appraiser provides API access rather than HTML pages
4. **Complex data structures**: Different data types are served from different endpoints

**Do NOT use multi-request flow when:**
- A single HTTP request or browser flow can capture all needed data
- The website requires complex JavaScript execution or browser automation

## Flow Configuration Format

Multi-request flows are defined in JSON files with the following structure:

```json
{
  "requests": [
    {
      "key": "UniqueRequestName",
      "request": {
        "method": "GET|POST|PUT|PATCH",
        "url": "https://example.com/api/endpoint",
        "headers": {
          "content-type": "application/json"
        },
        "multiValueQueryString": {
          "param": ["value1", "value2"]
        },
        "json": {},
        "body": "string"
      }
    }
  ]
}
```

### Field Descriptions

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `requests` | Array | Yes | Array of named HTTP requests to execute |
| `key` | String | Yes | Unique identifier for this request (used as property name in output) |
| `request` | Object | Yes | HTTP request definition |
| `method` | String | Yes | HTTP method: GET, POST, PUT, or PATCH |
| `url` | String | Yes | Complete URL (must start with http:// or https://) |
| `headers` | Object | No | HTTP headers (required for POST/PUT/PATCH with body) |
| `multiValueQueryString` | Object | No | Query parameters with array values |
| `json` | Object/Array | No | JSON body (requires content-type: application/json) |
| `body` | String | No | String body (requires non-JSON content-type) |

## Template Variables

The `{{request_identifier}}` template variable can be used anywhere in the flow configuration and will be replaced with the actual parcel ID at runtime.

### Supported Locations

Template variables can be used in:

- URL paths: `https://example.com/api/{{request_identifier}}`
- Query parameters: `?parid={{request_identifier}}`
- Headers: `"x-parcel-id": "{{request_identifier}}"`
- JSON body fields: `{"parid": "{{request_identifier}}"}`
- String body: `parid={{request_identifier}}&type=property`
- Multi-value query strings: `{"ids": ["{{request_identifier}}"]}`

### Example with Template Variables

```json
{
  "requests": [
    {
      "key": "PropertyDetails",
      "request": {
        "method": "POST",
        "url": "https://example.com/api/property/{{request_identifier}}",
        "headers": {
          "content-type": "application/json",
          "x-request-id": "{{request_identifier}}"
        },
        "json": {
          "parcelId": "{{request_identifier}}",
          "requestType": "full"
        }
      }
    }
  ]
}
```

When executed with `request_identifier = "583207459"`, the actual request will be:
- URL: `https://example.com/api/property/583207459`
- Header: `x-request-id: 583207459`
- Body: `{"parcelId": "583207459", "requestType": "full"}`

## Request Types

### GET Request

Simplest form - no body, headers, or content-type needed:

```json
{
  "key": "BasicData",
  "request": {
    "method": "GET",
    "url": "https://example.com/api?id={{request_identifier}}"
  }
}
```

### POST with JSON Body

Requires `content-type: application/json` and `json` field:

```json
{
  "key": "JsonPost",
  "request": {
    "method": "POST",
    "url": "https://example.com/api",
    "headers": {
      "content-type": "application/json"
    },
    "json": {
      "parid": "{{request_identifier}}",
      "ownerType": "",
      "parcel_type": "real_property"
    }
  }
}
```

### POST with Form Data

Requires non-JSON content-type and `body` field:

```json
{
  "key": "FormPost",
  "request": {
    "method": "POST",
    "url": "https://example.com/api",
    "headers": {
      "content-type": "application/x-www-form-urlencoded"
    },
    "body": "data=%7B%22parid%22%3A%22{{request_identifier}}%22%7D"
  }
}
```

### PUT/PATCH Requests

Similar to POST - require content-type and body:

```json
{
  "key": "UpdateData",
  "request": {
    "method": "PUT",
    "url": "https://example.com/api/property",
    "headers": {
      "content-type": "text/xml"
    },
    "body": "<property><id>{{request_identifier}}</id></property>"
  }
}
```

### Multi-Value Query Strings

For query parameters that need to appear multiple times:

```json
{
  "key": "MultiQuery",
  "request": {
    "method": "GET",
    "url": "https://example.com/api",
    "multiValueQueryString": {
      "id": ["{{request_identifier}}"],
      "type": ["property", "land"]
    }
  }
}
```

Results in: `https://example.com/api?id=583207459&type=property&type=land`

## Output Format

The multi-request flow generates a single JSON file containing all request responses. Each request's response is stored under its `key` with:

- `source_http_request`: The actual HTTP request that was made (with template variables replaced and query parameters separated)
- `response`: The response data (parsed as JSON if possible, otherwise as a string)

### Response Parsing

- **JSON responses**: Automatically parsed into objects or arrays
- **Non-JSON responses**: Stored as strings (HTML, XML, plain text, etc.)
- **source_http_request**: Contains the actual resolved request with:
  - URL without query parameters
  - Query parameters in `multiValueQueryString` object
  - Template variables replaced with actual values

### Simple Example

```json
{
  "RequestKey1": {
    "source_http_request": {
      "method": "GET",
      "url": "https://example.com/api",
      "multiValueQueryString": {
        "id": ["583207459"]
      }
    },
    "response": {
      "parsed": "json",
      "data": "here"
    }
  },
  "RequestKey2": {
    "source_http_request": {
      "method": "POST",
      "url": "https://example.com/api",
      "headers": {
        "content-type": "application/json"
      },
      "json": {
        "parid": "583207459"
      }
    },
    "response": "<html>raw string if not JSON</html>"
  }
}
```

### Real-World Example: Manatee County Output

Here's an actual output file from Manatee County showing the mix of HTML and JSON responses:

```json
{
  "OwnersAndGeneralInformation": {
    "source_http_request": {
      "method": "POST",
      "url": "https://www.manateepao.gov/wp-content/themes/frontier-child/models/pao-model-owner.php",
      "headers": {
        "content-type": "application/x-www-form-urlencoded"
      },
      "body": "data=%7B%22parid%22%3A%221000000008%22%2C%22ownerType%22%3A%22%22%2C%22parcel_type%22%3A%22real_property%22%7D"
    },
    "response": "<div class=\"row m-1 pt-1\"><div class=\"col-sm-12\">...(HTML content)...</div></div>"
  },
  "Sales": {
    "source_http_request": {
      "method": "GET",
      "url": "https://www.manateepao.gov/wp-content/themes/frontier-child/models/pao-model-sales.php",
      "multiValueQueryString": {
        "parid": ["1000000008"]
      }
    },
    "response": {
      "cols": [
        {
          "title": "Sale Date",
          "type": "date"
        },
        {
          "title": "BOOK",
          "type": "text"
        },
        {
          "title": "Sale Price",
          "type": "num",
          "className": "text-right"
        }
      ],
      "rows": [
        [
          "1991-09-16 00:00:00",
          "1349",
          "1"
        ],
        [
          "1991-07-30 00:00:00",
          "1344",
          "239000"
        ]
      ]
    }
  },
  "Tax": {
    "source_http_request": {
      "method": "GET",
      "url": "https://www.manateepao.gov/wp-content/themes/frontier-child/models/pao-model-value-history.php",
      "multiValueQueryString": {
        "parid": ["1000000008"]
      }
    },
    "response": {
      "cols": [
        {
          "title": "Tax Year",
          "type": "num",
          "className": "text-right"
        },
        {
          "title": "Land Value",
          "type": "num",
          "className": "text-right"
        },
        {
          "title": "Just/Market Value",
          "type": "num",
          "className": "text-right"
        }
      ],
      "rows": [
        [
          "2025",
          "735113",
          "1511017"
        ],
        [
          "2024",
          "643933",
          "1408004"
        ]
      ]
    }
  },
  "Land": {
    "source_http_request": {
      "method": "GET",
      "url": "https://www.manateepao.gov/wp-content/themes/frontier-child/models/pao-model-land.php",
      "multiValueQueryString": {
        "parid": ["1000000008"]
      }
    },
    "response": {
      "cols": [...],
      "rows": [...]
    }
  },
  "Buildings": {
    "source_http_request": {
      "method": "GET",
      "url": "https://www.manateepao.gov/wp-content/themes/frontier-child/models/pao-model-buildings.php",
      "multiValueQueryString": {
        "parid": ["1000000008"]
      }
    },
    "response": {
      "cols": [...],
      "rows": [...]
    }
  },
  "Features": {
    "source_http_request": {
      "method": "GET",
      "url": "https://www.manateepao.gov/wp-content/themes/frontier-child/models/pao-model-features.php",
      "multiValueQueryString": {
        "parid": ["1000000008"]
      }
    },
    "response": {
      "cols": [...],
      "rows": [...]
    }
  }
}
```

**Key observations from this real output:**

1. **Query parameter separation**: Notice how all GET requests have their query parameters in `multiValueQueryString` (not in the URL string). This makes it easy to reuse these request definitions in other processes.

2. **Mixed response types**:
   - `OwnersAndGeneralInformation` returns HTML (stored as a string)
   - All other requests (`Sales`, `Tax`, `Land`, `Buildings`, `Features`) return JSON with datatables format (automatically parsed)

3. **Individual source tracking**: Each request maintains its own `source_http_request` details, making it easy to trace which API call produced which data.

4. **Datatables format**: Most Manatee County endpoints return data in a consistent format with:
   - `cols`: Array of column definitions with title, type, and optional className
   - `rows`: Array of data rows matching the column definitions

## Usage Examples

### Example 1: Manatee County (Florida)

Manatee County requires multiple API calls to fetch complete property information:

**Flow file: `manatee-flow.json`**

```json
{
  "requests": [
    {
      "key": "OwnersAndGeneralInformation",
      "request": {
        "method": "POST",
        "url": "https://www.manateepao.gov/wp-content/themes/frontier-child/models/pao-model-owner.php",
        "headers": {
          "content-type": "application/x-www-form-urlencoded"
        },
        "body": "data=%7B%22parid%22%3A%22{{request_identifier}}%22%2C%22ownerType%22%3A%22%22%2C%22parcel_type%22%3A%22real_property%22%7D"
      }
    },
    {
      "key": "Sales",
      "request": {
        "method": "GET",
        "url": "https://www.manateepao.gov/wp-content/themes/frontier-child/models/pao-model-sales.php?parid={{request_identifier}}"
      }
    },
    {
      "key": "Tax",
      "request": {
        "method": "GET",
        "url": "https://www.manateepao.gov/wp-content/themes/frontier-child/models/pao-model-value-history.php?parid={{request_identifier}}"
      }
    },
    {
      "key": "Land",
      "request": {
        "method": "GET",
        "url": "https://www.manateepao.gov/wp-content/themes/frontier-child/models/pao-model-land.php?parid={{request_identifier}}"
      }
    },
    {
      "key": "Buildings",
      "request": {
        "method": "GET",
        "url": "https://www.manateepao.gov/wp-content/themes/frontier-child/models/pao-model-buildings.php?parid={{request_identifier}}"
      }
    },
    {
      "key": "Features",
      "request": {
        "method": "GET",
        "url": "https://www.manateepao.gov/wp-content/themes/frontier-child/models/pao-model-features.php?parid={{request_identifier}}"
      }
    }
  ]
}
```

**Command:**

```bash
elephant-cli prepare input.zip \
  --output-zip output.zip \
  --multi-request-flow-file manatee-flow.json
```

### Example 2: Simple API with JSON Responses

**Flow file: `simple-flow.json`**

```json
{
  "requests": [
    {
      "key": "PropertyInfo",
      "request": {
        "method": "POST",
        "url": "https://api.example.com/property/search",
        "headers": {
          "content-type": "application/json"
        },
        "json": {
          "parcelId": "{{request_identifier}}",
          "includeHistory": true
        }
      }
    },
    {
      "key": "TaxHistory",
      "request": {
        "method": "GET",
        "url": "https://api.example.com/tax/{{request_identifier}}/history"
      }
    }
  ]
}
```

**Command:**

```bash
elephant-cli prepare input.zip \
  --output-zip output.zip \
  --multi-request-flow-file simple-flow.json
```

## Validation Rules

The flow configuration is validated according to the following rules:

### General Rules

1. Flow must be a JSON object with a `requests` array
2. `requests` array must contain at least one request
3. Each request must have a unique `key`
4. Each request must have a `request` object

### HTTP Method Rules

1. Only GET, POST, PUT, and PATCH methods are allowed
2. GET requests **cannot** have:
   - `body` field
   - `json` field
   - `headers` field

### Content-Type Rules

1. Valid content-types:
   - `application/json`
   - `application/x-www-form-urlencoded`
   - `text/xml`
   - `null`

2. `content-type: application/json` requires:
   - `json` field (not `body`)

3. Non-JSON content-types require:
   - `body` field (not `json`)

4. Cannot have both `json` and `body` fields

### URL Rules

1. URL must start with `http://` or `https://`
2. URL must be a valid string

### Request Body Rules

1. POST/PUT/PATCH with `json`:
   - Requires `headers` with `content-type: application/json`

2. POST/PUT/PATCH with `body`:
   - Requires `headers` with non-JSON content-type

## Troubleshooting

### Common Errors

#### "Multi-request flow must have a 'requests' array"

**Cause**: Missing or invalid `requests` field

**Solution**: Ensure your flow file has a top-level `requests` array:
```json
{
  "requests": [...]
}
```

#### "Duplicate request key"

**Cause**: Two or more requests have the same `key` value

**Solution**: Ensure each request has a unique `key`:
```json
{
  "requests": [
    {"key": "Request1", ...},
    {"key": "Request2", ...}
  ]
}
```

#### "GET requests cannot have a body"

**Cause**: GET request has `body` or `json` field

**Solution**: Remove body fields from GET requests:
```json
{
  "key": "GetRequest",
  "request": {
    "method": "GET",
    "url": "https://example.com/api"
  }
}
```

#### "json body requires content-type: application/json"

**Cause**: Using `json` field without proper content-type header

**Solution**: Add correct content-type header:
```json
{
  "request": {
    "method": "POST",
    "url": "https://example.com/api",
    "headers": {
      "content-type": "application/json"
    },
    "json": {...}
  }
}
```

#### "HTTP error 404: Not Found"

**Cause**: The API endpoint doesn't exist or parcel ID is invalid

**Solution**:
1. Verify the URL is correct
2. Check that `{{request_identifier}}` is being replaced correctly
3. Test the API endpoint manually with a known valid parcel ID

#### "Network error: ..."

**Cause**: Connection issues, timeouts, or network problems

**Solution**:
1. Check your internet connection
2. Verify the API is accessible
3. Consider using a proxy if geo-restrictions apply

### Debugging Tips

1. **Test individual requests**: Extract one request and test it with curl:
   ```bash
   curl -X POST "https://example.com/api" \
     -H "Content-Type: application/json" \
     -d '{"parid":"583207459"}'
   ```

2. **Check template replacement**: Look at the output JSON to see the actual `source_http_request` used

3. **Validate JSON syntax**: Use a JSON validator to check your flow file before running

4. **Enable debug logging**: Set `LOG_LEVEL=debug` to see detailed request/response information:
   ```bash
   LOG_LEVEL=debug elephant-cli prepare input.zip \
     --output-zip output.zip \
     --multi-request-flow-file flow.json
   ```

### Getting Help

If you encounter issues not covered here:

1. Check the [main documentation](../README.md)
2. Review the [test examples](../tests/unit/lib/multi-request-flow/)
3. Open an issue on GitHub with:
   - Your flow configuration (sanitized)
   - Error messages
   - Expected vs actual behavior
