import { writeFileSync, mkdirSync } from 'fs';
import { readdir, rm } from 'fs/promises';
import { join, dirname, basename } from 'path';
import { CID } from 'multiformats/cid';
import { logger } from '../utils/logger.js';
import { ethers, JsonRpcProvider, TransactionResponse } from 'ethers';
import { CidHexConverterService } from './cid-hex-converter.service.js';
import {
  SchemaManifestService,
  SchemaManifest,
} from './schema-manifest.service.js';
import AdmZip from 'adm-zip';
import { tmpdir } from 'os';
import { promises as fsPromises } from 'fs';

interface BatchDataItem {
  propertyHash: string;
  dataGroupHash: string;
  dataHash: string;
}

export class IPFSFetcherService {
  private readonly baseUrl: string;
  private processedCids: Set<string> = new Set();
  private cidToFilename: Map<string, string> = new Map();
  private readonly maxRetries: number = 3;
  private readonly rateLimitDelay: number = 5000; // Base delay for rate limiting
  private provider: JsonRpcProvider | null = null;
  private readonly cidHexConverter: CidHexConverterService;
  private readonly schemaManifestService: SchemaManifestService;

  constructor(
    gatewayUrl: string = 'https://gateway.pinata.cloud/ipfs',
    rpcUrl?: string
  ) {
    this.baseUrl = gatewayUrl.endsWith('/')
      ? gatewayUrl.slice(0, -1)
      : gatewayUrl;

    if (rpcUrl) {
      this.provider = new ethers.JsonRpcProvider(rpcUrl);
    }

    this.cidHexConverter = new CidHexConverterService();
    this.schemaManifestService = new SchemaManifestService();
  }

  private async loadSchemaManifest(): Promise<SchemaManifest> {
    return this.schemaManifestService.loadSchemaManifest();
  }

