export const DEFAULT_CONTRACT_ADDRESS =
  '0x79D5046e34D4A56D357E12636A18da6eaEfe0586';
export const DEFAULT_RPC_URL = 'https://polygon-rpc.com';
export const DEFAULT_IPFS_GATEWAY = 'https://ipfs.io/ipfs/';
export const MAX_CONCURRENT_DOWNLOADS = 25;
export const BLOCKS_PER_QUERY = 10000;

// Submit command specific constants
export const SUBMIT_CONTRACT_METHODS = {
  GET_CURRENT_FIELD_DATA_CID: 'getCurrentFieldDataCID',
  GET_PARTICIPANTS_FOR_CONSENSUS_DATA_CID: 'getParticipantsForConsensusDataCID',
  HAS_USER_SUBMITTED_DATA_CID: 'hasUserSubmittedDataCID',
  SUBMIT_BATCH_DATA: 'submitBatchData',
} as const;

// Pinata configuration
export const PINATA_API_BASE_URL = 'https://api.pinata.cloud';
export const PINATA_GATEWAY_BASE_URL = 'https://gateway.pinata.cloud/ipfs/';

// Smart contract method ABIs for submit functionality
export const SUBMIT_CONTRACT_ABI_FRAGMENTS = [
  {
    inputs: [
      { internalType: 'bytes', name: 'propertyCid', type: 'bytes' },
      { internalType: 'bytes', name: 'dataGroupCID', type: 'bytes' },
    ],
    name: 'getCurrentFieldDataCID',
    outputs: [{ internalType: 'bytes', name: '', type: 'bytes' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'bytes', name: 'propertyCid', type: 'bytes' },
      { internalType: 'bytes', name: 'dataGroupCID', type: 'bytes' },
      { internalType: 'bytes', name: 'dataCID', type: 'bytes' },
    ],
    name: 'getParticipantsForConsensusDataCID',
    outputs: [{ internalType: 'address[]', name: '', type: 'address[]' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'bytes', name: 'propertyCid', type: 'bytes' },
      { internalType: 'bytes', name: 'dataGroupCID', type: 'bytes' },
      { internalType: 'bytes', name: 'dataCID', type: 'bytes' },
      { internalType: 'address', name: 'submitter', type: 'address' },
    ],
    name: 'hasUserSubmittedDataCID',
    outputs: [{ internalType: 'bool', name: '', type: 'bool' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      {
        components: [
          { internalType: 'bytes', name: 'propertyCid', type: 'bytes' },
          { internalType: 'bytes', name: 'dataGroupCID', type: 'bytes' },
          { internalType: 'bytes', name: 'dataCID', type: 'bytes' },
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
] as const;
