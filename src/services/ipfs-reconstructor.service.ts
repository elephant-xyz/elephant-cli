import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { CID } from 'multiformats/cid';
import { logger } from '../utils/logger.js';

interface SchemaManifestItem {
  ipfsCid: string;
  type: 'class' | 'relationship' | 'dataGroup';
}

interface SchemaManifest {
  [key: string]: SchemaManifestItem;
}

export class IPFSReconstructorService {
  private readonly baseUrl: string;
  private processedCids: Set<string> = new Set();
  private cidToFilename: Map<string, string> = new Map();
  private schemaManifest: SchemaManifest | null = null;
  private readonly maxRetries: number = 3;
  private readonly rateLimitDelay: number = 5000; // Base delay for rate limiting
  private readonly schemaManifestUrl: string =
    'https://lexicon.elephant.xyz/json-schemas/schema-manifest.json';

  constructor(gatewayUrl: string = 'https://gateway.pinata.cloud/ipfs') {
    this.baseUrl = gatewayUrl.endsWith('/')
      ? gatewayUrl.slice(0, -1)
      : gatewayUrl;
  }

  private async loadSchemaManifest(): Promise<void> {
    if (this.schemaManifest) {
      return; // Already loaded
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
    } catch (error) {
      logger.error(`Failed to load schema manifest: ${error}`);
      throw new Error('Failed to load schema manifest from Elephant Network');
    }
  }

  private isValidCid(cid: string): boolean {
    // Basic validation for CIDv0 (starts with Qm) and CIDv1 (starts with ba)
    if (!cid || cid.length < 46) {
      return false;
    }

    // Additional validation using multiformats
    try {
      CID.parse(cid);
      return true;
    } catch {
      // Fallback to basic validation
      return cid.startsWith('Qm') || cid.startsWith('ba');
    }
  }

