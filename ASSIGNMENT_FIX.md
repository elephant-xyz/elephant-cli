# Assignment Filtering Fix

## Issues Fixed

### 1. ✅ **Logic Bug**: Files were being processed despite no assignments
**Problem**: When 0 assignments found, files were still being uploaded and transactions attempted.

**Root Cause**: Original condition `if (assignedCids.size > 0 && !assignedCids.has(...))` meant when `assignedCids.size === 0`, the condition was false and files were NOT skipped.

**Fix**: Added `assignmentFilteringEnabled` flag to distinguish between:
- Assignment fetching succeeded (apply filtering based on results)
- Assignment fetching failed (no filtering applied)

### 2. ✅ **Wrong Field**: Checking dataGroupCid instead of propertyCid
**Problem**: Assignment filtering was checking `dataGroupCid` (file schema) instead of `propertyCid` (directory name).

**Root Cause**: Misunderstanding of which field represents the assigned CID.

**Fix**: Changed from `fileEntry.dataGroupCid` to `fileEntry.propertyCid`.

## Current Behavior

### Directory Structure
```
data/
├── QmPropertyCid1/          <- This is propertyCid (checked against assignments)
│   ├── QmDataGroupCid1.json <- This is dataGroupCid (schema CID)
│   └── QmDataGroupCid2.json
└── QmPropertyCid2/          <- This is propertyCid (checked against assignments)
    └── QmDataGroupCid3.json <- This is dataGroupCid (schema CID)
```

### Assignment Checking Logic
```typescript
// Check if directory name (propertyCid) is in assigned CIDs
if (assignmentFilteringEnabled && !assignedCids.has(fileEntry.propertyCid)) {
  // Skip this file - its directory is not assigned to user
}
```

### Scenarios

**Scenario 1: No assignments found**
```
✅ Found 0 assigned CIDs for your address
⚠️  No CIDs assigned to your address. All directories will be skipped.
```
→ **ALL files skipped** ✅

**Scenario 2: Some assignments found**
```
✅ Found 3 assigned CIDs for your address
```
→ **Only files in assigned directories processed** ✅

**Scenario 3: Assignment fetching fails**
```
⚠️  Could not fetch assignments - proceeding without assignment filtering
```
→ **All files processed normally** ✅

## Warning Messages
```csv
propertyCid,dataGroupCid,filePath,reason,timestamp
QmPropertyCid1,QmDataGroupCid1,/path/file.json,"File skipped - propertyCid QmPropertyCid1 is not assigned to your address",2024-01-01T00:00:00.000Z
```