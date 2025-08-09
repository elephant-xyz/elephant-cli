import { promises as fsPromises } from 'fs';
import path from 'path';
import { FileEntry } from '../types/submit.types.js';
import { SEED_DATAGROUP_SCHEMA_CID } from '../config/constants.js';
import { SchemaManifestService } from '../services/schema-manifest.service.js';
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
 * Files are identified as datagroup root files if they have exactly "label" and "relationships" keys
 * @param actualInputDir - The property directory to scan
 * @param propertyDirName - The name of the property directory
 * @param schemaManifestService - Service for schema manifest operations
 * @returns Scan results with file entries and metadata
 */
export async function scanSinglePropertyDirectoryV2(
  actualInputDir: string,
  propertyDirName: string,
  schemaManifestService: SchemaManifestService
): Promise<SinglePropertyScanResult> {
  const files = await fsPromises.readdir(actualInputDir, {
    withFileTypes: true,
  });

  const jsonFiles = files.filter(
    (entry) => entry.isFile() && entry.name.endsWith('.json')
  );

  // Load schema manifest to map labels to CIDs
  await schemaManifestService.loadSchemaManifest();

  const allFiles: FileEntry[] = [];
  const schemaCids = new Set<string>();
  let validFilesCount = 0;
  let descriptiveFilesCount = 0;
  let hasSeedFile = false;
  let propertyCid = `SEED_PENDING:${propertyDirName}`; // Default to seed pending

  // First pass: identify datagroup files and seed file
  for (const file of jsonFiles) {
    const filePath = path.join(actualInputDir, file.name);

    try {
      // Read and parse the file to check its structure
      const fileContent = await fsPromises.readFile(filePath, 'utf-8');
      const jsonData = JSON.parse(fileContent);

      // Check if this is a datagroup root file
      if (SchemaManifestService.isDataGroupRootFile(jsonData)) {
        const label = jsonData.label;

        // Get the CID for this datagroup by its label
        const dataGroupCid =
          schemaManifestService.getDataGroupCidByLabel(label);

        if (dataGroupCid) {
          validFilesCount++;
          schemaCids.add(dataGroupCid);

          // Check if this is the seed datagroup
          if (dataGroupCid === SEED_DATAGROUP_SCHEMA_CID) {
            hasSeedFile = true;
          }

          allFiles.push({
            propertyCid: propertyCid, // Will be updated later for non-seed files
            dataGroupCid,
            filePath,
          });

          logger.debug(
            `Identified datagroup file: ${file.name} with label "${label}" -> CID: ${dataGroupCid}`
          );
        } else {
          logger.warn(
            `File ${file.name} appears to be a datagroup with label "${label}" but no matching CID found in manifest`
          );
          descriptiveFilesCount++;
        }
      } else {
        // Not a datagroup file, treat as descriptive file
        logger.debug(
          `Skipping descriptive-named file: ${file.name} (will be processed via IPLD references)`
        );
        descriptiveFilesCount++;
      }
    } catch (error) {
      // If we can't read or parse the file, skip it
      logger.warn(
        `Could not process file ${file.name}: ${error instanceof Error ? error.message : String(error)}`
      );
      descriptiveFilesCount++;
    }
  }

  // Update property CID based on whether we have a seed file
  if (!hasSeedFile) {
    // No seed file, use directory name as property CID
    propertyCid = propertyDirName;

    // Update all file entries with the final property CID
    for (const file of allFiles) {
      file.propertyCid = propertyCid;
    }
  }
  // If we have a seed file, keep SEED_PENDING for non-seed files

  return {
    allFiles,
    validFilesCount,
    descriptiveFilesCount,
    hasSeedFile,
    propertyCid,
    schemaCids,
  };
}
