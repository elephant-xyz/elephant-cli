import { promises as fsPromises } from 'fs';
import path from 'path';
import { SchemaManifestService } from './schema-manifest.service.js';
import {
  analyzeDatagroupFiles,
  DatagroupFile,
} from '../utils/datagroup-analyzer.js';
import { logger } from '../utils/logger.js';
import { getFactSheetCommitHash } from '../utils/fact-sheet.js';

interface ClassMapping {
  fileName: string;
  className: string;
}

interface ClassSchema {
  title: string;
  [key: string]: any;
}

interface DataGroupSchema {
  properties: {
    relationships: {
      properties: {
        [key: string]: {
          cid?: string;
          type?: string | string[];
          description?: string;
        };
      };
    };
  };
}

export class FactSheetRelationshipService {
  private readonly schemaManifestService: SchemaManifestService;
  private readonly ipfsGateway: string;
  private schemaCache: Map<string, any> = new Map();

  constructor(
    schemaManifestService: SchemaManifestService,
    ipfsGateway: string = 'https://gateway.pinata.cloud/ipfs'
  ) {
    this.schemaManifestService = schemaManifestService;
    this.ipfsGateway = ipfsGateway.endsWith('/')
      ? ipfsGateway.slice(0, -1)
      : ipfsGateway;
  }

  /**
   * Generate fact_sheet.json file
   */
  async generateFactSheetFile(outputDir: string): Promise<void> {
    const factSheetPath = path.join(outputDir, 'fact_sheet.json');

    // Get the commit hash of the fact-sheet tool
    const commitHash = getFactSheetCommitHash();

    // Build the full generation command
    let fullCommand: string | null = null;
    if (commitHash) {
      fullCommand = `npx -y git+https://github.com/elephant-xyz/fact-sheet-template.git#${commitHash} generate --input \${inputDir} --output \${outputDir} --inline-js --inline-css --inline-svg`;
    }

    const factSheetContent: {
      ipfs_url: string;
      full_generation_command: string | null;
    } = {
      ipfs_url: './index.html',
      full_generation_command: fullCommand,
    };

    await fsPromises.writeFile(
      factSheetPath,
      JSON.stringify(factSheetContent, null, 2),
      'utf-8'
    );

    logger.info(`Generated fact_sheet.json file at ${factSheetPath}`);
    if (fullCommand) {
      logger.debug(`Full generation command: ${fullCommand}`);
    } else {
      logger.debug(
        'Could not determine fact-sheet tool version for generation command'
      );
    }
  }

