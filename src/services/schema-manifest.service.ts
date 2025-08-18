import { logger } from '../utils/logger.js';

interface SchemaManifestItem {
  ipfsCid: string;
  type: 'class' | 'relationship' | 'dataGroup';
}

export interface SchemaManifest {
  [key: string]: SchemaManifestItem;
}

export class SchemaManifestService {
  private schemaManifest: SchemaManifest | null = null;
  private readonly schemaManifestUrl: string =
    'https://lexicon.elephant.xyz/json-schemas/schema-manifest.json';

  async loadSchemaManifest(): Promise<SchemaManifest> {
    if (this.schemaManifest) {
      return this.schemaManifest;
    }

    try {
      logger.info('Fetching schema manifest from Elephant Network...');
      const response = await fetch(this.schemaManifestUrl);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      this.schemaManifest = await response.json();

      const dataGroups = Object.entries(this.schemaManifest!).filter(
        ([_, item]) => item.type === 'dataGroup'
      ).length;

      logger.info(
        `Loaded schema manifest with ${Object.keys(this.schemaManifest!).length} entries (${dataGroups} dataGroups)`
      );

      return this.schemaManifest!;
    } catch (error) {
      logger.error(`Failed to load schema manifest: ${error}`);
      throw new Error('Failed to load schema manifest from Elephant Network');
    }
  }

  /**
   * Get the CID for a datagroup by its label
   * @param label The label of the datagroup
   * @returns The CID of the datagroup or null if not found
   */
  getDataGroupCidByLabel(label: string): string | null {
    if (!this.schemaManifest) {
      throw new Error(
        'Schema manifest not loaded. Call loadSchemaManifest() first.'
      );
    }

    const item = this.schemaManifest[label];
    if (!item) {
      return null;
    }
    if (item.type !== 'dataGroup') {
      return null;
    }
    return item.ipfsCid;
  }

  /**
   * Check if a data object is a datagroup root file by its structure
   * @param data The data object to check
   * @returns True if it matches the datagroup structure
   */
  static isDataGroupRootFile(data: any): boolean {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return false;
    }

    const keys = Object.keys(data);

    // Check if it has exactly 2 keys: "label" and "relationships"
    return (
      keys.length === 2 &&
      keys.includes('label') &&
      keys.includes('relationships') &&
      typeof data.label === 'string' &&
      typeof data.relationships === 'object' &&
      data.relationships !== null
    );
  }
}
