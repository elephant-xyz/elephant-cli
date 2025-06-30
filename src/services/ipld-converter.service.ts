import { CID } from 'multiformats/cid';
import * as dagJSON from '@ipld/dag-json';
import * as dagCBOR from '@ipld/dag-cbor';
import { sha256 } from 'multiformats/hashes/sha2';
import { promises as fsPromises } from 'fs';
import path from 'path';
import { logger } from '../utils/logger.js';
import { PinataService } from './pinata.service.js';
import { CidCalculatorService } from './cid-calculator.service.js';

export interface IPLDConversionResult {
  originalData: any;
  convertedData: any;
  hasLinks: boolean;
  linkedCIDs: string[];
  dagCborCID?: string;
}

export class IPLDConverterService {
  private baseDirectory?: string;
  private pinataService?: PinataService;
  private cidCalculatorService: CidCalculatorService;

  constructor(
    baseDirectory?: string,
    pinataService?: PinataService,
    cidCalculatorService?: CidCalculatorService
  ) {
    this.baseDirectory = baseDirectory;
    this.pinataService = pinataService;
    this.cidCalculatorService =
      cidCalculatorService || new CidCalculatorService();
  }

  /**
   * Convert data with file path links to IPLD DAG-JSON format
   * Uploads referenced files to IPFS and replaces paths with CIDs
   */
  async convertToIPLD(data: any): Promise<IPLDConversionResult> {
    const linkedCIDs: string[] = [];
    const convertedData = await this.processDataForIPLD(data, linkedCIDs);

    return {
      originalData: data,
      convertedData,
      hasLinks: linkedCIDs.length > 0,
      linkedCIDs,
    };
  }

  /**
   * Recursively process data to convert file paths to IPFS CIDs
   */
  private async processDataForIPLD(
    data: any,
    linkedCIDs: string[]
  ): Promise<any> {
    if (!data || typeof data !== 'object') {
      return data;
    }

    // Check if this is a pointer object with file path
    if (
      Object.prototype.hasOwnProperty.call(data, '/') &&
      typeof data['/'] === 'string' &&
      Object.keys(data).length === 1
    ) {
      const pointerValue = data['/'];

      // Check if it's already a valid CID
      let isCID = false;
      try {
        CID.parse(pointerValue);
        isCID = true;
      } catch {
        // Not a valid CID, treat as file path
      }

      if (isCID) {
        // Already a CID, return as-is (proper IPLD link format)
        linkedCIDs.push(pointerValue);
        return data;
      } else {
        // It's a file path, upload the file and convert to CID link
        const cid = await this.uploadFileAndGetCID(pointerValue);
        linkedCIDs.push(cid);

        // Return proper IPLD link format
        return { '/': cid };
      }
    }

    // Handle arrays
    if (Array.isArray(data)) {
      return Promise.all(
        data.map((item) => this.processDataForIPLD(item, linkedCIDs))
      );
    }

    // Handle objects recursively
    const processed: any = {};
    for (const key in data) {
      if (Object.prototype.hasOwnProperty.call(data, key)) {
        processed[key] = await this.processDataForIPLD(data[key], linkedCIDs);
      }
    }
    return processed;
  }

  /**
   * Upload a file to IPFS and return its CID
   * Uses CID v1 with DAG-JSON for IPLD compliance
   */
  private async uploadFileAndGetCID(filePath: string): Promise<string> {
    try {
      let resolvedPath: string;

      // Determine if it's an absolute or relative path
      if (filePath.startsWith('/')) {
        resolvedPath = filePath;
      } else {
        if (!this.baseDirectory) {
          throw new Error(
            `No base directory provided for relative path: ${filePath}`
          );
        }
        resolvedPath = path.join(this.baseDirectory, filePath);
      }

      // Read the file
      const fileContent = await fsPromises.readFile(resolvedPath, 'utf-8');

      // Try to parse as JSON
      let dataToUpload: any;
      try {
        dataToUpload = JSON.parse(fileContent);
      } catch {
        // If not JSON, treat as raw text
        dataToUpload = fileContent;
      }

      // If we have Pinata service, upload to IPFS
      if (this.pinataService) {
        logger.debug(`Uploading linked file to IPFS: ${resolvedPath}`);

        // Convert data to canonical JSON for consistent CID
        const canonicalJson = JSON.stringify(dataToUpload);
        const buffer = Buffer.from(canonicalJson, 'utf-8');

        // Calculate expected CID using appropriate format
        const expectedCid =
          await this.cidCalculatorService.calculateCidAutoFormat(dataToUpload);

        // Create a ProcessedFile object for Pinata upload
        const processedFile = {
          propertyCid: 'linked-content',
          dataGroupCid: 'linked-content',
          filePath: resolvedPath,
          canonicalJson,
          calculatedCid: expectedCid,
          validationPassed: true,
        };

        // Upload to Pinata (which will now return CID v1)
        const uploadResults = await this.pinataService.uploadBatch([
          processedFile,
        ]);

        if (
          uploadResults &&
          uploadResults[0] &&
          uploadResults[0].success &&
          uploadResults[0].cid
        ) {
          logger.debug(
            `Successfully uploaded linked file. CID v1: ${uploadResults[0].cid}`
          );
          return uploadResults[0].cid;
        } else {
          throw new Error(
            `Failed to upload linked file: ${uploadResults?.[0]?.error || 'Unknown error'}`
          );
        }
      } else {
        // If no Pinata service, calculate the CID v1 locally
        logger.warn(
          'No Pinata service provided, calculating CID v1 locally without upload'
        );
        const canonicalJson = JSON.stringify(dataToUpload);
        const buffer = Buffer.from(canonicalJson, 'utf-8');
        return await this.cidCalculatorService.calculateCidV1(buffer);
      }
    } catch (error) {
      throw new Error(
        `Failed to upload file ${filePath}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Encode data as DAG-JSON
   */
  encodeAsDAGJSON(data: any): Uint8Array {
    return dagJSON.encode(data);
  }

  /**
   * Decode DAG-JSON data
   */
  decodeDAGJSON(bytes: Uint8Array): any {
    return dagJSON.decode(bytes);
  }

  /**
   * Encode data as DAG-CBOR (more efficient binary format)
   */
  encodeAsDAGCBOR(data: any): Uint8Array {
    return dagCBOR.encode(data);
  }

  /**
   * Calculate CID for DAG-CBOR encoded data
   */
  async calculateDAGCBORCid(data: any): Promise<string> {
    const encoded = this.encodeAsDAGCBOR(data);
    const hash = await sha256.digest(encoded);
    // 0x71 is the codec for dag-cbor
    const cid = CID.create(1, 0x71, hash);
    return cid.toString();
  }

  /**
   * Calculate CID v1 for DAG-JSON encoded data
   * This returns the proper CID format for DAG-JSON
   * Note: Currently not used for uploads due to Pinata compatibility
   */
  async calculateDAGJSONCid(data: any): Promise<string> {
    const encoded = this.encodeAsDAGJSON(data);
    const hash = await sha256.digest(encoded);
    // 0x0129 is the codec for dag-json
    const cid = CID.create(1, 0x0129, hash);
    return cid.toString();
  }

  /**
   * Check if data contains any IPLD links
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
      try {
        CID.parse(data['/']);
        return true;
      } catch {
        // Not a CID, could be a file path
        return !this.isValidCID(data['/']);
      }
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
   * Helper to check if a string is a valid CID
   */
  private isValidCID(str: string): boolean {
    try {
      CID.parse(str);
      return true;
    } catch {
      return false;
    }
  }
}
