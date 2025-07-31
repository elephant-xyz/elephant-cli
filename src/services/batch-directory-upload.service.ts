import { ProcessedFile, UploadResult } from '../types/submit.types.js';
import { PinataService } from './pinata.service.js';
import { logger } from '../utils/logger.js';
import path from 'path';
import fs from 'fs/promises';

export interface DirectoryUploadResult extends UploadResult {
  directoryCid?: string;
  filePath?: string; // Path within the directory
}

export interface BatchDirectoryUploadOptions {
  batchSize: number;
  dryRun: boolean;
}

export class BatchDirectoryUploadService {
  constructor(
    private pinataService: PinataService,
    private options: BatchDirectoryUploadOptions = {
      batchSize: 200,
      dryRun: false,
    }
  ) {}

  /**
   * Uploads JSON files in batches as directories to IPFS
   * Each batch becomes a single directory upload, drastically reducing API calls
   */
  async uploadInBatches(
    processedFiles: ProcessedFile[]
  ): Promise<DirectoryUploadResult[]> {
    if (processedFiles.length === 0) {
      return [];
    }

    logger.info(
      `Starting batch directory upload for ${processedFiles.length} files with batch size ${this.options.batchSize}`
    );

    const results: DirectoryUploadResult[] = [];
    const batches = this.createBatches(processedFiles);

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      logger.info(
        `Processing batch ${i + 1}/${batches.length} with ${batch.length} files`
      );

      try {
        const batchResults = await this.uploadBatchAsDirectory(batch, i);
        results.push(...batchResults);
      } catch (error) {
        logger.error(
          `Failed to upload batch ${i + 1}: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
        // Add failure results for all files in the batch
        results.push(
          ...batch.map((file) => ({
            success: false,
            error: `Batch upload failed: ${
              error instanceof Error ? error.message : String(error)
            }`,
            propertyCid: file.propertyCid,
            dataGroupCid: file.dataGroupCid,
          }))
        );
      }
    }

    return results;
  }

  private createBatches(files: ProcessedFile[]): ProcessedFile[][] {
    const batches: ProcessedFile[][] = [];
    for (let i = 0; i < files.length; i += this.options.batchSize) {
      batches.push(files.slice(i, i + this.options.batchSize));
    }
    return batches;
  }

  private async uploadBatchAsDirectory(
    batch: ProcessedFile[],
    batchIndex: number
  ): Promise<DirectoryUploadResult[]> {
    if (this.options.dryRun) {
      logger.info(
        `[DRY RUN] Would upload batch ${batchIndex + 1} as directory`
      );
      // For dry run, return calculated CIDs for each file
      const results: DirectoryUploadResult[] = [];
      for (const file of batch) {
        results.push({
          success: true,
          cid: file.calculatedCid,
          propertyCid: file.propertyCid,
          dataGroupCid: file.dataGroupCid,
          directoryCid: `dry-run-batch-${batchIndex}`,
          filePath: `${file.propertyCid}/${file.dataGroupCid}.json`,
        });
      }
      return results;
    }

    // Create a temporary directory for this batch
    const tempDirName = `batch-${Date.now()}-${batchIndex}`;
    const tempDirPath = path.join(process.cwd(), '.tmp', tempDirName);

    try {
      // Ensure temp directory exists
      await fs.mkdir(tempDirPath, { recursive: true });

      // Write all files to the temporary directory
      // Use a flat structure with unique filenames
      const fileMapping = new Map<string, ProcessedFile>();

      for (const file of batch) {
        // Create a unique filename that includes both propertyCid and dataGroupCid
        // This ensures uniqueness and allows us to map back to the original file
        const fileName = `${file.propertyCid}_${file.dataGroupCid}.json`;
        const filePath = path.join(tempDirPath, fileName);

        // Write the canonical JSON content
        await fs.writeFile(filePath, file.canonicalJson, 'utf8');

        // Store mapping for later reference
        fileMapping.set(fileName, file);
      }

      logger.debug(`Created batch directory with ${batch.length} files`);

      // Upload the entire directory as one IPFS object
      const uploadResult = await this.pinataService.uploadDirectory(
        tempDirPath,
        {
          name: `elephant-batch-${batchIndex}`,
          keyvalues: {
            batchIndex,
            fileCount: batch.length,
            timestamp: new Date().toISOString(),
          },
        }
      );

      if (!uploadResult.success || !uploadResult.cid) {
        throw new Error(
          uploadResult.error || 'Directory upload failed without error message'
        );
      }

      const directoryCid = uploadResult.cid;
      logger.info(
        `Successfully uploaded batch ${batchIndex + 1} as directory with CID: ${directoryCid}`
      );

      // Now we need to get the individual file CIDs from the directory
      // For now, we'll store the directory CID and the file path
      // The actual individual CIDs can be retrieved when needed
      const results: DirectoryUploadResult[] = [];

      for (const [fileName, file] of fileMapping) {
        // Each file can be accessed at: /ipfs/{directoryCid}/{fileName}
        // But for the smart contract, we need the actual CID of the file content

        // Use the already calculated CID from the ProcessedFile
        results.push({
          success: true,
          cid: file.calculatedCid, // Use the pre-calculated CID
          propertyCid: file.propertyCid,
          dataGroupCid: file.dataGroupCid,
          directoryCid: directoryCid,
          filePath: fileName,
        });
      }

      return results;
    } finally {
      // Clean up temporary directory
      try {
        await fs.rm(tempDirPath, { recursive: true, force: true });
      } catch (error) {
        logger.warn(
          `Failed to clean up temporary directory ${tempDirPath}: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }
  }
}
