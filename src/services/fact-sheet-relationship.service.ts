import { promises as fsPromises } from 'fs';
import path from 'path';
import { SchemaManifestService } from './schema-manifest.service.js';
import {
  analyzeDatagroupFiles,
  DatagroupFile,
} from '../utils/datagroup-analyzer.js';
import { logger } from '../utils/logger.js';
import { SchemaCacheService } from './schema-cache.service.js';
import * as z from 'zod';
import { getFactSheetVersion } from '../utils/fact-sheet.js';

interface ClassMapping {
  fileName: string;
  className: string;
}

type RelativePath = `./${string}`;

type IPLDLink = {
  '/': RelativePath;
};

type Relationship = {
  from: IPLDLink;
  to: IPLDLink;
};

type DataGroupContent = {
  relationships: Record<string, IPLDLink>;
};

const ClassSchema = z.object({ title: z.string() });
const RelationObjectShemaEntry = z.object({
  cid: z.string(),
});

const RelationshipArraySchema = z.object({
  items: RelationObjectShemaEntry,
});

const RelationshipSchemaEntry = z.union([
  RelationObjectShemaEntry,
  RelationshipArraySchema,
]);

const RelationshipSchema = z.object({
  properties: z.object({
    from: z.object({ cid: z.string() }),
    to: z.object({ cid: z.string() }),
  }),
});

const DataGroupSchema = z.object({
  properties: z.object({
    relationships: z.object({
      properties: z.record(RelationshipSchemaEntry),
    }),
  }),
});

export class FactSheetRelationshipService {
  private readonly schemaManifestService: SchemaManifestService;
  private readonly schemaCache: SchemaCacheService;

  constructor(
    schemaManifestService: SchemaManifestService,
    schemaCache: SchemaCacheService
  ) {
    this.schemaManifestService = schemaManifestService;
    this.schemaCache = schemaCache;
  }

  /**
   * Generate fact_sheet.json file
   */
  async generateFactSheetFile(outputDir: string): Promise<void> {
    const factSheetPath = path.join(outputDir, 'fact_sheet.json');

    const factSheetVersion = getFactSheetVersion();

    // Build the full generation command
    let fullCommand: string | null = null;
    if (factSheetVersion) {
      fullCommand = `npx -y @elephant-xyz/fact-sheet@${factSheetVersion} generate --input \${inputDir} --output \${outputDir} --inline-js --inline-css --inline-svg`;
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
   * Process a single datagroup and collect class mappings
   */
  private async processDatagroup(
    datagroupFile: DatagroupFile,
    outputDir: string
  ): Promise<ReadonlyArray<ClassMapping>> {
    const datagroupContent = JSON.parse(
      await fsPromises.readFile(datagroupFile.filePath, 'utf-8')
    ) as DataGroupContent;

    const parsedDatagroup = DataGroupSchema.safeParse(
      await this.schemaCache.get(datagroupFile.dataGroupCid)
    );

    if (!parsedDatagroup.success) {
      const message = `Datagroup schema ${datagroupFile.dataGroupCid} has invalid schema: ${JSON.stringify(
        parsedDatagroup.error.issues[0]
      )}`;
      logger.error(message);
      throw new Error(message);
    }

    const datagroupSchema = parsedDatagroup.data;

    const relationshipEntries = Object.entries(
      datagroupContent.relationships ?? {}
    ).filter(([relName]) => !relName.endsWith('fact_sheet'));

    const nestedMappings = await Promise.all(
      relationshipEntries.map(async ([relName, relValue]) => {
        const schemaEntry = datagroupSchema.properties.relationships.properties[
          relName
        ] as { cid: string } | { items: { cid: string } } | undefined;

        if (!schemaEntry) {
          const errorMessage = `No CID found for relationship ${relName} in datagroup schema, processing data directly`;
          logger.error(errorMessage);
          throw new Error(errorMessage);
        }

        const schemaCid =
          'items' in schemaEntry ? schemaEntry.items.cid : schemaEntry.cid;

        logger.info(`Fetching schema ${schemaCid} for relationship ${relName}`);
        const relationshipSchema = RelationshipSchema.parse(
          await this.schemaCache.get(schemaCid)
        );

        const [fromClassSchema, toClassSchema] = await Promise.all([
          this.schemaCache
            .get(relationshipSchema.properties.from.cid)
            .then((v) => ClassSchema.parse(v)),
          this.schemaCache
            .get(relationshipSchema.properties.to.cid)
            .then((v) => ClassSchema.parse(v)),
        ]);

        const fromClassName = fromClassSchema.title;
        const toClassName = toClassSchema.title;

        const relationships = Array.isArray(relValue) ? relValue : [relValue];

        const perRelMappings = await Promise.all(
          relationships.map(async (rel) => {
            const { from, to } = await this.extractFileNamesFromRelationship(
              rel,
              outputDir
            );

            return [
              { fileName: from, className: fromClassName } as const,
              { fileName: to, className: toClassName } as const,
            ];
          })
        );

        return perRelMappings.flat();
      })
    );

    const result: ReadonlyArray<ClassMapping> = nestedMappings.flat();
    return result;
  }

  private async extractFileNamesFromRelationship(
    relValue: IPLDLink,
    outputDir: string
  ): Promise<{ from: string; to: string }> {
    const relPath = relValue['/'];
    const relContent = JSON.parse(
      await fsPromises.readFile(path.join(outputDir, relPath), 'utf-8')
    ) as Relationship;
    return {
      from: relContent.from['/'].substring(2),
      to: relContent.to['/'].substring(2),
    };
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

      // Ensure relationships object exists to avoid runtime errors on legacy files
      if (
        !content.relationships ||
        typeof content.relationships !== 'object' ||
        Array.isArray(content.relationships)
      ) {
        content.relationships = {};
      }

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

      // Step 3: Process each datagroup to collect class mappings
      const allClassMappings: ClassMapping[] = [];
      for (const datagroupFile of datagroupFiles) {
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

      // Step 5: Update datagroup files with new relationships
      await this.updateDatagroupFiles(
        datagroupFiles,
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