  private async fetchContent(cid: string, attempt: number = 0): Promise<any> {
    const url = `${this.baseUrl}/${cid}`;

    try {
      logger.debug(
        `Fetching CID ${cid} from ${url} (attempt ${attempt + 1}/${this.maxRetries})`
      );

      // Create AbortController for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'elephant-cli/1.0',
        },
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        if (response.status === 429 && attempt < this.maxRetries - 1) {
          // Rate limited - exponential backoff
          const waitTime = this.rateLimitDelay * Math.pow(2, attempt);
          logger.warn(
            `Rate limited. Waiting ${waitTime / 1000} seconds before retry...`
          );
          await new Promise((resolve) => setTimeout(resolve, waitTime));
          return this.fetchContent(cid, attempt + 1);
        }
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const content = await response.json();
      return content;
    } catch (error) {
      if (
        attempt < this.maxRetries - 1 &&
        error instanceof Error &&
        error.message.includes('429')
      ) {
        const waitTime = this.rateLimitDelay * Math.pow(2, attempt);
        logger.warn(
          `Rate limited. Waiting ${waitTime / 1000} seconds before retry...`
        );
        await new Promise((resolve) => setTimeout(resolve, waitTime));
        return this.fetchContent(cid, attempt + 1);
      }

      logger.error(`Error fetching CID ${cid}: ${error}`);
      throw error;
    }
  }

  private findCidsInContent(content: any): Set<string> {
    const cids = new Set<string>();
    const contentStr = JSON.stringify(content);

    // Find CIDs in the format {"/": "cid"}
    const regex = /"(\/?)"\s*:\s*"([a-zA-Z0-9]{46,59})"/g;
    let match;

    while ((match = regex.exec(contentStr)) !== null) {
      const potentialCid = match[2];
      if (this.isValidCid(potentialCid)) {
        cids.add(potentialCid);
      }
    }

    return cids;
  }

  private replaceCidsWithPaths(
    content: any,
    cidToPath: Map<string, string>
  ): any {
    if (content === null || content === undefined) {
      return content;
    }

    if (typeof content === 'object' && !Array.isArray(content)) {
      // Check if this is a CID reference pattern {"/": "cid"}
      if (
        '/' in content &&
        typeof content['/'] === 'string' &&
        Object.keys(content).length === 1
      ) {
        const cid = content['/'];
        if (cidToPath.has(cid)) {
          return { path: cidToPath.get(cid)! };
        }
        return content;
      }

      // Process each key-value pair
      const newContent: any = {};
      for (const [key, value] of Object.entries(content)) {
        if (
          typeof value === 'object' &&
          value !== null &&
          '/' in value &&
          typeof (value as any)['/'] === 'string' &&
          Object.keys(value).length === 1
        ) {
          const cid = (value as any)['/'];
          if (cidToPath.has(cid)) {
            newContent[key] = { path: cidToPath.get(cid)! };
          } else {
            newContent[key] = value;
          }
        } else if (typeof value === 'object') {
          newContent[key] = this.replaceCidsWithPaths(value, cidToPath);
        } else {
          newContent[key] = value;
        }
      }
      return newContent;
    } else if (Array.isArray(content)) {
      return content.map((item) => this.replaceCidsWithPaths(item, cidToPath));
    }

    return content;
  }

  private async processCidRecursive(
    cid: string,
    dataDir: string,
    cidToPath: Map<string, string>,
    parentRel?: string,
    parentKey?: string
  ): Promise<string | null> {
    if (this.processedCids.has(cid)) {
      return cidToPath.get(cid) || null;
    }

    this.processedCids.add(cid);

    // Fetch content
    logger.info(`Fetching CID: ${cid}`);
    let content: any;
    try {
      content = await this.fetchContent(cid);
    } catch (error) {
      logger.error(`Failed to fetch CID ${cid}: ${error}`);
      return null;
    }

    // Determine filename
    let filename: string;
    if (parentRel) {
      // Child file: use parent relationship and key
      if (parentKey) {
        filename = `${parentRel}_${parentKey}.json`;
      } else {
        filename = `${parentRel}.json`;
      }
    } else {
      // Root file: check if we have a datagroup mapping in schema manifest
      let datagroupCid: string | undefined;
      if (typeof content === 'object' && content.label && this.schemaManifest) {
        const label = content.label;
        // Try to find a matching dataGroup in the manifest
        const manifestEntry = Object.entries(this.schemaManifest).find(
          ([key, item]) => {
            // Match by converting key to label format (e.g., "Photo_Metadata" -> "Photo Metadata")
            const normalizedKey = key.replace(/_/g, ' ');
            return item.type === 'dataGroup' && normalizedKey === label;
          }
        );

        if (manifestEntry) {
          datagroupCid = manifestEntry[1].ipfsCid;
        }
      }

      if (datagroupCid) {
        filename = `${datagroupCid}.json`;
      } else {
        filename = `${cid}.json`;
      }
    }

    // Store the mapping
    this.cidToFilename.set(cid, filename);

    // Process nested CIDs with their relationship context
    if (typeof content === 'object' && content !== null) {
      // Check for relationships
      if (content.relationships) {
        for (const [relName, relValue] of Object.entries(
          content.relationships
        )) {
          if (typeof relValue === 'object' && relValue !== null) {
            // Check if it's a direct CID reference
            if ('/' in relValue && typeof (relValue as any)['/'] === 'string') {
              const nestedCid = (relValue as any)['/'];
              if (
                this.isValidCid(nestedCid) &&
                !this.processedCids.has(nestedCid)
              ) {
                await this.processCidRecursive(
                  nestedCid,
                  dataDir,
                  cidToPath,
                  relName,
                  ''
                );
              }
            } else {
              // Check nested structure
              for (const [key, value] of Object.entries(relValue)) {
                if (
                  typeof value === 'object' &&
                  value !== null &&
                  '/' in value &&
                  typeof (value as any)['/'] === 'string'
                ) {
                  const nestedCid = (value as any)['/'];
                  if (
                    this.isValidCid(nestedCid) &&
                    !this.processedCids.has(nestedCid)
                  ) {
                    await this.processCidRecursive(
                      nestedCid,
                      dataDir,
                      cidToPath,
                      relName,
                      key
                    );
                  }
                }
              }
            }
          } else if (Array.isArray(relValue)) {
            for (let idx = 0; idx < relValue.length; idx++) {
              const item = relValue[idx];
              if (
                typeof item === 'object' &&
                item !== null &&
                '/' in item &&
                typeof item['/'] === 'string'
              ) {
                const nestedCid = item['/'];
                if (
                  this.isValidCid(nestedCid) &&
                  !this.processedCids.has(nestedCid)
                ) {
                  await this.processCidRecursive(
                    nestedCid,
                    dataDir,
                    cidToPath,
                    relName,
                    idx.toString()
                  );
                }
              }
            }
          }
        }
      }

      // Also check for direct CID references in the content
      for (const [key, value] of Object.entries(content)) {
        if (key !== 'relationships') {
          if (
            typeof value === 'object' &&
            value !== null &&
            '/' in value &&
            typeof (value as any)['/'] === 'string'
          ) {
            const nestedCid = (value as any)['/'];
            if (
              this.isValidCid(nestedCid) &&
              !this.processedCids.has(nestedCid)
            ) {
              // Use the parent's filename (without .json) as relationship name
              const parentName =
                parentRel || filename.replace('.json', '') || 'root';
              await this.processCidRecursive(
                nestedCid,
                dataDir,
                cidToPath,
                parentName,
                key
              );
            }
          }
        }
      }
    }

    // Save to file
    const filePath = join(dataDir, filename);
    const relativePath = `./${filename}`;
    cidToPath.set(cid, relativePath);

    // Replace CIDs with paths
    const modifiedContent = this.replaceCidsWithPaths(content, cidToPath);

    // Ensure directory exists
    mkdirSync(dirname(filePath), { recursive: true });

    // Write the file
    writeFileSync(filePath, JSON.stringify(modifiedContent, null, 2), 'utf-8');
    logger.info(`Saved: ${filePath}`);

    return relativePath;
  }

  public async reconstructData(
    initialCid: string,
    baseDir?: string
  ): Promise<string> {
    // Validate CID
    if (!this.isValidCid(initialCid)) {
      throw new Error(`Invalid IPFS CID: ${initialCid}`);
    }

    // Load schema manifest
    await this.loadSchemaManifest();

    // Create data directory
    const dataRoot = baseDir || 'data';
    mkdirSync(dataRoot, { recursive: true });

    const dataDir = join(dataRoot, `data_${initialCid}`);
    mkdirSync(dataDir, { recursive: true });
    logger.info(`Created directory: ${dataDir}`);

    // Track CID to file path mappings
    const cidToPath = new Map<string, string>();

    // Reset state for new reconstruction
    this.processedCids.clear();
    this.cidToFilename.clear();

    // Process recursively
    const result = await this.processCidRecursive(
      initialCid,
      dataDir,
      cidToPath
    );

    // Check if processing succeeded
    if (!result) {
      // Clean up empty directory
      try {
        const fs = await import('fs/promises');
        const files = await fs.readdir(dataDir);
        if (files.length === 0) {
          await fs.rmdir(dataDir);
          logger.info(`Removed empty directory: ${dataDir}`);
        }
      } catch (error) {
        logger.warn(`Could not clean up directory: ${error}`);
      }
      throw new Error(`Failed to fetch initial CID: ${initialCid}`);
    }

    logger.info(`Processing complete. Data saved in: ${dataDir}`);
    logger.info(`Total CIDs processed: ${this.processedCids.size}`);

    return dataDir;
  }
}