  private isValidCid(cid: string): boolean {
    // Basic validation for CIDv0 (starts with Qm) and CIDv1 (starts with ba)
    if (!cid || cid.length < 46) {
      return false;
    }

    // Validate using multiformats CID parser
    try {
      CID.parse(cid);
      return true;
    } catch {
      return false;
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
      logger.error(`Error fetching CID ${cid}: ${error}`);
      throw error;
    }
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
          return { '/': cidToPath.get(cid)! };
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
            newContent[key] = { '/': cidToPath.get(cid)! };
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
        filename = `${parentRel}_${parentKey}_${cid}.json`;
      } else {
        filename = `${parentRel}.json`;
      }
      logger.debug(
        `Naming file for CID ${cid}: ${filename} (parentRel: ${parentRel}, parentKey: ${parentKey})`
      );
    } else {
      // Root file: check if we have a datagroup mapping in schema manifest
      let datagroupCid: string | undefined;
      if (typeof content === 'object' && content.label) {
        // Load manifest if not already loaded
        await this.loadSchemaManifest();

        const label = content.label;
        // Try to find a matching dataGroup in the manifest
        datagroupCid =
          this.schemaManifestService.getDataGroupCidByLabel(label) ||
          this.schemaManifestService.getDataGroupCidByLabel(
            label.replace(/ /g, '_')
          ) ||
          undefined;
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

  public async fetchData(
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

    const dataDir = join(dataRoot, initialCid);
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
        const files = await readdir(dataDir);
        if (files.length === 0) {
          await rm(dataDir, { recursive: true, force: true });
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

  public async fetchFromTransaction(
    transactionHash: string,
    baseDir: string = 'data'
  ): Promise<void> {
    if (!this.provider) {
      throw new Error('RPC provider not initialized');
    }

    logger.info(`Fetching transaction: ${transactionHash}`);

    // Fetch transaction
    const tx: TransactionResponse | null =
      await this.provider.getTransaction(transactionHash);

    if (!tx) {
      throw new Error(`Transaction not found: ${transactionHash}`);
    }

    // Ensure transaction is to a contract (has data)
    if (!tx.data || tx.data === '0x') {
      throw new Error('Transaction has no input data');
    }

    logger.info(`Transaction found. Decoding input data...`);

    // Decode the transaction data
    // The submitBatchData function signature is: submitBatchData((bytes32,bytes32,bytes32)[])
    const iface = new ethers.Interface([
      {
        inputs: [
          {
            components: [
              {
                internalType: 'bytes32',
                name: 'propertyHash',
                type: 'bytes32',
              },
              {
                internalType: 'bytes32',
                name: 'dataGroupHash',
                type: 'bytes32',
              },
              { internalType: 'bytes32', name: 'dataHash', type: 'bytes32' },
            ],
            internalType: 'struct IPropertyDataConsensus.DataItem[]',
            name: 'items',
            type: 'tuple[]',
          },
        ],
        name: 'submitBatchData',
        outputs: [],
        stateMutability: 'nonpayable',
        type: 'function',
      },
    ]);

    let decodedData: BatchDataItem[];
    try {
      const decoded = iface.parseTransaction({ data: tx.data });
      if (!decoded || decoded.name !== 'submitBatchData') {
        throw new Error('Transaction is not a submitBatchData call');
      }
      decodedData = decoded.args[0].map((item: any) => ({
        propertyHash: item.propertyHash,
        dataGroupHash: item.dataGroupHash,
        dataHash: item.dataHash,
      }));
    } catch (error) {
      throw new Error(
        `Failed to decode transaction data: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    logger.info(`Found ${decodedData.length} data items in transaction`);

    // Load schema manifest
    await this.loadSchemaManifest();

    // Group items by propertyHash
    const itemsByProperty = new Map<string, BatchDataItem[]>();
    for (const item of decodedData) {
      const items = itemsByProperty.get(item.propertyHash) || [];
      items.push(item);
      itemsByProperty.set(item.propertyHash, items);
    }

    logger.info(
      `Processing ${itemsByProperty.size} unique properties from transaction`
    );

    // Process each property
    for (const [propertyHash, items] of itemsByProperty) {
      // Convert property hash to CID
      const propertyCid = this.cidHexConverter.hexToCid(propertyHash);
      logger.info(
        `\nProcessing property: ${propertyCid} (hash: ${propertyHash})`
      );
      logger.info(`  Found ${items.length} data groups`);

      // Create directory for this property
      const propertyDir = join(baseDir, propertyCid);
      mkdirSync(propertyDir, { recursive: true });

      // Process each data item for this property
      for (const item of items) {
        try {
          // Convert hashes to CIDs
          const dataGroupCid = this.cidHexConverter.hexToCid(
            item.dataGroupHash
          );
          const dataCid = this.cidHexConverter.hexToCid(item.dataHash);

          logger.info(
            `  Processing data group: ${dataGroupCid} with data: ${dataCid}`
          );

          // Fetch the data content
          const dataContent = await this.fetchContent(dataCid);
          if (!dataContent) {
            logger.warn(`  ✗ Failed to fetch data for ${dataGroupCid}`);
            continue;
          }

          // Now process any nested CIDs in the content
          this.processedCids.clear();
          this.cidToFilename.clear();
          this.processedCids.add(dataCid); // Mark the main data CID as processed

          // Track CID to file path mappings
          const cidToPath = new Map<string, string>();
          cidToPath.set(dataCid, `./${dataGroupCid}.json`);

          // Process nested CIDs if any
          if (typeof dataContent === 'object' && dataContent !== null) {
            await this.processNestedCids(dataContent, propertyDir, cidToPath);
          }

          // Replace CIDs with paths in the content
          const modifiedContent = this.replaceCidsWithPaths(
            dataContent,
            cidToPath
          );

          // Save the dataGroup file with CID references replaced by paths
          const dataGroupFilePath = join(propertyDir, `${dataGroupCid}.json`);
          writeFileSync(
            dataGroupFilePath,
            JSON.stringify(modifiedContent, null, 2),
            'utf-8'
          );
          logger.info(`  Saved: ${dataGroupFilePath}`);

          logger.info(`  ✓ Successfully processed data for ${dataGroupCid}`);
        } catch (error) {
          logger.error(
            `  Error processing item: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }
    }

    logger.info(`\nTransaction fetch complete. Data saved in: ${baseDir}/`);
  }

  private async processNestedCids(
    content: any,
    outputDir: string,
    cidToPath: Map<string, string>
  ): Promise<void> {
    // Process direct CID references (but skip 'relationships' as it's handled separately)
    for (const [key, value] of Object.entries(content)) {
      if (key === 'relationships') {
        continue; // Skip relationships here, handled separately below
      }

      if (
        typeof value === 'object' &&
        value !== null &&
        '/' in value &&
        typeof (value as any)['/'] === 'string'
      ) {
        const nestedCid = (value as any)['/'];
        if (this.isValidCid(nestedCid) && !this.processedCids.has(nestedCid)) {
          await this.processCidRecursive(
            nestedCid,
            outputDir,
            cidToPath,
            key, // Use the key as parentRel
            ''
          );
        }
      } else if (Array.isArray(value)) {
        // Process arrays that might contain CID references
        for (let idx = 0; idx < value.length; idx++) {
          const item = value[idx];
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
                outputDir,
                cidToPath,
                key,
                idx.toString()
              );
            }
          }
        }
      } else if (typeof value === 'object' && value !== null) {
        // Recursively process nested objects
        await this.processNestedCids(value, outputDir, cidToPath);
      }
    }

    // Also check relationships if present
    if (content.relationships) {
      for (const [relName, relValue] of Object.entries(content.relationships)) {
        if (typeof relValue === 'object' && relValue !== null) {
          if ('/' in relValue && typeof (relValue as any)['/'] === 'string') {
            const nestedCid = (relValue as any)['/'];
            if (
              this.isValidCid(nestedCid) &&
              !this.processedCids.has(nestedCid)
            ) {
              await this.processCidRecursive(
                nestedCid,
                outputDir,
                cidToPath,
                relName,
                ''
              );
            }
          } else {
            // Handle nested structure in relationships (e.g., {from: {"/": "CID"}, to: {"/": "CID"}})
            for (const [subKey, subValue] of Object.entries(relValue)) {
              if (
                typeof subValue === 'object' &&
                subValue !== null &&
                '/' in subValue &&
                typeof (subValue as any)['/'] === 'string'
              ) {
                const nestedCid = (subValue as any)['/'];
                if (
                  this.isValidCid(nestedCid) &&
                  !this.processedCids.has(nestedCid)
                ) {
                  await this.processCidRecursive(
                    nestedCid,
                    outputDir,
                    cidToPath,
                    relName,
                    subKey
                  );
                }
              }
            }
          }
        }
      }
    }
  }

  /**
   * Fetch data from IPFS and save it as a ZIP file
   * @param initialCid The initial CID to fetch
   * @param outputZip Path to the output ZIP file
   */
  public async fetchDataToZip(
    initialCid: string,
    outputZip: string
  ): Promise<void> {
    // Create a temporary directory for fetching data
    const tempDirBase = join(tmpdir(), 'elephant-cli-fetch-');
    const tempDir = await fsPromises.mkdtemp(tempDirBase);

    try {
      // Fetch data to the temporary directory
      const dataDir = await this.fetchData(initialCid, tempDir);

      // Create ZIP file
      logger.info(`Creating ZIP file: ${outputZip}`);
      const zip = new AdmZip();

      // Add the fetched directory to the ZIP with 'data' as the root folder
      const dirName = basename(dataDir);
      const zipRootPath = join('data', dirName);
      await this.addDirectoryToZip(zip, dataDir, zipRootPath);

      // Write the ZIP file
      zip.writeZip(outputZip);
      logger.info(`ZIP file created successfully: ${outputZip}`);
    } finally {
      // Clean up temporary directory
      try {
        await rm(tempDir, { recursive: true, force: true });
        logger.debug(`Cleaned up temporary directory: ${tempDir}`);
      } catch (error) {
        logger.warn(`Failed to clean up temporary directory: ${error}`);
      }
    }
  }

  /**
   * Fetch data from transaction and save it as a ZIP file
   * @param transactionHash The transaction hash to fetch from
   * @param outputZip Path to the output ZIP file
   */
  public async fetchFromTransactionToZip(
    transactionHash: string,
    outputZip: string
  ): Promise<void> {
    // Create a temporary directory for fetching data
    const tempDirBase = join(tmpdir(), 'elephant-cli-fetch-');
    const tempDir = await fsPromises.mkdtemp(tempDirBase);

    try {
      // Fetch data to the temporary directory
      await this.fetchFromTransaction(transactionHash, tempDir);

      // Create ZIP file
      logger.info(`Creating ZIP file: ${outputZip}`);
      const zip = new AdmZip();

      // Add all subdirectories to the ZIP under a 'data' root folder
      const entries = await readdir(tempDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const dirPath = join(tempDir, entry.name);
          const zipPath = join('data', entry.name);
          await this.addDirectoryToZip(zip, dirPath, zipPath);
        } else if (entry.isFile()) {
          // Add any files at the root level under 'data' folder
          const filePath = join(tempDir, entry.name);
          const content = await fsPromises.readFile(filePath);
          const zipPath = join('data', entry.name).replace(/\\/g, '/');
          zip.addFile(zipPath, content);
        }
      }

      // Write the ZIP file
      zip.writeZip(outputZip);
      logger.info(`ZIP file created successfully: ${outputZip}`);
    } finally {
      // Clean up temporary directory
      try {
        await rm(tempDir, { recursive: true, force: true });
        logger.debug(`Cleaned up temporary directory: ${tempDir}`);
      } catch (error) {
        logger.warn(`Failed to clean up temporary directory: ${error}`);
      }
    }
  }

  /**
   * Recursively add a directory to a ZIP file
   * @param zip The AdmZip instance
   * @param dirPath The directory path to add
   * @param zipPath The path inside the ZIP file
   */
  private async addDirectoryToZip(
    zip: AdmZip,
    dirPath: string,
    zipPath: string
  ): Promise<void> {
    const entries = await readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name);
      const entryZipPath = join(zipPath, entry.name);

      if (entry.isDirectory()) {
        // Recursively add subdirectory
        await this.addDirectoryToZip(zip, fullPath, entryZipPath);
      } else if (entry.isFile()) {
        // Add file to ZIP
        const content = await fsPromises.readFile(fullPath);
        // Convert path separators to forward slashes for ZIP compatibility
        const normalizedPath = entryZipPath.replace(/\\/g, '/');
        zip.addFile(normalizedPath, content);
        logger.debug(`Added to ZIP: ${normalizedPath}`);
      }
    }
  }
}
