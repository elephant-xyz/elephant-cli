Act as a senior software engineer. Get aknowledged with a code base. You have been tasked with a new feature for this CLI tool.  
You need to add new command to submit the files.
This command should accept directory to the JSON files.
Directory should contain directories, whos names are properties CIDs and files are data group CIDs.
Those data group CIDs will point to the JSON schemas, saved on the IPFS.

The tool should do next:

1. Traverse the files to ensure valid file structure
2. For each file:
   1. Download the json schema from IPFS, using data group CID (make sure to use cache here, as those CIDs will be basically the same for all files)
   2. Parse the input JSON
   3. Validate this JSON accoring to the specified JSON schema
   4. If file is invalid store property CID, data group CID and error message to save to the errors.csv
   5. If file is valid JSON serialize it using rfc8785 (JSON Canonicalization Scheme (JCS)) compatable serializer
   6. Calculate what would be v0 CID of this file
   7. Get curently relevant data CID for this property - data group CID using this method of a smart contract
   ```json
   {
     "inputs": [
       {
         "internalType": "bytes",
         "name": "propertyCid",
         "type": "bytes"
       },
       {
         "internalType": "bytes",
         "name": "dataGroupCID",
         "type": "bytes"
       }
     ],
     "name": "getCurrentFieldDataCID",
     "outputs": [
       {
         "internalType": "bytes",
         "name": "",
         "type": "bytes"
       }
     ],
     "stateMutability": "view",
     "type": "function"
   }
   ```
   8. If CID v0 for the current file would be the same, as the one, that is retreived from the smart contract, then skip this file and save the skip and the reason to the warnings.csv
   9. Use this function of a smart contract to get list of addresses, who already submtitted this data:
   ```json
   {
     "inputs": [
       {
         "internalType": "bytes",
         "name": "propertyCid",
         "type": "bytes"
       },
       {
         "internalType": "bytes",
         "name": "dataGroupCID",
         "type": "bytes"
       },
       {
         "internalType": "bytes",
         "name": "dataCID",
         "type": "bytes"
       }
     ],
     "name": "getParticipantsForConsensusDataCID",
     "outputs": [
       {
         "internalType": "address[]",
         "name": "",
         "type": "address[]"
       }
     ],
     "stateMutability": "view",
     "type": "function"
   }
   ```
   10. If currently used address is in the list of already submitted, then skip this data file and save it to the warnings.csv
   11. Upload file to IPFS and pin it using Pinata SDK
   12. For the uploaded files construct transaction, that will use this method of a smart contract:
   ```json
   {
     "inputs": [
       {
         "components": [
           {
             "internalType": "bytes",
             "name": "propertyCid",
             "type": "bytes"
           },
           {
             "internalType": "bytes",
             "name": "dataGroupCID",
             "type": "bytes"
           },
           {
             "internalType": "bytes",
             "name": "dataCID",
             "type": "bytes"
           }
         ],
         "internalType": "struct IPropertyDataConsensus.DataItem[]",
         "name": "items",
         "type": "tuple[]"
       }
     ],
     "name": "submitBatchData",
     "outputs": [],
     "stateMutability": "nonpayable",
     "type": "function"
   }
   ```
   11. Make sure to split transactions to submit 200 items in each.

Implementatoin context:

- To convert CID from bytes and to bytes use this approach:

```typescript
const encoded = ethers.hexlify(ethers.toUtf8Bytes(input));
const decoded = ethers.toUtf8String(input);
```

- Make sure to take advantage of paralization, where possible
- Private key should be passed as environment variable
- Where async/await would not give enough paralization, use multiprocessing, like json schema validation and json serialization
- This CLI should be ready to submit millions of files in a single invocation
- There should be a progress bar with estimated time to finish
- review current architecture in the architecture.md file and other kwnloadge sources

Give me the full architecture required to implement this feature:

- File + folder structure
- What each part does
- Where state lives, how services connect
  Format this entire document in markdown.
  Save it to the submit_data_architecture.md

Ultrathink about this one
