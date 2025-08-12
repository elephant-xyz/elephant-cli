import { promises as fsPromises } from 'fs';
import path from 'path';
import { logger } from '../utils/logger.js';

export interface PinataMetadata {
  name?: string;
  keyvalues?: Record<string, string | number | Date | null | undefined>;
}

export interface DirectoryUploadResult {
  success: boolean;
  cid?: string;
  error?: string;
}

/**
 * Dedicated service for uploading directories to IPFS via Pinata.
 * This service is optimized for directory uploads without validation,
 * rate limiting, or other overhead from the main PinataService.
 */
export class PinataDirectoryUploadService {
  private readonly pinataJwt: string;
  private readonly pinataApiUrl =
    'https://api.pinata.cloud/pinning/pinFileToIPFS';

  constructor(pinataJwt: string) {
    if (!pinataJwt) {
      throw new Error('Pinata JWT is required for authentication.');
    }
    this.pinataJwt = pinataJwt;
    logger.technical('PinataDirectoryUploadService initialized');
  }

  /**
   * Upload an entire directory to Pinata as a single IPFS directory.
   * All files in the directory are uploaded in a single request.
   *
   * @param directoryPath - The absolute path to the directory to upload
   * @param metadata - Optional metadata for the upload
   * @returns Upload result with the directory CID
   */
  async uploadDirectory(
    directoryPath: string,
    metadata?: PinataMetadata
  ): Promise<DirectoryUploadResult> {
    try {
      logger.debug(`Starting directory upload for: ${directoryPath}`);

      // Verify directory exists
      const dirStats = await fsPromises.stat(directoryPath).catch(() => null);
      if (!dirStats || !dirStats.isDirectory()) {
        throw new Error(`Directory not found: ${directoryPath}`);
      }

      // Get all files in the directory recursively
      const files = await this.getAllFiles(directoryPath);

      if (files.length === 0) {
        throw new Error(`No files found in directory: ${directoryPath}`);
      }

      logger.technical(`Found ${files.length} files to upload as directory`);

      // Create form data for the upload
      const form = new FormData();

      // Get the directory name to use as the root folder
      const dirName = metadata?.name || path.basename(directoryPath);

      // Add each file to the form data with its relative path
      // When uploading multiple files as a directory, Pinata expects them to have
      // paths that include the directory name
      for (const filePath of files) {
        const relativePath = this.getRelativePath(directoryPath, filePath);
        const fileContent = await fsPromises.readFile(filePath);

        // Include directory name in the path for proper directory structure
        // This creates a structure like: dirName/file1.json, dirName/file2.json
        const ipfsPath = `${dirName}/${relativePath}`;

        // Create a File object with the IPFS path to preserve directory structure
        const file = new File([fileContent], ipfsPath, {
          type: 'application/octet-stream',
        });

        logger.debug(`Adding file to upload: ${ipfsPath}`);

        // Append file with the filepath to preserve directory structure
        // Use the same key 'file' for all files
        form.append('file', file, ipfsPath);
      }

      // Configure upload options - use CID v1
      // Don't use wrapWithDirectory since we're already creating the directory structure
      const pinataOptions = {
        cidVersion: 1,
        wrapWithDirectory: false,
      };
      form.append('pinataOptions', JSON.stringify(pinataOptions));

      // Add metadata if provided
      if (metadata) {
        const pinataMetadata = {
          name: metadata.name || path.basename(directoryPath),
          keyvalues: metadata.keyvalues || {},
        };
        form.append('pinataMetadata', JSON.stringify(pinataMetadata));
      }

      // Make the upload request
      logger.info(
        `Uploading directory ${directoryPath} to IPFS (${files.length} files)...`
      );

      const response = await fetch(this.pinataApiUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.pinataJwt}`,
          // Let fetch set the Content-Type with boundary for multipart/form-data
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
      const cid = resultJson?.IpfsHash;

      if (!cid) {
        throw new Error('No CID returned from Pinata API');
      }

      logger.success(
        `Successfully uploaded directory ${directoryPath} to IPFS. CID: ${cid}`
      );

      return {
        success: true,
        cid,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to upload directory ${directoryPath}: ${errorMsg}`);

      return {
        success: false,
        error: errorMsg,
      };
    }
  }

  /**
   * Recursively get all files in a directory.
   * @param dir - Directory path
   * @returns Array of file paths
   */
  private async getAllFiles(dir: string): Promise<string[]> {
    const files: string[] = [];

    async function walk(currentPath: string) {
      const entries = await fsPromises.readdir(currentPath, {
        withFileTypes: true,
      });

      for (const entry of entries) {
        const fullPath = path.join(currentPath, entry.name);

        if (entry.isDirectory()) {
          await walk(fullPath);
        } else if (entry.isFile()) {
          files.push(fullPath);
        }
      }
    }

    await walk(dir);
    return files;
  }

  /**
   * Get relative path from base directory, preserving the property directory structure.
   * For the upload command, we want to preserve: propertyDir/filename.json
   *
   * @param base - Base directory path (the extracted temp directory)
   * @param file - File path
   * @returns Relative path in format: propertyDir/filename
   */
  private getRelativePath(base: string, file: string): string {
    // Get the relative path from the base directory
    const relativePath = path.relative(base, file);

    // Convert to POSIX format for consistency in IPFS
    const posixPath = relativePath.split(path.sep).join(path.posix.sep);

    logger.debug(`Relative path for ${file}: ${posixPath}`);
    return posixPath;
  }
}
