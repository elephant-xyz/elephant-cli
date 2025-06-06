import { CID } from 'multiformats/cid';
import { sha256 } from 'multiformats/hashes/sha2';
import { base58btc } from 'multiformats/bases/base58';
import * as dagPB from '@ipld/dag-pb';
import { UnixFS } from 'ipfs-unixfs';

export class CidCalculatorService {
  constructor() {}

  /**
   * Calculate IPFS CID v0 for the given data
   * CID v0 uses base58btc encoding and dag-pb format with sha256 hash
   * Uses simple raw data approach to match Pinata's CID calculation
   */
  async calculateCidV0(data: Buffer): Promise<string> {
    try {
      // Validate input
      if (!data || !Buffer.isBuffer(data)) {
        throw new Error('Invalid input: data must be a valid Buffer');
      }

      // Create UnixFS file metadata (this is what IPFS/Pinata does)
      const unixfs = new UnixFS({ type: 'file', data: new Uint8Array(data) });

      // Create DAG-PB node with UnixFS data
      const dagPbNode = { Data: unixfs.marshal(), Links: [] };

      // Encode the DAG-PB node
      const encoded = dagPB.encode(dagPbNode);

      // Calculate SHA-256 hash
      const hash = await sha256.digest(encoded);

      // Create CID v0 (0x70 is dag-pb codec)
      const cid = CID.create(0, 0x70, hash);

      // Return base58btc string (Qm...)
      return cid.toString(base58btc);
    } catch (error) {
      throw new Error(
        `Failed to calculate CID v0: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Calculate CIDs for multiple buffers in batch
   */
  async calculateBatch(dataArray: Buffer[]): Promise<string[]> {
    const promises = dataArray.map((data) => this.calculateCidV0(data));
    return Promise.all(promises);
  }

  /**
   * Convert string to Buffer using UTF-8 encoding
   */
  stringToBuffer(input: string): Buffer {
    return Buffer.from(input, 'utf-8');
  }

  /**
   * Helper method to calculate CID from a JSON object
   * Converts the object to canonical JSON string first
   */
  async calculateCidFromJson(json: unknown): Promise<string> {
    const jsonString = JSON.stringify(json);
    const buffer = this.stringToBuffer(jsonString);
    return this.calculateCidV0(buffer);
  }
}
