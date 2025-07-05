import { stat, readdir } from 'fs/promises';
import { join, extname } from 'path';
import { FileEntry } from '../types/submit.types.js';
import { SEED_DATAGROUP_SCHEMA_CID } from '../config/constants.js';

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
      let validPropertyDirs = 0;
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const propertyDirPath = join(directoryPath, entry.name);

          // Check if this is a valid CID directory OR a seed datagroup directory
          if (this.isValidCid(entry.name)) {
            // Standard CID directory
            validPropertyDirs++;
            const propertyValidation =
              await this.validatePropertyDirectory(propertyDirPath);
            errors.push(...propertyValidation.errors);
          } else {
            // Check if this is a seed datagroup directory
            const seedValidation =
              await this.validateSeedDatagroupDirectory(propertyDirPath);
            if (seedValidation.isValid) {
              validPropertyDirs++;
              errors.push(...seedValidation.errors);
            }
          }
        }
        // Ignore files in root directory
      }

      if (validPropertyDirs === 0) {
        errors.push(
          'No valid property CID directories found. Expected directories with CID names (e.g., QmXXX...)'
        );
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

      let validFiles = 0;
      for (const file of files) {
        if (file.isFile()) {
          // Only process files with .json extension
          if (extname(file.name) === '.json') {
            // Extract data group CID from filename (remove .json extension)
            const dataGroupCid = file.name.slice(0, -5); // Remove '.json'

            // Only count files with valid CID filenames
            if (this.isValidCid(dataGroupCid)) {
              validFiles++;
            }
            // Ignore JSON files with non-CID names
          }
          // Ignore non-JSON files
        }
        // Ignore subdirectories
      }

      if (validFiles === 0) {
        errors.push(
          `No valid data group CID files found in ${propertyDirPath}`
        );
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

  private async validateSeedDatagroupDirectory(
    directoryPath: string
  ): Promise<ValidationResult> {
    const errors: string[] = [];

    try {
      const files = await readdir(directoryPath, { withFileTypes: true });

      if (files.length === 0) {
        errors.push(`Directory ${directoryPath} is empty`);
        return { isValid: false, errors };
      }

      // Check if there's a file with the seed datagroup schema CID
      const seedFile = files.find(
        (file) =>
          file.isFile() && file.name === `${SEED_DATAGROUP_SCHEMA_CID}.json`
      );

      if (!seedFile) {
        // Not a seed datagroup directory, return invalid without error
        return { isValid: false, errors: [] };
      }

      // Count valid files including the seed file and other CID files
      let validFiles = 0;
      for (const file of files) {
        if (file.isFile()) {
          // Only process files with .json extension
          if (extname(file.name) === '.json') {
            // Extract data group CID from filename (remove .json extension)
            const dataGroupCid = file.name.slice(0, -5); // Remove '.json'

            // Count seed file and other valid CID files
            if (
              dataGroupCid === SEED_DATAGROUP_SCHEMA_CID ||
              this.isValidCid(dataGroupCid)
            ) {
              validFiles++;
            }
          }
        }
      }

      if (validFiles === 0) {
        errors.push(
          `No valid files found in seed datagroup directory ${directoryPath}`
        );
      }

      return {
        isValid: errors.length === 0,
        errors,
      };
    } catch (error) {
      errors.push(
        `Failed to access seed datagroup directory ${directoryPath}: ${error instanceof Error ? error.message : String(error)}`
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
          continue; // Skip non-directories
        }

        const dirName = propertyDir.name;
        const propertyDirPath = join(directoryPath, dirName);

        try {
          const files = await readdir(propertyDirPath, { withFileTypes: true });

          // Check if this directory has a seed file
          const hasSeedFile = files.some(
            (file) =>
              file.isFile() && file.name === `${SEED_DATAGROUP_SCHEMA_CID}.json`
          );

          // Use directory name as propertyCid for now
          // For seed datagroup directories, this will be updated later after upload
          const propertyCid = this.isValidCid(dirName)
            ? dirName
            : hasSeedFile
              ? `SEED_PENDING:${dirName}`
              : dirName;

          // Skip directories that are neither CID directories nor seed datagroup directories
          if (!this.isValidCid(dirName) && !hasSeedFile) {
            continue;
          }

          for (const file of files) {
            if (!file.isFile() || !file.name.endsWith('.json')) {
              continue; // Skip non-JSON files
            }

            const dataGroupCid = file.name.slice(0, -5); // Remove '.json'

            // For standard CID directories, only process files with valid CID names
            // For seed datagroup directories, process seed file and other valid CID files
            if (this.isValidCid(dirName)) {
              // Standard CID directory - only process valid CID files
              if (!this.isValidCid(dataGroupCid)) {
                continue;
              }
            } else if (hasSeedFile) {
              // Seed datagroup directory - process seed file and other valid CID files
              if (
                dataGroupCid !== SEED_DATAGROUP_SCHEMA_CID &&
                !this.isValidCid(dataGroupCid)
              ) {
                continue;
              }
            } else {
              continue; // Skip invalid directories
            }

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
          logger.error(`Error scanning directory ${propertyDirPath}:`, error);
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

  async getAllDataGroupCids(directoryPath: string): Promise<Set<string>> {
    const dataGroupCids = new Set<string>();

    try {
      const propertyDirs = await readdir(directoryPath, {
        withFileTypes: true,
      });

      for (const propertyDir of propertyDirs) {
        if (!propertyDir.isDirectory()) {
          continue;
        }

        const dirName = propertyDir.name;
        const propertyDirPath = join(directoryPath, dirName);

        try {
          const files = await readdir(propertyDirPath, { withFileTypes: true });

          // Check if this directory has a seed file
          const hasSeedFile = files.some(
            (file) =>
              file.isFile() && file.name === `${SEED_DATAGROUP_SCHEMA_CID}.json`
          );

          // Skip directories that are neither CID directories nor seed datagroup directories
          if (!this.isValidCid(dirName) && !hasSeedFile) {
            continue;
          }

          for (const file of files) {
            if (!file.isFile() || !file.name.endsWith('.json')) {
              continue;
            }
            const dataGroupCid = file.name.slice(0, -5); // Remove '.json'

            if (this.isValidCid(dirName)) {
              // Standard CID directory - only process valid CID files
              if (this.isValidCid(dataGroupCid)) {
                dataGroupCids.add(dataGroupCid);
              }
            } else if (hasSeedFile) {
              // Seed datagroup directory - process seed file and other valid CID files
              if (
                dataGroupCid === SEED_DATAGROUP_SCHEMA_CID ||
                this.isValidCid(dataGroupCid)
              ) {
                dataGroupCids.add(dataGroupCid);
              }
            }
          }
        } catch (error) {
          // Log or handle error for a specific property directory, but continue
          console.warn(
            `Warning: Could not scan property directory ${propertyDirPath} for data group CIDs: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }
    } catch (error) {
      // Handle error for the root directoryPath
      throw new Error(
        `Failed to scan directory ${directoryPath} for data group CIDs: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    return dataGroupCids;
  }
}
