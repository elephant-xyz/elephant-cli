// Default ABI for the OracleAssigned event
export const DEFAULT_CONTRACT_ABI = [
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: 'bytes32',
        name: 'propertyHash',
        type: 'bytes32',
      },
      {
        indexed: true,
        internalType: 'address',
        name: 'elephant',
        type: 'address',
      },
    ],
    name: 'OracleAssigned',
    type: 'event',
  },
];

export const DEFAULT_BLOCK_RANGE = 2000;
export const BLOCKS_PER_DAY = 42_200;
export const DEFAULT_FROM_BLOCK = 72310501;
