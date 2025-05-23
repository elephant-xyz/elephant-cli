export const ORACLE_CONTRACT_ABI = [
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "bytes",
        name: "propertyCid",
        type: "bytes"
      },
      {
        indexed: true,
        internalType: "address",
        name: "oracle",
        type: "address"
      }
    ],
    name: "OracleAssigned",
    type: "event"
  }
];