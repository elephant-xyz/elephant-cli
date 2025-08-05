import { promises as fsPromises } from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';
import { tmpdir } from 'os';
import { logger } from '../utils/logger.js';

export class ZipExtractorService {
  constructor() {}

  /**
   * Check if a file is a ZIP archive
   * @param filePath Path to the file to check
   * @returns true if the file is a ZIP archive
   */
  async isZipFile(filePath: string): Promise<boolean> {
    try {
      const stats = await fsPromises.stat(filePath);
      if (!stats.isFile()) {
        return false;
      }

      // Check file extension
      const ext = path.extname(filePath).toLowerCase();
      if (ext === '.zip') {
        return true;
      }

      // Check file magic bytes (ZIP files start with PK)
      const fd = await fsPromises.open(filePath, 'r');
      try {
        const buffer = Buffer.alloc(2);
        await fd.read(buffer, 0, 2, 0);
        return buffer[0] === 0x50 && buffer[1] === 0x4b; // 'PK'
      } finally {
        await fd.close();
      }
    } catch (error) {
      logger.debug(`Error checking if file is ZIP: ${error}`);
      return false;
    }
  }

  /**
   * Extract a ZIP file to a temporary directory
   * @param zipPath Path to the ZIP file
   * @returns Path to the extracted directory
   */
  async extractZip(zipPath: string): Promise<string> {
    try {
      // Create a unique temporary directory
      const tempDirBase = path.join(tmpdir(), 'elephant-cli-zip-');
      const tempDir = await fsPromises.mkdtemp(tempDirBase);
      logger.debug(`Created temporary directory: ${tempDir}`);

      // Extract the ZIP file
      logger.info(`Extracting ZIP file: ${zipPath}`);
      const zip = new AdmZip(zipPath);
      zip.extractAllTo(tempDir, true);

      // Check if the extraction created a single root directory
      const entries = await fsPromises.readdir(tempDir, {
        withFileTypes: true,
      });

      if (entries.length === 1 && entries[0].isDirectory()) {
        // Return the path to the single extracted directory
        const extractedDir = path.join(tempDir, entries[0].name);
        logger.debug(`ZIP extracted to single directory: ${extractedDir}`);
        return extractedDir;
      } else {
        // Multiple files/directories at root level
        logger.debug(`ZIP extracted to multiple entries in: ${tempDir}`);
        return tempDir;
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to extract ZIP file: ${errorMsg}`);
    }
  }

  /**
   * Clean up a temporary directory
   * @param tempDir Path to the temporary directory to remove
   */
  async cleanup(tempDir: string): Promise<void> {
    try {
      // Only clean up directories that contain our specific pattern
      if (!tempDir.includes('elephant-cli-zip-')) {
        logger.warn(
          `Refusing to clean up non-elephant-cli directory: ${tempDir}`
        );
        return;
      }

      logger.debug(`Cleaning up temporary directory: ${tempDir}`);
      await fsPromises.rm(tempDir, { recursive: true, force: true });
      logger.debug(`Successfully cleaned up: ${tempDir}`);
    } catch (error) {
      logger.warn(
        `Failed to clean up temporary directory ${tempDir}: ${error}`
      );
    }
  }

  /**
   * Get the root directory path for cleanup (handles nested extraction)
   * @param extractedPath The path returned by extractZip
   * @returns The root temporary directory that should be cleaned up
   */
  getTempRootDir(extractedPath: string): string {
    // Find the elephant-cli-zip- directory in the path
    const parts = extractedPath.split(path.sep);
    const tempIndex = parts.findIndex((part) =>
      part.startsWith('elephant-cli-zip-')
    );

    if (tempIndex !== -1) {
      // Return path up to and including the temp directory
      return parts.slice(0, tempIndex + 1).join(path.sep);
    }

    // Fallback to the provided path
    return extractedPath;
  }
}
