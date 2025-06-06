export const DEFAULT_CONTRACT_ADDRESS =
  '0xD28285598597a5a213AebD116E9A093Ed44b127e';
export const DEFAULT_RPC_URL = 'https://polygon-rpc.com';
export const DEFAULT_IPFS_GATEWAY = 'https://ipfs.io/ipfs/';
export const MAX_CONCURRENT_DOWNLOADS = 25;
export const BLOCKS_PER_QUERY = 10000;

// Submit command specific constants
export const SUBMIT_CONTRACT_METHODS = {
  GET_CURRENT_FIELD_DATA_HASH: 'getCurrentFieldDataHash',
  GET_PARTICIPANTS_FOR_CONSENSUS_DATA_HASH:
    'getParticipantsForConsensusDataHash',
  HAS_USER_SUBMITTED_DATA_HASH: 'hasUserSubmittedDataHash',
  SUBMIT_BATCH_DATA: 'submitBatchData',
} as const;

// Pinata configuration
export const PINATA_API_BASE_URL = 'https://api.pinata.cloud';
export const PINATA_GATEWAY_BASE_URL = 'https://gateway.pinata.cloud/ipfs/';

// Smart contract method ABIs for submit functionality
export const SUBMIT_CONTRACT_ABI_FRAGMENTS = [
  {
    inputs: [
      { internalType: 'bytes32', name: 'propertyHash', type: 'bytes32' },
      { internalType: 'bytes32', name: 'dataGroupHash', type: 'bytes32' },
    ],
    name: 'getCurrentFieldDataHash',
    outputs: [{ internalType: 'bytes32', name: '', type: 'bytes32' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'bytes32', name: 'propertyHash', type: 'bytes32' },
      { internalType: 'bytes32', name: 'dataGroupHash', type: 'bytes32' },
      { internalType: 'bytes32', name: 'dataHash', type: 'bytes32' },
    ],
    name: 'getParticipantsForConsensusDataHash',
    outputs: [{ internalType: 'address[]', name: '', type: 'address[]' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'bytes32', name: 'propertyHash', type: 'bytes32' },
      { internalType: 'bytes32', name: 'dataGroupHash', type: 'bytes32' },
      { internalType: 'bytes32', name: 'dataHash', type: 'bytes32' },
      { internalType: 'address', name: 'submitter', type: 'address' },
    ],
    name: 'hasUserSubmittedDataHash',
    outputs: [{ internalType: 'bool', name: '', type: 'bool' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      {
        components: [
          { internalType: 'bytes32', name: 'propertyHash', type: 'bytes32' },
          { internalType: 'bytes32', name: 'dataGroupHash', type: 'bytes32' },
          { internalType: 'bytes32', name: 'dataHash', type: 'bytes32' },
        ],
        internalType: 'struct IPropertyDataConsensus.DataItem[]',
        name: 'items',
        type: 'tuple[]',
      },
    ],
    name: 'submitBatchData',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "propertyHash",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "dataGroupHash",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "submitter",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "bytes32",
        "name": "dataHash",
        "type": "bytes32"
      }
    ],
    "name": "DataSubmitted",
    "type": "event"
  }
] as const;
