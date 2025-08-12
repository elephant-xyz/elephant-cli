import { promises as fsPromises } from 'fs';
import path from 'path';
import { SchemaManifestService } from '../services/schema-manifest.service.js';
import { logger } from './logger.js';

export interface DatagroupFile {
  filePath: string;
  fileName: string;
  dataCid: string; // The CID from the filename (without .json)
  dataGroupCid: string; // The schema CID determined from the label
  label: string;
}

/**
 * Analyzes a directory to find datagroup root files and determine their schema CIDs.
 * Datagroup root files are identified by having exactly two properties: "label" and "relationships".
 *
 * @param directoryPath - The directory to analyze
 * @param schemaManifestService - Service for looking up schema CIDs by label (required)
 * @returns Array of datagroup file information
 */
export async function analyzeDatagroupFiles(
  directoryPath: string,
  schemaManifestService: SchemaManifestService
): Promise<DatagroupFile[]> {
  const datagroupFiles: DatagroupFile[] = [];

  // Ensure the schema manifest is loaded
  await schemaManifestService.loadSchemaManifest();

  // Read all files in the directory
  const entries = await fsPromises.readdir(directoryPath, {
    withFileTypes: true,
  });
  const jsonFiles = entries.filter(
    (entry) => entry.isFile() && entry.name.endsWith('.json')
  );

  // Analyze each JSON file
  for (const file of jsonFiles) {
    const filePath = path.join(directoryPath, file.name);

    try {
      // Read and parse the file
      const fileContent = await fsPromises.readFile(filePath, 'utf-8');
      const jsonData = JSON.parse(fileContent);

      // Check if this is a datagroup root file
      if (SchemaManifestService.isDataGroupRootFile(jsonData)) {
        const label = jsonData.label;

        // Get the schema CID for this datagroup by its label
        const dataGroupCid =
          schemaManifestService.getDataGroupCidByLabel(label);

        if (dataGroupCid) {
          // Extract the data CID from the filename (remove .json extension)
          const dataCid = file.name.replace('.json', '');

          datagroupFiles.push({
            filePath,
            fileName: file.name,
            dataCid,
            dataGroupCid,
            label,
          });

          logger.debug(
            `Found datagroup file: ${file.name} with label "${label}" -> schema CID: ${dataGroupCid}`
          );
        } else {
          logger.warn(
            `File ${file.name} appears to be a datagroup with label "${label}" but no matching CID found in manifest`
          );
        }
      }
    } catch (error) {
      // Skip files that can't be read or parsed
      logger.debug(
        `Skipping file ${file.name}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  return datagroupFiles;
}

/**
 * Recursively analyzes a directory tree to find all datagroup files.
 *
 * @param directoryPath - The root directory to analyze
 * @param schemaManifestService - Service for looking up schema CIDs by label (required)
 * @returns Array of datagroup file information from all subdirectories
 */
export async function analyzeDatagroupFilesRecursive(
  directoryPath: string,
  schemaManifestService: SchemaManifestService
): Promise<DatagroupFile[]> {
  const allDatagroupFiles: DatagroupFile[] = [];

  // Ensure the schema manifest is loaded
  await schemaManifestService.loadSchemaManifest();

  async function walkDirectory(currentPath: string) {
    const entries = await fsPromises.readdir(currentPath, {
      withFileTypes: true,
    });

    // Process files in current directory
    const filesInDir = await analyzeDatagroupFiles(
      currentPath,
      schemaManifestService
    );
    allDatagroupFiles.push(...filesInDir);

    // Recursively process subdirectories
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const subPath = path.join(currentPath, entry.name);
        await walkDirectory(subPath);
      }
    }
  }

  await walkDirectory(directoryPath);
  return allDatagroupFiles;
}
