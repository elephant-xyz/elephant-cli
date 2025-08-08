import { AbiCoder, getAddress, dataSlice, Log } from 'ethers';
import { OracleAssignment, DataSubmittedEvent } from '../types/index.js';
import { isValidCID, deriveCIDFromHash } from '../utils/validation.js';
import { logger } from '../utils/logger.js';

export class EventDecoderService {
  private abiCoder: AbiCoder;

  constructor() {
    this.abiCoder = AbiCoder.defaultAbiCoder();
  }

  public decodePropertyHash(bytes: string): string {
    // Decode the bytes32 hash from event data
    const decoded = this.abiCoder.decode(['bytes32'], bytes)[0];

    // Derive CID v0 from the hash
    const cid = deriveCIDFromHash(decoded);

    if (!isValidCID(cid)) {
      throw new Error(`Invalid CID format: ${cid}`);
    }
    return cid;
  }

  public parseOracleAssignedEvent(event: Log): OracleAssignment {
    const propertyCid = this.decodePropertyHash(event.data);
    let elephantAddress = '';

    // Assuming elephant address is always the second topic (index 1) if present
    // and is a full 32-byte address (hence dataSlice from byte 12 of the 32-byte topic)
    if (event.topics && event.topics.length > 1 && event.topics[1]) {
      // topics[0] is the event signature
      // topics[1] is the first indexed argument, `elephant`
      // Indexed addresses are stored as 32-byte values; getAddress expects a 20-byte address.
      // We need to get the last 20 bytes (40 hex characters) of the topic.
      // A common way is to slice the hex string.
      // topics[1] is '0x' + 64 hex chars. Address is last 40 hex chars.
      // So, '0x' + (24 leading zeros) + (40 address chars).
      // Slice from 2 + 24 = 26th char, or use dataSlice(event.topics[1], 12) if topic is 0x-prefixed.
      const addressFromTopic = dataSlice(event.topics[1], 12); // Skips the first 12 bytes (24 hex chars) of the 32-byte topic
      elephantAddress = getAddress(addressFromTopic); // Normalizes the address
    }

    return {
      cid: propertyCid,
      elephant: elephantAddress,
      blockNumber: event.blockNumber,
      transactionHash: event.transactionHash,
    };
  }

  public parseDataSubmittedEvent(event: Log): DataSubmittedEvent | null {
    try {
      // DataSubmitted event structure:
      // event DataSubmitted(
      //   bytes32 indexed propertyHash,
      //   bytes32 indexed dataGroupHash,
      //   address indexed submitter,
      //   bytes32 dataHash
      // );

      // Validate we have the expected number of topics
      if (!event.topics || event.topics.length !== 4) {
        logger.error(
          `Invalid DataSubmitted event: expected 4 topics, got ${event.topics?.length}`
        );
        return null;
      }

      // topics[0] is the event signature
      // topics[1] is propertyHash (bytes32)
      // topics[2] is dataGroupHash (bytes32)
      // topics[3] is submitter (address)

      const propertyHash = event.topics[1];
      const dataGroupHash = event.topics[2];

      // Extract address from topic (last 20 bytes of 32-byte topic)
      const submitterAddress = dataSlice(event.topics[3], 12);
      const submitter = getAddress(submitterAddress).toLowerCase();

      // Decode non-indexed data (dataHash)
      const [dataHash] = this.abiCoder.decode(['bytes32'], event.data);

      return {
        propertyHash,
        dataGroupHash,
        submitter,
        dataHash,
        blockNumber: event.blockNumber,
        transactionHash: event.transactionHash,
      };
    } catch (error) {
      logger.error(`Error parsing DataSubmitted event: ${error}`);
      return null;
    }
  }
}
