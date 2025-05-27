import { stat, readdir } from 'fs/promises';
import { join, extname } from 'path';
import { FileEntry } from '../types/submit.types';

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
}

export class FileScannerService {
  constructor() {}

  async validateStructure(directoryPath: string): Promise<ValidationResult> {
    const errors: string[] = [];

    try {
      // Check if directory exists
      const dirStats = await stat(directoryPath);
      if (!dirStats.isDirectory()) {
        errors.push(`Path ${directoryPath} is not a directory`);
        return { isValid: false, errors };
      }

      // Read directory contents
      const entries = await readdir(directoryPath, { withFileTypes: true });

      if (entries.length === 0) {
        errors.push('Directory is empty');
        return { isValid: false, errors };
      }

      // Check each entry
      for (const entry of entries) {
        if (entry.isDirectory()) {
          // Validate property CID directory name
          if (!this.isValidCid(entry.name)) {
            errors.push(`Invalid property CID directory name: ${entry.name}`);
          } else {
            // Check files within the property directory
            const propertyDirPath = join(directoryPath, entry.name);
            const propertyValidation =
              await this.validatePropertyDirectory(propertyDirPath);
            errors.push(...propertyValidation.errors);
          }
        } else {
          errors.push(
            `Found file ${entry.name} in root directory. Only directories (property CIDs) are allowed.`
          );
        }
      }

      return {
        isValid: errors.length === 0,
        errors,
      };
    } catch (error) {
      errors.push(
        `Failed to access directory: ${error instanceof Error ? error.message : String(error)}`
      );
      return { isValid: false, errors };
    }
  }

  private async validatePropertyDirectory(
    propertyDirPath: string
  ): Promise<ValidationResult> {
    const errors: string[] = [];

    try {
      const files = await readdir(propertyDirPath, { withFileTypes: true });

      if (files.length === 0) {
        errors.push(`Property directory ${propertyDirPath} is empty`);
        return { isValid: false, errors };
      }

      for (const file of files) {
        if (file.isFile()) {
          // Check if file has .json extension
          if (extname(file.name) !== '.json') {
            errors.push(
              `File ${file.name} in ${propertyDirPath} must have .json extension`
            );
            continue;
          }

          // Extract data group CID from filename (remove .json extension)
          const dataGroupCid = file.name.slice(0, -5); // Remove '.json'

          // Validate data group CID
          if (!this.isValidCid(dataGroupCid)) {
            errors.push(
              `Invalid data group CID filename: ${file.name} in ${propertyDirPath}`
            );
          }
        } else if (file.isDirectory()) {
          errors.push(
            `Found subdirectory ${file.name} in property directory ${propertyDirPath}. Only JSON files are allowed.`
          );
        }
      }

      return {
        isValid: errors.length === 0,
        errors,
      };
    } catch (error) {
      errors.push(
        `Failed to access property directory ${propertyDirPath}: ${error instanceof Error ? error.message : String(error)}`
      );
      return { isValid: false, errors };
    }
  }

  private isValidCid(cid: string): boolean {
    // Basic CID validation
    // IPFS CIDs typically start with 'Qm' (CIDv0) or 'b' (CIDv1 base32)
    // They are usually 46 characters for CIDv0 or vary for CIDv1

    if (!cid || cid.length < 10) {
      return false;
    }

    // CIDv0 pattern: starts with 'Qm' and is 46 characters
    if (cid.startsWith('Qm') && cid.length === 46) {
      return /^Qm[a-zA-Z0-9]+$/.test(cid);
    }

    // CIDv1 pattern: can start with 'b' (base32) or other bases
    if (cid.startsWith('b') && cid.length > 20) {
      return /^b[a-z2-7]+$/.test(cid);
    }

    // Also accept other potential CID formats
    if (/^[a-zA-Z0-9]+$/.test(cid) && cid.length >= 20) {
      return true;
    }

    return false;
  }

  async *scanDirectory(
    directoryPath: string,
    batchSize = 1000
  ): AsyncGenerator<FileEntry[]> {
    try {
      const propertyDirs = await readdir(directoryPath, {
        withFileTypes: true,
      });
      let batch: FileEntry[] = [];

      for (const propertyDir of propertyDirs) {
        if (!propertyDir.isDirectory()) {
          continue; // Skip non-directories (validation should catch these)
        }

        const propertyCid = propertyDir.name;
        const propertyDirPath = join(directoryPath, propertyCid);

        try {
          const files = await readdir(propertyDirPath, { withFileTypes: true });

          for (const file of files) {
            if (!file.isFile() || !file.name.endsWith('.json')) {
              continue; // Skip non-JSON files (validation should catch these)
            }

            const dataGroupCid = file.name.slice(0, -5); // Remove '.json'
            const filePath = join(propertyDirPath, file.name);

            const fileEntry: FileEntry = {
              propertyCid,
              dataGroupCid,
              filePath,
            };

            batch.push(fileEntry);

            if (batch.length >= batchSize) {
              yield [...batch]; // Yield a copy of the batch
              batch = [];
            }
          }
        } catch (error) {
          // Log error but continue processing other directories
          console.error(
            `Error scanning property directory ${propertyDirPath}:`,
            error
          );
        }
      }

      // Yield remaining files in the last batch
      if (batch.length > 0) {
        yield batch;
      }
    } catch (error) {
      throw new Error(
        `Failed to scan directory ${directoryPath}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async countTotalFiles(directoryPath: string): Promise<number> {
    let totalFiles = 0;

    for await (const batch of this.scanDirectory(directoryPath)) {
      totalFiles += batch.length;
    }

    return totalFiles;
  }
}