  /**
   * Fetch schema from IPFS with caching
   */
  private async fetchSchema(cid: string): Promise<any> {
    if (this.schemaCache.has(cid)) {
      return this.schemaCache.get(cid);
    }

    const url = `${this.ipfsGateway}/${cid}`;
    logger.debug(`Fetching schema from IPFS: ${cid}`);

    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'elephant-cli/1.0',
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const schema = await response.json();
      logger.debug(
        `Fetched schema ${cid}, type: ${schema.$schema ? 'JSON Schema' : 'unknown'}, has properties: ${!!schema.properties}`
      );

      // Check if this looks like a proper schema
      if (!schema || typeof schema !== 'object') {
        throw new Error(`Invalid schema format for ${cid}`);
      }

      this.schemaCache.set(cid, schema);
      return schema;
    } catch (error) {
      logger.error(`Error fetching schema ${cid}: ${error}`);
      throw error;
    }
  }

  /**
   * Process a single datagroup and collect class mappings
   */
  private async processDatagroup(
    datagroupFile: DatagroupFile,
    outputDir: string
  ): Promise<ClassMapping[]> {
    const classMappings: ClassMapping[] = [];

    try {
      // Read the datagroup file
      const datagroupContent = JSON.parse(
        await fsPromises.readFile(datagroupFile.filePath, 'utf-8')
      );

      // Fetch the datagroup schema
      const datagroupSchema: DataGroupSchema = await this.fetchSchema(
        datagroupFile.dataGroupCid
      );

      if (!datagroupSchema.properties?.relationships?.properties) {
        logger.warn(
          `Datagroup schema ${datagroupFile.dataGroupCid} has no relationships properties`
        );
        return classMappings;
      }

      // Process each relationship in the datagroup
      for (const [relName, relValue] of Object.entries(
        datagroupContent.relationships || {}
      )) {
        if (relValue === null || relValue === undefined) {
          continue;
        }

        // Get the relationship schema CID from datagroup schema
        const relSchemaSpec =
          datagroupSchema.properties.relationships.properties[relName];
        if (!relSchemaSpec?.cid) {
          logger.debug(
            `No CID found for relationship ${relName} in datagroup schema, processing data directly`
          );
          // For relationships without schema CID (like property_has_tax, property_has_sales_history),
          // we'll process the actual relationship files to extract class mappings
          await this.extractFileMappingsWithoutSchema(
            relValue,
            relName,
            classMappings,
            outputDir
          );
          continue;
        }

        const relationshipSchemaCid = relSchemaSpec.cid;

        // Fetch the relationship schema
        const relationshipSchema = await this.fetchSchema(
          relationshipSchemaCid
        );

        // The relationship schema has properties.from.cid and properties.to.cid structure
        const fromCid = relationshipSchema?.properties?.from?.cid;
        const toCid = relationshipSchema?.properties?.to?.cid;

        // Validate relationship schema structure
        if (!fromCid || !toCid) {
          logger.debug(
            `Relationship schema ${relationshipSchemaCid} missing from/to cid properties. Structure: ${JSON.stringify(relationshipSchema)}`
          );
          continue;
        }

        // Fetch the "from" and "to" class schemas
        const fromClassSchema: ClassSchema = await this.fetchSchema(fromCid);
        const toClassSchema: ClassSchema = await this.fetchSchema(toCid);

        const fromClassName = fromClassSchema.title;
        const toClassName = toClassSchema.title;

        // Process the relationship value to find file references
        logger.debug(
          `Processing relationship ${relName} with from=${fromClassName}, to=${toClassName}`
        );
        await this.extractFileMappings(
          relValue,
          fromClassName,
          toClassName,
          classMappings,
          outputDir
        );
      }

      return classMappings;
    } catch (error) {
      logger.error(
        `Error processing datagroup ${datagroupFile.fileName}: ${error}`
      );
      return classMappings;
    }
  }

  /**
   * Extract file mappings from relationship values without schema
   * This is used for relationships like property_has_tax where there's no schema CID
   */
  private async extractFileMappingsWithoutSchema(
    relValue: any,
    relName: string,
    classMappings: ClassMapping[],
    outputDir: string
  ): Promise<void> {
    logger.debug(
      `extractFileMappingsWithoutSchema called for ${relName} with relValue: ${JSON.stringify(relValue)}`
    );

    // Derive class names from relationship name
    // e.g., "property_has_tax" -> fromClass: "property", toClass: "tax"
    // e.g., "property_has_sales_history" -> fromClass: "property", toClass: "sales_history"
    const parts = relName.split('_has_');
    const fromClassName = parts[0] || 'unknown';
    const toClassName = parts[1] || 'unknown';

    // Process the relationship value to extract files
    await this.extractFileMappings(
      relValue,
      fromClassName,
      toClassName,
      classMappings,
      outputDir
    );
  }

  /**
   * Extract file mappings from relationship values
   */
  private async extractFileMappings(
    relValue: any,
    fromClassName: string,
    toClassName: string,
    classMappings: ClassMapping[],
    outputDir: string
  ): Promise<void> {
    logger.debug(
      `extractFileMappings called with relValue: ${JSON.stringify(relValue)}`
    );
    if (Array.isArray(relValue)) {
      // Process array of relationships - check this FIRST
      for (const item of relValue) {
        await this.extractFileMappings(
          item,
          fromClassName,
          toClassName,
          classMappings,
          outputDir
        );
      }
    } else if (typeof relValue === 'object' && relValue !== null) {
      // Check if it's a direct file reference
      if ('/' in relValue && typeof relValue['/'] === 'string') {
        const filePath = relValue['/'];
        logger.debug(`Found file reference: ${filePath}`);
        if (filePath.startsWith('./')) {
          await this.addMappingFromFile(
            filePath,
            fromClassName,
            toClassName,
            classMappings,
            outputDir
          );
        }
      } else if ('from' in relValue || 'to' in relValue) {
        // It's a relationship object with from/to
        if (
          relValue.from &&
          typeof relValue.from === 'object' &&
          '/' in relValue.from
        ) {
          const fromPath = relValue.from['/'];
          if (fromPath && fromPath.startsWith('./')) {
            const fileName = path.basename(fromPath);
            if (!classMappings.some((m) => m.fileName === fileName)) {
              classMappings.push({ fileName, className: fromClassName });
            }
          }
        }
        if (
          relValue.to &&
          typeof relValue.to === 'object' &&
          '/' in relValue.to
        ) {
          const toPath = relValue.to['/'];
          if (toPath && toPath.startsWith('./')) {
            const fileName = path.basename(toPath);
            if (!classMappings.some((m) => m.fileName === fileName)) {
              classMappings.push({ fileName, className: toClassName });
            }
          }
        }
      }
    }
  }

  /**
   * Read relationship file and add mappings based on from/to references
   */
  private async addMappingFromFile(
    filePath: string,
    fromClassName: string,
    toClassName: string,
    classMappings: ClassMapping[],
    outputDir: string
  ): Promise<void> {
    const fullPath = path.join(outputDir, path.basename(filePath));
    logger.debug(`addMappingFromFile: Reading ${fullPath}`);

    try {
      const content = JSON.parse(await fsPromises.readFile(fullPath, 'utf-8'));
      logger.debug(
        `Content of ${path.basename(filePath)}: ${JSON.stringify(content)}`
      );

      if (
        content.from &&
        typeof content.from === 'object' &&
        '/' in content.from
      ) {
        const fromPath = content.from['/'];
        if (fromPath && fromPath.startsWith('./')) {
          const fileName = path.basename(fromPath);
          if (!classMappings.some((m) => m.fileName === fileName)) {
            classMappings.push({ fileName, className: fromClassName });
            logger.debug(`Added mapping: ${fileName} -> ${fromClassName}`);
          } else {
            logger.debug(`Mapping already exists for ${fileName}`);
          }
        }
      }

      if (content.to && typeof content.to === 'object' && '/' in content.to) {
        const toPath = content.to['/'];
        if (toPath && toPath.startsWith('./')) {
          const fileName = path.basename(toPath);
          if (!classMappings.some((m) => m.fileName === fileName)) {
            classMappings.push({ fileName, className: toClassName });
            logger.debug(`Added mapping: ${fileName} -> ${toClassName}`);
          } else {
            logger.debug(`Mapping already exists for ${fileName}`);
          }
        }
      }
    } catch (error) {
      logger.debug(`Could not read relationship file ${fullPath}: ${error}`);
    }
  }

  /**
   * Generate relationship files from classes to fact_sheet
   */
  private async generateFactSheetRelationshipFiles(
    classMappings: ClassMapping[],
    outputDir: string
  ): Promise<Map<string, string>> {
    const newRelationshipFiles = new Map<string, string>();

    logger.debug(
      `Generating fact_sheet relationships for ${classMappings.length} class mappings`
    );
    for (const mapping of classMappings) {
      const baseFileName = mapping.fileName.replace('.json', '');
      const relationshipFileName = `relationship_${baseFileName}_to_fact_sheet.json`;
      const relationshipPath = path.join(outputDir, relationshipFileName);

      const relationshipContent = {
        from: {
          '/': `./${mapping.fileName}`,
        },
        to: {
          '/': './fact_sheet.json',
        },
      };

      await fsPromises.writeFile(
        relationshipPath,
        JSON.stringify(relationshipContent, null, 2),
        'utf-8'
      );

      logger.debug(`Generated relationship file: ${relationshipFileName}`);

      // Map class name to relationship file
      const relationshipKey = `${mapping.className}_has_fact_sheet`;
      newRelationshipFiles.set(relationshipKey, relationshipFileName);
    }

    return newRelationshipFiles;
  }

  /**
   * Update datagroup files with new fact_sheet relationships
   */
  private async updateDatagroupFiles(
    datagroupFiles: DatagroupFile[],
    classMappings: ClassMapping[],
    _newRelationshipFiles: Map<string, string>
  ): Promise<void> {
    // Create a map of class names that have fact_sheet relationships
    const classesWithFactSheet = new Set(classMappings.map((m) => m.className));

    for (const datagroupFile of datagroupFiles) {
      const content = JSON.parse(
        await fsPromises.readFile(datagroupFile.filePath, 'utf-8')
      );

      let hasUpdates = false;

      // Add fact_sheet relationships for ALL classes found in classMappings
      for (const className of classesWithFactSheet) {
        const relationshipKey = `${className}_has_fact_sheet`;

        // Check if this relationship already exists
        if (!content.relationships[relationshipKey]) {
          // Find all files for this class (there might be multiple, e.g., tax_1, tax_2, etc.)
          const classMappingsForClass = classMappings.filter(
            (m) => m.className === className
          );

          // Always create an array, even for single relationships
          const relationshipArray = classMappingsForClass.map((mapping) => {
            const baseFileName = mapping.fileName.replace('.json', '');
            const relationshipFileName = `relationship_${baseFileName}_to_fact_sheet.json`;
            return {
              '/': `./${relationshipFileName}`,
            };
          });

          content.relationships[relationshipKey] = relationshipArray;
          hasUpdates = true;
          logger.debug(
            `Added ${relationshipKey} array with ${relationshipArray.length} item(s) to ${datagroupFile.fileName}`
          );
        }
      }

      // Write back the updated content if there were changes
      if (hasUpdates) {
        await fsPromises.writeFile(
          datagroupFile.filePath,
          JSON.stringify(content, null, 2),
          'utf-8'
        );
        logger.info(
          `Updated datagroup file ${datagroupFile.fileName} with fact_sheet relationships`
        );
      }
    }
  }

  /**
   * Check if a datagroup already has fact sheet relationships
   */
  private async hasExistingFactSheetRelationships(
    datagroupFile: DatagroupFile
  ): Promise<boolean> {
    try {
      const content = JSON.parse(
        await fsPromises.readFile(datagroupFile.filePath, 'utf-8')
      );

      if (!content.relationships) {
        return false;
      }

      // Check if any relationship key ends with "_has_fact_sheet"
      const hasFactSheetRelationship = Object.keys(content.relationships).some(
        (key) => key.endsWith('_has_fact_sheet')
      );

      if (hasFactSheetRelationship) {
        logger.info(
          `Datagroup ${datagroupFile.fileName} already has fact_sheet relationships, skipping processing`
        );
      }

      return hasFactSheetRelationship;
    } catch (error) {
      logger.error(
        `Error checking datagroup ${datagroupFile.fileName}: ${error}`
      );
      return false;
    }
  }

  /**
   * Main method to generate all fact_sheet relationships
   */
  async generateFactSheetRelationships(outputDir: string): Promise<void> {
    logger.info('Generating fact_sheet relationships...');

    // Always generate fact_sheet.json first
    try {
      await this.generateFactSheetFile(outputDir);
    } catch (error) {
      logger.error(`Failed to generate fact_sheet.json: ${error}`);
      return;
    }

    try {
      // Ensure schema manifest is loaded
      await this.schemaManifestService.loadSchemaManifest();
    } catch (error) {
      logger.error(`Failed to load schema manifest: ${error}`);
      // fact_sheet.json already created, just return
      return;
    }

    try {
      // Step 2: Find all datagroup files
      const datagroupFiles = await analyzeDatagroupFiles(
        outputDir,
        this.schemaManifestService
      );
      logger.info(`Found ${datagroupFiles.length} datagroup files`);

      // Filter out datagroups that already have fact sheet relationships
      const datagroupsToProcess: DatagroupFile[] = [];
      for (const datagroupFile of datagroupFiles) {
        const hasExisting =
          await this.hasExistingFactSheetRelationships(datagroupFile);
        if (!hasExisting) {
          datagroupsToProcess.push(datagroupFile);
        }
      }

      if (datagroupsToProcess.length === 0) {
        logger.info(
          'All datagroups already have fact_sheet relationships, skipping generation'
        );
        return;
      }

      logger.info(
        `Processing ${datagroupsToProcess.length} datagroup(s) without fact_sheet relationships`
      );

      // Step 3: Process each datagroup to collect class mappings
      const allClassMappings: ClassMapping[] = [];
      for (const datagroupFile of datagroupsToProcess) {
        logger.debug(
          `Processing datagroup: ${datagroupFile.label} (${datagroupFile.fileName})`
        );
        const mappings = await this.processDatagroup(datagroupFile, outputDir);

        // Add unique mappings
        for (const mapping of mappings) {
          if (!allClassMappings.some((m) => m.fileName === mapping.fileName)) {
            allClassMappings.push(mapping);
          }
        }
      }

      logger.info(`Identified ${allClassMappings.length} unique class files`);

      // Step 4: Generate relationship files from classes to fact_sheet
      const newRelationshipFiles =
        await this.generateFactSheetRelationshipFiles(
          allClassMappings,
          outputDir
        );

      logger.info(
        `Generated ${newRelationshipFiles.size} fact_sheet relationship files`
      );

      // Step 5: Update datagroup files with new relationships (only those we processed)
      await this.updateDatagroupFiles(
        datagroupsToProcess,
        allClassMappings,
        newRelationshipFiles
      );

      logger.success('Successfully generated all fact_sheet relationships');
    } catch (error) {
      logger.error(`Error generating fact_sheet relationships: ${error}`);
      // fact_sheet.json was already created, so we can consider this a partial success
    }
  }
}
