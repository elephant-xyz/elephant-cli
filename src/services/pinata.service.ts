import FormData from 'form-data'; // Pinata expects multipart/form-data
import { UploadResult, ProcessedFile } from '../types/submit.types.js';
import { Semaphore } from 'async-mutex';
import { logger } from '../utils/logger.js';
import { promises as fsPromises } from 'fs'; // For reading file content

export interface PinataOptions {
  cidVersion?: 0 | 1;
  wrapWithDirectory?: boolean;
  customPinPolicy?: Record<string, unknown>; // Define more strictly if needed
}

export interface PinataPinResponse {
  IpfsHash: string;
  PinSize: number;
  Timestamp: string; // ISO 8601 Date
  isDuplicate?: boolean;
}

export interface PinMetadata {
  name?: string;
  keyvalues?: Record<string, string | number | Date | null | undefined>; // Allow null/undefined for keyvalues
}

export class PinataService {
  private pinataApiKey: string;
  private pinataSecretApiKey: string;
  private pinataJwt: string | undefined;
  private semaphore: Semaphore;

  private readonly pinataApiUrl =
    'https://api.pinata.cloud/pinning/pinFileToIPFS';

  constructor(
    pinataJwtOrApiKey: string,
    pinataSecretApiKey?: string,
    maxConcurrentUploads = 10
  ) {
    if (pinataSecretApiKey) {
      this.pinataApiKey = pinataJwtOrApiKey;
      this.pinataSecretApiKey = pinataSecretApiKey;
      logger.warn(
        'Using Pinata API Key and Secret. Consider migrating to JWT for enhanced security.'
      );
    } else {
      this.pinataJwt = pinataJwtOrApiKey;
      this.pinataApiKey = '';
      this.pinataSecretApiKey = '';
    }

    this.semaphore = new Semaphore(maxConcurrentUploads);
  }

  private async processUpload(
    fileToProcess: ProcessedFile
  ): Promise<UploadResult> {
    logger.debug(
      `Processing upload for ${fileToProcess.filePath} (CID: ${fileToProcess.calculatedCid})`
    );
    try {
      const fileContent = await fsPromises.readFile(fileToProcess.filePath);

      const metadata: PinMetadata = {
        name: `${fileToProcess.propertyCid}_${fileToProcess.dataGroupCid}.json`, // A descriptive name
        keyvalues: {
          propertyCid: fileToProcess.propertyCid,
          dataGroupCid: fileToProcess.dataGroupCid,
          originalCid: fileToProcess.calculatedCid, // If calculated CID is different from IPFS one
        },
      };

      // The uploadFile method contains the actual Pinata API call and retry logic
      return await this.uploadFileInternal(
        fileContent,
        metadata,
        fileToProcess
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
   * Internal method to upload a single file's content to Pinata.
   * Includes retry logic.
   */
  private async uploadFileInternal(
    fileBuffer: Buffer,
    metadata: PinMetadata,
    originalFileInfo: ProcessedFile, // To pass through property/dataGroup CIDs for result
    retries: number = 3
  ): Promise<UploadResult> {
    const formData = new FormData();
    formData.append('file', fileBuffer, {
      filename: metadata.name || 'file.json', // Pinata requires a filename
    });

    const pinataMetadata = JSON.stringify({
      name: metadata.name,
      keyvalues: metadata.keyvalues || {},
    });
    formData.append('pinataMetadata', pinataMetadata);

    // Pinata options (optional)
    const pinataOptions = JSON.stringify({
      cidVersion: 0, // As per architecture.md, CID v0 is used
      // wrapWithDirectory: false, // Default
    });
    formData.append('pinataOptions', pinataOptions);

    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        logger.debug(`Attempt ${attempt + 1} to upload ${metadata.name}`);
        const response = await fetch(this.pinataApiUrl, {
          method: 'POST',
          headers: {
            ...this.getAuthHeaders(),
            // FormData sets Content-Type automatically, including boundary
            // ...formData.getHeaders(), // This is for Node's http module, not fetch
          },
          body: formData as any, // Type assertion for fetch body
        });

        if (!response.ok) {
          const errorBody = await response.text();
          throw new Error(
            `Pinata API error: ${response.status} ${response.statusText} - ${errorBody}`
          );
        }

        const resultJson = (await response.json()) as PinataPinResponse;
        logger.info(
          `Successfully uploaded ${metadata.name} to IPFS. CID: ${resultJson.IpfsHash}`
        );

        return {
          success: true,
          cid: resultJson.IpfsHash,
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
          logger.progress(`Retrying upload in ${delay / 1000}s...`);
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

  // Public facing uploadFile - might be deprecated if uploadBatch is primary
  public async uploadFile(
    data: Buffer,
    metadata: PinMetadata
    // This version of uploadFile is more generic and doesn't assume ProcessedFile structure
    // It's kept for potential direct use, but processUpload is used by the queue.
  ): Promise<UploadResult> {
    // For this generic version, we don't have originalFileInfo, so pass dummy values or adapt.
    const dummyFileInfo: ProcessedFile = {
      propertyCid:
        (metadata.keyvalues?.propertyCid as string) || 'unknownProperty',
      dataGroupCid:
        (metadata.keyvalues?.dataGroupCid as string) || 'unknownGroup',
      filePath: metadata.name || 'unknownFile.json',
      canonicalJson: '', // Not relevant for this direct call
      calculatedCid: '', // Not relevant
      validationPassed: true, // Assume valid if called directly
    };
    return this.uploadFileInternal(data, metadata, dummyFileInfo);
  }

  public async uploadBatch(files: ProcessedFile[]): Promise<UploadResult[]> {
    if (files.length === 0) {
      return [];
    }
    logger.info(`Uploading ${files.length} files to IPFS.`);

    // Use semaphore to limit concurrent uploads
    const uploadPromises = files.map(async (file) => {
      return await this.semaphore.runExclusive(async () => {
        return await this.processUpload(file);
      });
    });

    // Wait for all uploads to complete
    return await Promise.all(uploadPromises);
  }

  private getAuthHeaders(): Record<string, string> {
    if (this.pinataJwt) {
      return {
        Authorization: `Bearer ${this.pinataJwt}`,
      };
    } else {
      return {
        pinata_api_key: this.pinataApiKey,
        pinata_secret_api_key: this.pinataSecretApiKey,
      };
    }
  }
}
