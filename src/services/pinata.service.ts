import { UploadResult, ProcessedFile } from '../types/submit.types.js';
import { Semaphore } from 'async-mutex';
import { logger } from '../utils/logger.js';
import path from 'path';
import { promises as fsPromises } from 'fs';

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
   * Upload a directory structure as a single IPFS object
   * Since Pinata doesn't support direct directory uploads via API,
   * this method creates an index file that represents the directory structure
   */
  public async uploadDirectory(
    directoryPath: string,
    directoryName: string,
    metadata?: PinMetadata
  ): Promise<UploadResult> {
    try {
      logger.info(`Uploading directory ${directoryName} to IPFS...`);

      // Create a mapping of all files in the directory
      const files = await this.scanDirectory(directoryPath);

      if (files.length === 0) {
        return {
          success: false,
          error: 'No files found in directory',
          propertyCid: directoryName,
          dataGroupCid: 'html-fact-sheet',
        };
      }

      // Upload all files individually first
      const uploadResults = new Map<string, string>();
      const errors: string[] = [];

      for (const file of files) {
        const fileBuffer = await fsPromises.readFile(file.absolutePath);
        const relativePath = path.relative(directoryPath, file.absolutePath);

        const fileMetadata: PinMetadata = {
          name: `${directoryName}/${relativePath}`,
          keyvalues: {
            ...metadata?.keyvalues,
            directory: directoryName,
            relativePath: relativePath,
          },
        };

        const result = await this.uploadFile(fileBuffer, fileMetadata);

        if (result.success && result.cid) {
          uploadResults.set(relativePath, result.cid);
          logger.debug(`Uploaded ${relativePath}: ${result.cid}`);
        } else {
          errors.push(`Failed to upload ${relativePath}: ${result.error}`);
        }
      }

      if (errors.length > 0) {
        logger.error(`Errors during directory upload: ${errors.join(', ')}`);
      }

      // Create an index file that maps the directory structure
      const indexData = {
        type: 'directory',
        name: directoryName,
        files: Object.fromEntries(uploadResults),
        timestamp: new Date().toISOString(),
      };

      const indexBuffer = Buffer.from(JSON.stringify(indexData, null, 2));
      const indexMetadata: PinMetadata = {
        name: `${directoryName}/_directory_index.json`,
        keyvalues: {
          ...metadata?.keyvalues,
          type: 'directory_index',
          directory: directoryName,
        },
      };

      // Upload the index file
      const indexResult = await this.uploadFile(indexBuffer, indexMetadata);

      if (indexResult.success && indexResult.cid) {
        // Return the index CID as the directory CID
        return {
          ...indexResult,
          propertyCid: directoryName,
          dataGroupCid: 'html-fact-sheet',
        };
      } else {
        return {
          success: false,
          error: `Failed to upload directory index: ${indexResult.error}`,
          propertyCid: directoryName,
          dataGroupCid: 'html-fact-sheet',
        };
      }
    } catch (error) {
      logger.error(
        `Error uploading directory ${directoryName}: ${error instanceof Error ? error.message : String(error)}`
      );
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        propertyCid: directoryName,
        dataGroupCid: 'html-fact-sheet',
      };
    }
  }

  private async scanDirectory(
    dirPath: string
  ): Promise<Array<{ absolutePath: string; relativePath: string }>> {
    const files: Array<{ absolutePath: string; relativePath: string }> = [];

    async function scan(currentPath: string) {
      const items = await fsPromises.readdir(currentPath, {
        withFileTypes: true,
      });

      for (const item of items) {
        const itemPath = path.join(currentPath, item.name);

        if (item.isFile()) {
          files.push({
            absolutePath: itemPath,
            relativePath: path.relative(dirPath, itemPath),
          });
        } else if (item.isDirectory()) {
          await scan(itemPath);
        }
      }
    }

    await scan(dirPath);
    return files;
  }
}
