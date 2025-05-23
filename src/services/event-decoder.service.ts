import { ethers } from 'ethers';
import { ElephantAssignment } from '../types';

export class EventDecoderService {
  constructor() {}

  decodePropertyCid(bytes: string): string {
    // Decode the dynamic string from event data
    const abiCoder = ethers.AbiCoder.defaultAbiCoder();
    const decoded = abiCoder.decode(['string'], bytes)[0];

    // Remove the leading dot if present
    const cid = decoded.startsWith('.') ? decoded.substring(1) : decoded;

    // Basic CID validation - check if it starts with Qm (CIDv0) or ba (CIDv1)
    if (!cid.startsWith('Qm') && !cid.startsWith('ba')) {
      throw new Error(`Invalid CID format: ${cid}`);
    }

    return cid;
  }

  parseElephantAssignedEvent(event: ethers.Log): ElephantAssignment {
    const cid = this.decodePropertyCid(event.data);

    return {
      cid,
      elephant: event.topics[1]
        ? ethers.getAddress(ethers.dataSlice(event.topics[1], 12))
        : '',
      blockNumber: event.blockNumber,
      transactionHash: event.transactionHash,
    };
  }
}
