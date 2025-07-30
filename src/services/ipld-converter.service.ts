import { CID } from 'multiformats/cid';
import * as dagJSON from '@ipld/dag-json';
import * as dagCBOR from '@ipld/dag-cbor';
import { sha256 } from 'multiformats/hashes/sha2';
import { promises as fsPromises } from 'fs';
import path from 'path';
import { logger } from '../utils/logger.js';
import { PinataService } from './pinata.service.js';
import { CidCalculatorService } from './cid-calculator.service.js';
import { IPLDCanonicalizerService } from './ipld-canonicalizer.service.js';
import { JsonCanonicalizerService } from './json-canonicalizer.service.cjs';

export interface IPLDConversionResult {
  originalData: any;
  convertedData: any;
  hasLinks: boolean;
  linkedCIDs: string[];
  dagCborCID?: string;
}

export interface SchemaInfo {
  format?: string;
  type?: string | string[];
}

export class IPLDConverterService {
  private baseDirectory?: string;
  private pinataService?: PinataService;
  private cidCalculatorService: CidCalculatorService;
  private canonicalizerService:
    | IPLDCanonicalizerService
    | JsonCanonicalizerService;

  constructor(
    baseDirectory?: string,
    pinataService?: PinataService,
    cidCalculatorService?: CidCalculatorService,
    canonicalizerService?: IPLDCanonicalizerService | JsonCanonicalizerService
  ) {
    this.baseDirectory = baseDirectory;
    this.pinataService = pinataService;
    this.cidCalculatorService =
      cidCalculatorService || new CidCalculatorService();
    this.canonicalizerService =
      canonicalizerService || new IPLDCanonicalizerService();
  }

