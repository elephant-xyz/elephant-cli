import { UploadResult, ProcessedFile } from '../types/submit.types.js';
import { Semaphore } from 'async-mutex';
import { logger } from '../utils/logger.js';

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
    fileToProcess: ProcessedFile
  ): Promise<UploadResult> {
    logger.debug(
      `Processing upload for ${fileToProcess.filePath} (CID: ${fileToProcess.calculatedCid})`
    );
    try {
      const metadata: PinMetadata = {
        name: `${fileToProcess.dataGroupCid}.json`,
        keyvalues: {
          propertyCid: fileToProcess.propertyCid,
          dataGroupCid: fileToProcess.dataGroupCid,
          originalCid: fileToProcess.calculatedCid,
        },
      };

      return await this.uploadFileInternal(
        Buffer.from(fileToProcess.canonicalJson),
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
   * Internal method to upload a single file's content to Pinata v2 API (CID v0).
   * Includes retry logic.
   */
  private async uploadFileInternal(
    fileBuffer: Buffer,
    metadata: PinMetadata,
    originalFileInfo: ProcessedFile,
    retries: number = 10
  ): Promise<UploadResult> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        logger.debug(`Attempt ${attempt + 1} to upload ${metadata.name}`);

        // Use native File and FormData (Node 18+)
        const file = new File([fileBuffer], metadata.name || 'file.json', {
          type: 'application/json',
        });
        const form = new FormData();
        form.append('file', file);
        form.append('pinataOptions', JSON.stringify({ cidVersion: 0 }));
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

  public async uploadBatch(files: ProcessedFile[]): Promise<UploadResult[]> {
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
}
