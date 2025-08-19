import { CID } from 'multiformats/cid';
import { sha256 } from 'multiformats/hashes/sha2';
import { base58btc } from 'multiformats/bases/base58';
import { base32 } from 'multiformats/bases/base32';
import * as dagPB from '@ipld/dag-pb';
import { UnixFS } from 'ipfs-unixfs';
import * as dagJSON from '@ipld/dag-json';
import * as raw from 'multiformats/codecs/raw';

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

  /**
   * Calculate CID v1 for DAG-JSON data
   * This is the proper format for IPLD linked data
   */
  async calculateCidV1ForDagJson(data: any): Promise<string> {
    try {
      // Encode as DAG-JSON
      const encoded = dagJSON.encode(data);

      // Calculate SHA-256 hash
      const hash = await sha256.digest(encoded);

      // Create CID v1 with DAG-JSON codec (0x0129)
      const cid = CID.create(1, 0x0129, hash);

      // Return base32 encoded string (standard for CID v1)
      return cid.toString(base32);
    } catch (error) {
      throw new Error(
        `Failed to calculate DAG-JSON CID: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Calculate IPFS CID v1 for the given data (UnixFS format)
   * CID v1 uses base32 encoding and dag-pb format with sha256 hash
   */
  async calculateCidV1(data: Buffer): Promise<string> {
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

      // Create CID v1 (0x70 is dag-pb codec)
      const cid = CID.create(1, 0x70, hash);

      // Return base32 string (standard for CID v1)
      return cid.toString(base32);
    } catch (error) {
      throw new Error(
        `Failed to calculate CID v1: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Calculate CID for data, automatically choosing the appropriate format
   * Uses DAG-JSON for data with IPLD links, UnixFS for everything else
   */
  async calculateCidAutoFormat(data: any): Promise<string> {
    // Check if data contains IPLD links
    if (this.hasIPLDLinks(data)) {
      // Use DAG-JSON format for IPLD linked data
      return this.calculateCidV1ForDagJson(data);
    } else {
      // Use UnixFS format for regular data
      const jsonString = JSON.stringify(data);
      const buffer = Buffer.from(jsonString, 'utf-8');
      return this.calculateCidV1(buffer);
    }
  }

  /**
   * Calculate CID from canonical JSON string
   * This ensures the CID is calculated from the exact canonical representation
   * Always uses raw codec for consistency
   */
  async calculateCidFromCanonicalJson(canonicalJson: string): Promise<string> {
    // Always use raw codec for all files to ensure consistency
    // The canonical JSON string is already the exact representation we want
    const buffer = Buffer.from(canonicalJson, 'utf-8');
    return this.calculateCidV1ForRawData(buffer);
  }

  /**
   * Check if data contains IPLD links
   */
  hasIPLDLinks(data: any): boolean {
    if (!data || typeof data !== 'object') {
      return false;
    }

    // Check if this is a link object
    if (
      Object.prototype.hasOwnProperty.call(data, '/') &&
      typeof data['/'] === 'string' &&
      Object.keys(data).length === 1
    ) {
      return true;
    }

    // Check arrays
    if (Array.isArray(data)) {
      return data.some((item) => this.hasIPLDLinks(item));
    }

    // Check object properties
    for (const key in data) {
      if (Object.prototype.hasOwnProperty.call(data, key)) {
        if (this.hasIPLDLinks(data[key])) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Calculate CID v1 for raw binary data (e.g., images)
   * Uses raw codec (0x55) instead of UnixFS
   */
  async calculateCidV1ForRawData(data: Buffer): Promise<string> {
    try {
      // Validate input
      if (!data || !Buffer.isBuffer(data)) {
        throw new Error('Invalid input: data must be a valid Buffer');
      }

      // Calculate SHA-256 hash of raw data
      const hash = await sha256.digest(data);

      // Create CID v1 with raw codec (0x55)
      const cid = CID.create(1, raw.code, hash);

      // Return base32 string (standard for CID v1)
      return cid.toString(base32);
    } catch (error) {
      throw new Error(
        `Failed to calculate raw CID v1: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Calculate CID for a directory structure containing multiple files
   * Uses DAG-PB format with UnixFS directory type
   * Returns a CID v1 in base32 encoding (starts with "bafybei...")
   */
  async calculateDirectoryCid(
    files: Array<{ name: string; content: Buffer }>
  ): Promise<string> {
    try {
      // Create UnixFS directory metadata
      const unixfsDir = new UnixFS({ type: 'directory' });

      // Calculate CIDs for each file and create links
      const links = [];
      for (const file of files) {
        // Calculate CID for this file
        const fileCid = await this.calculateCidV1ForRawData(file.content);

        // Parse the CID to get the multihash
        const parsedCid = CID.parse(fileCid);

        // Create a link for this file
        links.push({
          Name: file.name,
          Hash: parsedCid,
          Tsize: file.content.length,
        });
      }

      // Sort links by name bytes for deterministic CID (required by DAG-PB spec)
      links.sort((a, b) => {
        const aBytes = Buffer.from(a.Name, 'utf-8');
        const bBytes = Buffer.from(b.Name, 'utf-8');
        return Buffer.compare(aBytes, bBytes);
      });

      // Create DAG-PB node with directory data and links
      const dagPbNode = {
        Data: unixfsDir.marshal(),
        Links: links,
      };

      // Encode the DAG-PB node
      const encoded = dagPB.encode(dagPbNode);

      // Calculate SHA-256 hash
      const hash = await sha256.digest(encoded);

      // Create CID v1 with dag-pb codec (0x70)
      const cid = CID.create(1, 0x70, hash);

      // Return base32 string (standard for CID v1)
      return cid.toString(base32);
    } catch (error) {
      throw new Error(
        `Failed to calculate directory CID: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}
