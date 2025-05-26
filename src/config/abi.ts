export const ELEPHANT_CONTRACT_ABI = [
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
