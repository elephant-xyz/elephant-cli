import { promises as fsPromises } from 'fs';
import path from 'path';
import { FileEntry } from '../types/submit.types.js';
import { SEED_DATAGROUP_SCHEMA_CID } from '../config/constants.js';
import { isValidCid } from './cid-validator.js';
import { logger } from './logger.js';

export interface SinglePropertyScanResult {
  allFiles: FileEntry[];
  validFilesCount: number;
  descriptiveFilesCount: number;
  hasSeedFile: boolean;
  propertyCid: string;
  schemaCids: Set<string>;
}

/**
 * Scans a single property directory and returns file information
 * @param actualInputDir - The property directory to scan
 * @param propertyDirName - The name of the property directory
 * @returns Scan results with file entries and metadata
 */
export async function scanSinglePropertyDirectory(
  actualInputDir: string,
  propertyDirName: string
): Promise<SinglePropertyScanResult> {
  const files = await fsPromises.readdir(actualInputDir, {
    withFileTypes: true,
  });

  const jsonFiles = files.filter(
    (entry) => entry.isFile() && entry.name.endsWith('.json')
  );

  // Check if there's a seed datagroup file
  const hasSeedFile = jsonFiles.some(
    (file) => file.name === `${SEED_DATAGROUP_SCHEMA_CID}.json`
  );

  // Determine the property CID
  let propertyCid: string;
  if (isValidCid(propertyDirName)) {
    // Directory has a CID name
    propertyCid = propertyDirName;
  } else if (hasSeedFile) {
    // Directory has a seed file, mark for pending
    propertyCid = `SEED_PENDING:${propertyDirName}`;
  } else {
    // Directory name is not a CID and no seed file
    propertyCid = propertyDirName;
  }

  const allFiles: FileEntry[] = [];
  const schemaCids = new Set<string>();
  let validFilesCount = 0;
  let descriptiveFilesCount = 0;

  // Scan all JSON files in the property directory
  for (const file of jsonFiles) {
    const dataGroupCid = file.name.slice(0, -5); // Remove '.json'
    const filePath = path.join(actualInputDir, file.name);

    // Check if this is a valid schema CID or seed file
    const isSchemaFile =
      isValidCid(dataGroupCid) || dataGroupCid === SEED_DATAGROUP_SCHEMA_CID;

    if (!isSchemaFile) {
      logger.debug(
        `Skipping descriptive-named file: ${file.name} (will be processed via IPLD references)`
      );
      descriptiveFilesCount++;
      continue;
    }

    validFilesCount++;

    // Add to schema CIDs for pre-fetching
    schemaCids.add(dataGroupCid);

    // For single property with seed file, mark non-seed files appropriately
    let filePropertyCid = propertyCid;
    if (hasSeedFile && dataGroupCid !== SEED_DATAGROUP_SCHEMA_CID) {
      // Non-seed file in a seed datagroup directory
      filePropertyCid = `SEED_PENDING:${propertyDirName}`;
    }

    allFiles.push({
      propertyCid: filePropertyCid,
      dataGroupCid,
      filePath,
    });
  }

  return {
    allFiles,
    validFilesCount,
    descriptiveFilesCount,
    hasSeedFile,
    propertyCid,
    schemaCids,
  };
}
