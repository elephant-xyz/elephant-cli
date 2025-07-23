import { UploadResult, ProcessedFile } from '../types/submit.types.js';
import { Semaphore } from 'async-mutex';
import { logger } from '../utils/logger.js';
import path from 'path';
import fs from 'fs';
import FormDataNode from 'form-data';
// @ts-ignore - no types available
import rfs from 'recursive-fs';
// @ts-ignore - no types available
import basePathConverter from 'base-path-converter';

export interface PinMetadata {
  name?: string;
  keyvalues?: Record<string, string | number | Date | null | undefined>;
}

export class PinataService {
  private pinataJwt: string;
  private semaphore: Semaphore;

  private readonly pinataApiUrl =
    'https://api.pinata.cloud/pinning/pinFileToIPFS';

  constructor(
    pinataJwt: string,
    _pinataSecretApiKey?: string,
    maxConcurrentUploads = 18
  ) {
    if (!pinataJwt) {
      throw new Error('Pinata JWT is required for authentication.');
    }
    this.pinataJwt = pinataJwt;
    this.semaphore = new Semaphore(maxConcurrentUploads);
  }

  private async processUpload(
    fileToProcess: ProcessedFile & { binaryData?: Buffer; metadata?: any }
  ): Promise<UploadResult> {
    logger.debug(
      `Processing upload for ${fileToProcess.filePath} (CID: ${fileToProcess.calculatedCid})`
    );
    try {
      // Determine if this is a binary file (e.g., image)
      const isBinary = fileToProcess.binaryData !== undefined;
      const fileExtension =
        isBinary && fileToProcess.metadata?.isImage
          ? path.extname(fileToProcess.filePath)
          : '.json';

      const metadata: PinMetadata = {
        name: `${fileToProcess.dataGroupCid}${fileExtension}`,
        keyvalues: {
          propertyCid: fileToProcess.propertyCid,
          dataGroupCid: fileToProcess.dataGroupCid,
          originalCid: fileToProcess.calculatedCid,
        },
      };

      const fileBuffer = isBinary
        ? fileToProcess.binaryData!
        : Buffer.from(fileToProcess.canonicalJson);

      const mimeType = fileToProcess.metadata?.mimeType || 'application/json';

      return await this.uploadFileInternal(
        fileBuffer,
        metadata,
        fileToProcess,
        mimeType
      );
    } catch (error) {
      logger.error(
        `Error processing upload for ${fileToProcess.filePath}: ${error instanceof Error ? error.message : String(error)}`
      );
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        propertyCid: fileToProcess.propertyCid,
        dataGroupCid: fileToProcess.dataGroupCid,
      };
    }
  }

  /**
   * Internal method to upload a single file's content to Pinata v2 API (CID v0).
   * Includes retry logic.
   */
  private async uploadFileInternal(
    fileBuffer: Buffer,
    metadata: PinMetadata,
    originalFileInfo: ProcessedFile & { binaryData?: Buffer; metadata?: any },
    mimeType: string = 'application/json',
    retries: number = 10
  ): Promise<UploadResult> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        logger.debug(`Attempt ${attempt + 1} to upload ${metadata.name}`);

        // Use native File and FormData (Node 18+)
        const file = new File([fileBuffer], metadata.name || 'file', {
          type: mimeType,
        });
        const form = new FormData();
        form.append('file', file);
        // Use CID v1 by default for all uploads
        form.append('pinataOptions', JSON.stringify({ cidVersion: 1 }));
        const pinataMetadata = JSON.stringify({
          name: metadata.name,
          keyvalues: metadata.keyvalues || {},
        });
        form.append('pinataMetadata', pinataMetadata);

        const response = await fetch(this.pinataApiUrl, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.pinataJwt}`,
            // Do NOT set Content-Type, let FormData handle it
          },
          body: form,
        });

        if (!response.ok) {
          const errorBody = await response.text();
          throw new Error(
            `Pinata API error: ${response.status} ${response.statusText} - ${errorBody}`
          );
        }

        const resultJson = await response.json();
        // v2 returns { IpfsHash: ... }
        const cid = resultJson?.IpfsHash;
        logger.info(
          `Successfully uploaded ${metadata.name} to IPFS. CID: ${cid}`
        );

        return {
          success: true,
          cid,
          propertyCid: originalFileInfo.propertyCid,
          dataGroupCid: originalFileInfo.dataGroupCid,
        };
      } catch (error) {
        lastError = error as Error;
        logger.debug(
          `Upload attempt ${attempt + 1} for ${metadata.name} failed: ${lastError.message}`
        );
        if (attempt < retries) {
          const delay = Math.pow(2, attempt) * 1000; // Exponential backoff
          logger.debug(`Retrying upload in ${delay / 1000}s...`);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    logger.debug(
      `Failed to upload ${metadata.name} after ${retries + 1} attempts.`
    );
    return {
      success: false,
      error: lastError?.message || 'Unknown upload error',
      propertyCid: originalFileInfo.propertyCid,
      dataGroupCid: originalFileInfo.dataGroupCid,
    };
  }

  // Public facing uploadFile - for direct use with Buffer
  public async uploadFile(
    data: Buffer,
    metadata: PinMetadata
  ): Promise<UploadResult> {
    const dummyFileInfo: ProcessedFile = {
      propertyCid:
        (metadata.keyvalues?.propertyCid as string) || 'unknownProperty',
      dataGroupCid:
        (metadata.keyvalues?.dataGroupCid as string) || 'unknownGroup',
      filePath: metadata.name || 'unknownFile.json',
      canonicalJson: '',
      calculatedCid: '',
      validationPassed: true,
    };
    return this.uploadFileInternal(data, metadata, dummyFileInfo);
  }

  public async uploadBatch(
    files: (ProcessedFile & { binaryData?: Buffer; metadata?: any })[]
  ): Promise<UploadResult[]> {
    if (files.length === 0) {
      return [];
    }

    // Use semaphore to limit concurrent uploads
    const uploadPromises = files.map(async (file) => {
      return await this.semaphore.runExclusive(async () => {
        logger.debug(`Uploading ${file.filePath} to IPFS.`);
        return await this.processUpload(file);
      });
    });

    // Wait for all uploads to complete
    return await Promise.all(uploadPromises);
  }

  // No longer needed: getAuthHeaders (JWT only, handled inline)

  /**
   * Upload an entire directory to Pinata, preserving the directory structure.
   * @param directoryPath - The absolute path to the directory to upload
   * @param metadata - Optional metadata for the upload
   * @returns UploadResult with the CID of the uploaded directory
   */
  public async uploadDirectory(
    directoryPath: string,
    metadata?: PinMetadata
  ): Promise<UploadResult> {
    try {
      logger.debug(`Starting directory upload for: ${directoryPath}`);

      // Check if directory exists
      if (!fs.existsSync(directoryPath)) {
        throw new Error(`Directory not found: ${directoryPath}`);
      }

      // Read all files in the directory recursively
      const { dirs, files } = await rfs.read(directoryPath);

      if (files.length === 0) {
        throw new Error(`No files found in directory: ${directoryPath}`);
      }

      logger.debug(`Found ${files.length} files in ${dirs.length} directories`);

      // Create form data with the form-data package
      const form = new FormDataNode();

      // Add each file to the form data with its relative path
      for (const filePath of files) {
        const relativePath = basePathConverter(directoryPath, filePath);
        form.append('file', fs.createReadStream(filePath), {
          filepath: relativePath,
        });
      }

      // Add Pinata options for CID v1
      form.append(
        'pinataOptions',
        JSON.stringify({
          cidVersion: 1,
          wrapWithDirectory: true,
        })
      );

      // Add metadata if provided
      if (metadata) {
        const pinataMetadata = JSON.stringify({
          name: metadata.name || path.basename(directoryPath),
          keyvalues: metadata.keyvalues || {},
        });
        form.append('pinataMetadata', pinataMetadata);
      }

      // Get form headers (includes boundary for multipart)
      const formHeaders = form.getHeaders();

      // Convert form to buffer for fetch compatibility
      const formBuffer = await new Promise<Buffer>((resolve, reject) => {
        const chunks: Buffer[] = [];
        form.on('data', (chunk: Buffer) => chunks.push(chunk));
        form.on('end', () => resolve(Buffer.concat(chunks)));
        form.on('error', reject);
      });

      // Make the request using fetch
      const response = await fetch(this.pinataApiUrl, {
        method: 'POST',
        headers: {
          ...formHeaders,
          Authorization: `Bearer ${this.pinataJwt}`,
        },
        body: formBuffer,
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(
          `Pinata API error: ${response.status} ${response.statusText} - ${errorBody}`
        );
      }

      const resultJson = await response.json();
      const cid = resultJson?.IpfsHash;

      logger.info(
        `Successfully uploaded directory ${directoryPath} to IPFS. CID: ${cid}`
      );

      return {
        success: true,
        cid,
        propertyCid:
          (metadata?.keyvalues?.propertyCid as string) || directoryPath,
        dataGroupCid:
          (metadata?.keyvalues?.dataGroupCid as string) || 'directory',
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to upload directory ${directoryPath}: ${errorMsg}`);

      return {
        success: false,
        error: errorMsg,
        propertyCid:
          (metadata?.keyvalues?.propertyCid as string) || directoryPath,
        dataGroupCid:
          (metadata?.keyvalues?.dataGroupCid as string) || 'directory',
      };
    }
  }
}
