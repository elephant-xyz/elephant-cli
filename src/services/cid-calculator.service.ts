import { CID } from 'multiformats/cid';
import { sha256 } from 'multiformats/hashes/sha2';
import { base58btc } from 'multiformats/bases/base58';

export class CidCalculatorService {
  constructor() {}

  /**
   * Calculate IPFS CID v0 for the given data
   * CID v0 uses base58btc encoding and dag-pb format with sha256 hash
   */
  async calculateCidV0(data: Buffer): Promise<string> {
    try {
      // For CID v0, we need to create a proper UnixFS wrapper
      // This is a simplified version - full implementation would use ipfs-unixfs

      // Create UnixFS protobuf for file
      const unixfsData = this.encodeUnixFsFile(data);

      // Create DAG-PB wrapper
      const dagPbNode = this.encodeDagPbNode(unixfsData);

      // Calculate SHA-256 hash
      const hash = await sha256.digest(dagPbNode);

      // Create CID v0 (code 0x70 is dag-pb)
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
   * Encode UnixFS file protobuf
   */
  private encodeUnixFsFile(data: Buffer): Uint8Array {
    const chunks: Uint8Array[] = [];

    // Field 1: Type = 2 (File)
    chunks.push(new Uint8Array([0x08, 0x02])); // field 1, varint 2

    // Field 2: Data (the file content)
    if (data.length > 0) {
      chunks.push(new Uint8Array([0x12])); // field 2, length-delimited
      chunks.push(this.encodeVarint(data.length));
      chunks.push(new Uint8Array(data));
    }

    // Field 3: filesize
    chunks.push(new Uint8Array([0x18])); // field 3, varint
    chunks.push(this.encodeVarint(data.length));

    // Combine all chunks
    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;

    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }

    return result;
  }

  /**
   * Encode DAG-PB node
   */
  private encodeDagPbNode(data: Uint8Array): Uint8Array {
    const chunks: Uint8Array[] = [];

    // Field 1: Data
    if (data.length > 0) {
      chunks.push(new Uint8Array([0x0a])); // field 1, length-delimited
      chunks.push(this.encodeVarint(data.length));
      chunks.push(data);
    }

    // Field 2: Links (empty for simple files)
    // Skip if no links

    // Combine all chunks
    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;

    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }

    return result;
  }

  /**
   * Encode a number as a protobuf varint
   */
  private encodeVarint(num: number): Uint8Array {
    const bytes: number[] = [];
    while (num > 0x7f) {
      bytes.push((num & 0x7f) | 0x80);
      num >>>= 7;
    }
    bytes.push(num);
    return new Uint8Array(bytes);
  }

  /**
   * Helper method to calculate CID from a JSON object
   * Converts the object to canonical JSON string first
   */
  async calculateCidFromJson(json: any): Promise<string> {
    const jsonString = JSON.stringify(json);
    const buffer = this.stringToBuffer(jsonString);
    return this.calculateCidV0(buffer);
  }
}
