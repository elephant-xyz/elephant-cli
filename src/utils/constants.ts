// Default ABI for the OracleAssigned event
// This is a minimal ABI just for the event we are interested in.
// A more complete ABI might be loaded from a file if specified by the user.
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
