# IPLD Link Support in Elephant CLI

## Overview

The Elephant CLI now supports IPLD (InterPlanetary Linked Data) links in JSON files. This allows you to reference external files using the IPLD link format `{"/": "path/to/file"}`, which will be automatically converted to IPFS CIDs during the upload process.

## CID Version Support

The CLI now uses CID v1 by default for all uploads. CID v1 provides better future-proofing and is the recommended format for IPLD compliance. The CIDs will be in base32 encoding (starting with 'bafy...' for UnixFS content).

## How It Works

1. **File Path Links**: When your JSON data contains objects in the format `{"/": "path/to/file"}`, the CLI recognizes these as file path links.

2. **Automatic Conversion**: During the validation and upload process:
   - The referenced file is read from the filesystem
   - The file is uploaded to IPFS separately
   - The file path is replaced with the resulting IPFS CID
   - The main document is then uploaded with all links properly resolved

3. **IPLD Compliance**: The resulting structure follows the IPLD DAG-JSON specification, where links are represented as `{"/": "CID"}`.

## Supported Path Types

### Relative Paths
- `{"/": "./data.json"}` - relative to the input directory
- `{"/": "subfolder/data.json"}` - relative path without ./
- `{"/": "../sibling/data.json"}` - parent directory access

### Absolute Paths
- `{"/": "/absolute/path/to/file.json"}` - full system path

### Existing CIDs
- `{"/": "QmYjtig7VJQ6XsnUjqqJvj7QaMcCAwtrgNdahSiFofrE7o"}` - CID v0, preserved as-is
- `{"/": "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi"}` - CID v1, preserved as-is

## Example

### Input JSON
```json
{
  "title": "Document with Links",
  "metadata": {
    "/": "./metadata.json"
  },
  "references": [
    {
      "name": "License",
      "link": {"/": "license.json"}
    },
    {
      "name": "External Doc", 
      "link": {"/": "/shared/docs/external.json"}
    }
  ]
}
```

### After Processing
```json
{
  "title": "Document with Links",
  "metadata": {
    "/": "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi"
  },
  "references": [
    {
      "name": "License",
      "link": {"/": "bafybeihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku"}
    },
    {
      "name": "External Doc",
      "link": {"/": "bafybeigvgzoolc3drupxhlevdp2ugqcrbcsqfmcek2zxiw5wctk3xjpjwy"}
    }
  ]
}
```

## Important Notes

1. **File Location**: Referenced files must be accessible from the filesystem at the time of processing.

2. **Directory Structure**: The main JSON files still need to follow the Elephant Network structure (property CID directories containing schema CID named files).

3. **Validation**: The content of linked files is also uploaded and must be valid JSON (or will be treated as text).

4. **Deduplication**: If multiple links reference the same file, they will all point to the same CID after upload.

## Use Cases

1. **Modular Data**: Split large documents into smaller, reusable components
2. **Shared References**: Multiple documents can link to common resources
3. **External Data**: Reference data stored outside the main directory structure
4. **Dynamic Linking**: Build complex linked data structures that resolve at upload time

## Technical Implementation

The IPLD conversion is handled by the `IPLDConverterService` which:
- Detects link patterns in JSON data
- Resolves file paths (relative or absolute)
- Uploads referenced files to IPFS via Pinata
- Replaces paths with CIDs
- Maintains the IPLD DAG-JSON format

This feature makes it easier to work with linked data while maintaining compatibility with IPFS and IPLD standards.