  /**
   * Convert data with file path links to IPLD DAG-JSON format
   * Uploads referenced files to IPFS and replaces paths with CIDs
   * @param data The data to convert
   * @param currentFilePath Optional path of the file containing this data (for relative path resolution)
   * @param schema Optional schema information for format-aware processing
   */
  async convertToIPLD(
    data: any,
    currentFilePath?: string,
    schema?: any
  ): Promise<IPLDConversionResult> {
    const linkedCIDs: string[] = [];
    const convertedData = await this.processDataForIPLD(
      data,
      linkedCIDs,
      currentFilePath,
      schema
    );

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
    linkedCIDs: string[],
    currentFilePath?: string,
    schema?: any,
    fieldName?: string
  ): Promise<any> {
    // Handle string values for ipfs_url fields or ipfs_uri format
    if (
      typeof data === 'string' &&
      (fieldName === 'ipfs_url' || schema?.format === 'ipfs_uri')
    ) {
      // Check if it's already an IPFS URI
      if (data.startsWith('ipfs://')) {
        return data;
      }

      // Check if it's a valid CID
      try {
        CID.parse(data);
        // It's a CID, convert to IPFS URI
        return `ipfs://${data}`;
      } catch {
        // Not a CID, treat as local path
      }

      // It's a local path, upload as image if Pinata service is available
      if (this.isImageFile(data) && this.pinataService) {
        const cid = await this.uploadFileAndGetCID(
          data,
          currentFilePath,
          linkedCIDs,
          true // treat as ipfs_uri format
        );
        linkedCIDs.push(cid);
        return `ipfs://${cid}`;
      }

      // Not an image file or no Pinata service, return as-is
      return data;
    }

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
        // This is a file path reference - upload it to IPFS
        const cid = await this.uploadFileAndGetCID(
          pointerValue,
          currentFilePath,
          linkedCIDs,
          false // not necessarily an ipfs_uri format
        );
        linkedCIDs.push(cid);
        return { '/': cid };
      }
    }

    // Handle arrays
    if (Array.isArray(data)) {
      const itemSchema = schema?.items;
      return Promise.all(
        data.map((item) =>
          this.processDataForIPLD(
            item,
            linkedCIDs,
            currentFilePath,
            itemSchema,
            fieldName
          )
        )
      );
    }

    // Handle objects recursively
    const processed: any = {};
    for (const key in data) {
      if (Object.prototype.hasOwnProperty.call(data, key)) {
        const propertySchema = schema?.properties?.[key];
        processed[key] = await this.processDataForIPLD(
          data[key],
          linkedCIDs,
          currentFilePath,
          propertySchema,
          key // Pass the field name
        );
      }
    }
    return processed;
  }

  /**
   * Check if a file is an image based on its extension
   */
  private isImageFile(filePath: string): boolean {
    const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp'];
    const ext = path.extname(filePath).toLowerCase();
    return imageExtensions.includes(ext);
  }

  /**
   * Get MIME type for an image file
   */
  private getImageMimeType(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes: Record<string, string> = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.svg': 'image/svg+xml',
      '.webp': 'image/webp',
    };
    return mimeTypes[ext] || 'application/octet-stream';
  }

  /**
   * Upload a file to IPFS and return its CID
   * Uses CID v1 with appropriate codec based on file type
   * @param filePath The file path to upload
   * @param currentFilePath Optional path of the file containing the reference (for relative path resolution)
   * @param linkedCIDs Array to collect all linked CIDs found during processing
   * @param isIpfsUriFormat Whether the schema indicates format: ipfs_uri (for images)
   */
  private async uploadFileAndGetCID(
    filePath: string,
    currentFilePath?: string,
    linkedCIDs?: string[],
    isIpfsUriFormat?: boolean
  ): Promise<string> {
    try {
      let resolvedPath: string;

      // Determine if it's an absolute or relative path
      if (filePath.startsWith('/')) {
        resolvedPath = filePath;
      } else {
        // For relative paths, resolve based on:
        // 1. Directory of the current file (if provided)
        // 2. Base directory (fallback)
        if (currentFilePath) {
          const currentDir = path.dirname(currentFilePath);
          resolvedPath = path.join(currentDir, filePath);
        } else if (this.baseDirectory) {
          resolvedPath = path.join(this.baseDirectory, filePath);
        } else {
          throw new Error(`No context provided for relative path: ${filePath}`);
        }
      }

      // Check if it's an image file and schema expects IPFS URI
      const isImage = this.isImageFile(resolvedPath) && isIpfsUriFormat;

      // Read the file (binary for images, utf-8 for text)
      const fileContent = isImage
        ? await fsPromises.readFile(resolvedPath)
        : await fsPromises.readFile(resolvedPath, 'utf-8');

      // Handle based on file type
      let dataToUpload: any;
      let uploadMetadata: any = {};

      if (isImage) {
        // For images, use the binary data directly
        dataToUpload = fileContent;
        uploadMetadata = {
          mimeType: this.getImageMimeType(resolvedPath),
          isImage: true,
        };
      } else {
        // Try to parse as JSON
        try {
          const parsedData = JSON.parse(fileContent as string);
          // Recursively process the parsed data to convert any nested file path links
          dataToUpload = await this.processDataForIPLD(
            parsedData,
            linkedCIDs || [],
            resolvedPath,
            undefined, // No schema for nested files
            undefined // No field name context
          );
        } catch {
          // If not JSON, treat as raw text
          dataToUpload = fileContent;
        }
      }

      // If we have Pinata service, upload to IPFS
      if (this.pinataService) {
        logger.debug(`Uploading linked file to IPFS: ${resolvedPath}`);

        let processedFile: any;
        let expectedCid: string;

        if (uploadMetadata.isImage) {
          // For images, upload as binary with raw codec
          expectedCid =
            await this.cidCalculatorService.calculateCidV1ForRawData(
              dataToUpload as Buffer
            );

          processedFile = {
            propertyCid: 'linked-content',
            dataGroupCid: 'linked-content',
            filePath: resolvedPath,
            binaryData: dataToUpload,
            calculatedCid: expectedCid,
            validationPassed: true,
            metadata: uploadMetadata,
          };
        } else {
          // For JSON/text, use canonical JSON
          const canonicalJson =
            this.canonicalizerService.canonicalize(dataToUpload);
          expectedCid =
            await this.cidCalculatorService.calculateCidFromCanonicalJson(
              canonicalJson,
              dataToUpload
            );

          processedFile = {
            propertyCid: 'linked-content',
            dataGroupCid: 'linked-content',
            filePath: resolvedPath,
            canonicalJson,
            calculatedCid: expectedCid,
            validationPassed: true,
          };
        }

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
          // Use the actual Pinata CID - it's the one that exists on IPFS
          const cidToReturn = uploadResults[0].cid;
          logger.debug(
            `Successfully uploaded linked file. CID v1: ${cidToReturn}`
          );
          return cidToReturn;
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

        if (uploadMetadata.isImage) {
          // For images, calculate CID from binary data
          return await this.cidCalculatorService.calculateCidV1ForRawData(
            dataToUpload as Buffer
          );
        } else {
          // For JSON/text, use canonical JSON
          const canonicalJson =
            this.canonicalizerService.canonicalize(dataToUpload);
          return await this.cidCalculatorService.calculateCidFromCanonicalJson(
            canonicalJson,
            dataToUpload
          );
        }
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
  hasIPLDLinks(data: any, schema?: any, fieldName?: string): boolean {
    // Check if it's a string that might need conversion
    if (typeof data === 'string') {
      // Already an IPFS URI, no conversion needed
      if (data.startsWith('ipfs://')) {
        return false;
      }

      // Check various conditions for when to process
      return (
        schema?.format === 'ipfs_uri' ||
        fieldName === 'ipfs_url' ||
        this.isImageFile(data)
      );
    }

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
      const itemSchema = schema?.items;
      return data.some((item) =>
        this.hasIPLDLinks(item, itemSchema, fieldName)
      );
    }

    // Check object properties
    for (const key in data) {
      if (Object.prototype.hasOwnProperty.call(data, key)) {
        const propertySchema = schema?.properties?.[key];
        if (this.hasIPLDLinks(data[key], propertySchema, key)) {
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
