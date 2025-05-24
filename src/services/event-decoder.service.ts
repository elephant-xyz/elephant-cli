import { AbiCoder, getAddress, dataSlice } from 'ethers';
import { ElephantAssignment, Event } from '../types';
import { isValidCID } from '../utils/validation';

export class EventDecoderService {
  private abiCoder: AbiCoder;

  constructor() {
    this.abiCoder = AbiCoder.defaultAbiCoder();
  }

  public decodePropertyCid(bytes: string): string {
    // Decode the dynamic string from event data
    const decoded = this.abiCoder.decode(['string'], bytes)[0];

    // Remove the leading dot if present
    const cid = decoded.startsWith('.') ? decoded.substring(1) : decoded;

    if (!isValidCID(cid)) {
      throw new Error(`Invalid CID format: ${cid}`);
    }
    return cid;
  }

  public parseElephantAssignedEvent(event: Event): ElephantAssignment {
    const propertyCid = this.decodePropertyCid(event.data);
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
}
