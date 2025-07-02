# IPLD Array Sorting in Canonicalization

## Overview

The Elephant CLI now includes IPLD-aware array sorting during the canonicalization process. When JSON data contains arrays with IPLD links (objects with a single "/" key pointing to a CID), these arrays are automatically sorted by CID value during canonicalization. This ensures consistent, deterministic output regardless of the original order of links.

## Why IPLD Array Sorting?

1. **Deterministic CIDs**: Sorting arrays of IPLD links ensures that the same logical data always produces the same CID, regardless of the order in which links were added.

2. **Consistency**: When multiple sources generate the same set of links, sorting ensures they produce identical canonical representations.

3. **Compatibility**: The sorting happens after IPLD file path resolution, so it works with both direct CID references and file paths that get converted to CIDs.

## How It Works

The `IPLDCanonicalizerService` extends the standard JSON canonicalizer with IPLD-aware sorting:

1. **Detection**: Arrays are scanned for IPLD link objects (format: `{"/": "CID"}`)
2. **Sorting**: If IPLD links are found, the array is sorted by CID values
3. **Mixed Arrays**: IPLD links are sorted first, followed by non-link items in their original relative order
4. **Recursion**: The sorting is applied recursively to nested structures

## Examples

### Simple IPLD Link Array

**Input:**
```json
{
  "links": [
    {"/": "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi"},
    {"/": "bafybeibazaarhe5qpbgvfwqnteba5hbgzvqcajqgfgxnhpdvfnqweabk4u"},
    {"/": "bafybeifx7yeb55armcsxwwitkymga5xf53dxiarykms3ygqic223w5sk3m"}
  ]
}
```

**Canonical Output:**
```json
{
  "links": [
    {"/": "bafybeibazaarhe5qpbgvfwqnteba5hbgzvqcajqgfgxnhpdvfnqweabk4u"},
    {"/": "bafybeifx7yeb55armcsxwwitkymga5xf53dxiarykms3ygqic223w5sk3m"},
    {"/": "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi"}
  ]
}
```

### Mixed Array

**Input:**
```json
{
  "mixed": [
    {"/": "QmZ4tDuvesekSs4qM5ZBKpXiZGun7S2CYtEZRB3DYXkjGx"},
    "regular string",
    {"/": "QmPZ9gcCEpqKTo6aq61g2nXGUhM4iCL3ewB6LDXZCtioEB"},
    42,
    {"not": "ipld"}
  ]
}
```

**Canonical Output:**
```json
{
  "mixed": [
    {"/": "QmPZ9gcCEpqKTo6aq61g2nXGUhM4iCL3ewB6LDXZCtioEB"},
    {"/": "QmZ4tDuvesekSs4qM5ZBKpXiZGun7S2CYtEZRB3DYXkjGx"},
    "regular string",
    42,
    {"not": "ipld"}
  ]
}
```

### With File Path Resolution

When using IPLD file path links that get converted to CIDs:

**Original Input:**
```json
{
  "references": [
    {"/": "./metadata.json"},
    {"/": "./config.json"}
  ]
}
```

**After IPLD Conversion (before canonicalization):**
```json
{
  "references": [
    {"/": "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi"},
    {"/": "bafybeibazaarhe5qpbgvfwqnteba5hbgzvqcajqgfgxnhpdvfnqweabk4u"}
  ]
}
```

**Final Canonical Output:**
```json
{
  "references": [
    {"/": "bafybeibazaarhe5qpbgvfwqnteba5hbgzvqcajqgfgxnhpdvfnqweabk4u"},
    {"/": "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi"}
  ]
}
```

## Important Notes

1. **Not IPLD Links**: Objects with additional properties besides "/" are not considered IPLD links:
   ```json
   {"/": "CID", "extra": "property"}  // Not sorted as IPLD link
   ```

2. **Nested Structures**: Sorting is applied recursively through the entire data structure

3. **RFC 8785 Compliance**: The sorting is applied before standard canonicalization, maintaining compliance with RFC 8785

4. **Performance**: The sorting adds minimal overhead and only affects arrays containing IPLD links

## Integration with Workflow

The IPLD array sorting is automatically applied during the `validate-and-upload` command:

1. Files are validated against schemas
2. IPLD file paths are converted to CIDs (if present)
3. **Arrays with IPLD links are sorted** ← New step
4. Data is canonicalized according to RFC 8785
5. CID is calculated from the canonical form
6. Data is uploaded to IPFS

This ensures that the final CIDs are deterministic and consistent, regardless of the original order of IPLD links in the source data.