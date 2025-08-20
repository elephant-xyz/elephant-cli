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
   *
   * When directoryName is provided, this exactly mimics Pinata's directory upload:
   * - Creates a root directory with the given name
   * - All files are placed directly in this directory
   * - The CID returned is for the root that contains this named directory
   */
  async calculateDirectoryCid(
    files: Array<{ name: string; content: Buffer }>,
    directoryName?: string
  ): Promise<string> {
    try {
      // If a directory name is provided, we need to match Pinata's exact structure
      // Pinata creates: root -> directoryName -> files
      // And returns the CID of the root
      if (directoryName) {
        // First, create the inner directory with all the files
        const innerDirNode = await this.createDirectoryDagPbNode(files);

        // Encode the inner directory
        const innerEncoded = dagPB.encode(innerDirNode);

        // Calculate the hash for the inner directory
        const innerHash = await sha256.digest(innerEncoded);
        const innerCid = CID.create(1, 0x70, innerHash);

        // Calculate the total size of the inner directory
        // This is the encoded size plus all the file sizes
        let innerTotalSize = innerEncoded.length;
        for (const link of innerDirNode.Links) {
          innerTotalSize += link.Tsize;
        }

        // Create the root directory that contains our named directory
        const rootDir = new UnixFS({ type: 'directory' });

        // The root has a single link to our named directory
        const rootLinks = [
          {
            Name: directoryName,
            Hash: innerCid,
            Tsize: innerTotalSize,
          },
        ];

        // Create DAG-PB node for the root
        const rootNode = {
          Data: rootDir.marshal(),
          Links: rootLinks,
        };

        // Encode and hash the root
        const rootEncoded = dagPB.encode(rootNode);
        const rootHash = await sha256.digest(rootEncoded);

        // Create CID v1 for the root
        const rootCid = CID.create(1, 0x70, rootHash);

        // Debug logging for directory structure
        if (process.env.DEBUG_CID_CALC) {
          console.log(`\nDirectory structure:`);
          console.log(`  Inner directory CID: ${innerCid.toString(base32)}`);
          console.log(`  Inner directory Tsize: ${innerTotalSize}`);
          console.log(`  Directory name: ${directoryName}`);
          console.log(`  Root CID: ${rootCid.toString(base32)}`);
        }

        // Return the root CID in base32
        return rootCid.toString(base32);
      } else {
        // No wrapper directory, use flat structure
        return this.calculateDirectoryCidFlat(files);
      }
    } catch (error) {
      throw new Error(
        `Failed to calculate directory CID: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Calculate CID for a flat directory structure (no wrapper)
   * Internal helper method
   */
  private async calculateDirectoryCidFlat(
    files: Array<{ name: string; content: Buffer }>
  ): Promise<string> {
    const dagPbNode = await this.createDirectoryDagPbNode(files);

    // Encode the DAG-PB node
    const encoded = dagPB.encode(dagPbNode);

    // Calculate SHA-256 hash
    const hash = await sha256.digest(encoded);

    // Create CID v1 with dag-pb codec (0x70)
    const cid = CID.create(1, 0x70, hash);

    // Return base32 string (standard for CID v1)
    return cid.toString(base32);
  }

  /**
   * Create a DAG-PB node for a directory with files
   * Internal helper method that exactly matches IPFS/Pinata's approach
   */
  private async createDirectoryDagPbNode(
    files: Array<{ name: string; content: Buffer }>
  ): Promise<any> {
    // Create UnixFS directory metadata
    const unixfsDir = new UnixFS({ type: 'directory' });

    // Calculate CIDs for each file and create links
    const links = [];
    for (const file of files) {
      // For files in a directory, use UnixFS format
      // This is the standard IPFS approach
      const unixfsFile = new UnixFS({
        type: 'file',
        data: new Uint8Array(file.content),
      });
      const fileNode = { Data: unixfsFile.marshal(), Links: [] };
      const encodedFile = dagPB.encode(fileNode);

      // Calculate the file's CID
      const fileHash = await sha256.digest(encodedFile);
      const fileCid = CID.create(1, 0x70, fileHash);

      // Debug logging for each file
      if (process.env.DEBUG_CID_CALC) {
        console.log(`File: ${file.name}`);
        console.log(`  Content size: ${file.content.length} bytes`);
        console.log(`  UnixFS Data size: ${unixfsFile.marshal().length} bytes`);
        console.log(`  DAG-PB encoded size: ${encodedFile.length} bytes`);
        console.log(`  File CID: ${fileCid.toString(base32)}`);
        console.log(`  Tsize: ${encodedFile.length}`);
      }

      // Create a link for this file
      // Tsize must be the size of the entire DAG object (encoded size)
      links.push({
        Name: file.name,
        Hash: fileCid,
        Tsize: encodedFile.length,
      });
    }

    // Sort links by name for deterministic CID
    // This is critical - IPFS requires lexicographic ordering
    links.sort((a, b) => {
      const aBytes = Buffer.from(a.Name, 'utf-8');
      const bBytes = Buffer.from(b.Name, 'utf-8');
      return Buffer.compare(aBytes, bBytes);
    });

    // Create DAG-PB node with directory data and sorted links
    return {
      Data: unixfsDir.marshal(),
      Links: links,
    };
  }
}
