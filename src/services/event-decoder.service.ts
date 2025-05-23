import { ethers } from "ethers";
import { Assignment } from "../types";

export class EventDecoderService {
  constructor() {}

  decodePropertyCid(bytes: string): string {
    const decoded = ethers.toUtf8String(bytes);
    
    // Basic CID validation - check if it starts with Qm (CIDv0) or ba (CIDv1)
    if (!decoded.startsWith("Qm") && !decoded.startsWith("ba")) {
      throw new Error(`Invalid CID format: ${decoded}`);
    }
    
    return decoded;
  }

  parseOracleAssignedEvent(event: ethers.Log): Assignment {
    const cid = this.decodePropertyCid(event.data);
    
    return {
      cid,
      oracle: event.topics[1] ? ethers.getAddress(ethers.dataSlice(event.topics[1], 12)) : "",
      blockNumber: event.blockNumber,
      transactionHash: event.transactionHash
    };
  }
}