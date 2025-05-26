// Default ABI for the ElephantAssigned event
// This is a minimal ABI just for the event we are interested in.
// A more complete ABI might be loaded from a file if specified by the user.
export const DEFAULT_CONTRACT_ABI = [
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: 'bytes',
        name: 'propertyCid',
        type: 'bytes',
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
