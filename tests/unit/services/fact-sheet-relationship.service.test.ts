import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fsPromises } from 'fs';
import path from 'path';
import { tmpdir } from 'os';
import { FactSheetRelationshipService } from '../../../src/services/fact-sheet-relationship.service.js';
import { SchemaManifestService } from '../../../src/services/schema-manifest.service.js';
import {
  SchemaCacheService,
  type JSONSchema,
} from '../../../src/services/schema-cache.service.js';
import * as factSheetUtils from '../../../src/utils/fact-sheet.js';

describe('FactSheetRelationshipService', () => {
  let tempDir: string;
  let schemaManifestService: SchemaManifestService;
  let schemaCache: SchemaCacheService;
  let service: FactSheetRelationshipService;

  // Mock data
  const mockSchemaManifest = {
    County: { ipfsCid: 'bafkreicountyschema', type: 'dataGroup' },
    property: { ipfsCid: 'bafkreipropertyclass', type: 'class' },
    address: { ipfsCid: 'bafkreiaddressclass', type: 'class' },
  };

  const mockDatagroupSchema: JSONSchema = {
    properties: {
      label: { type: 'string' },
      relationships: {
        properties: {
          property_has_address: {
            cid: 'bafkreirelationshipschema',
            type: 'string',
          },
        },
      },
    },
    type: 'object',
  } as unknown as JSONSchema;

  const mockRelationshipSchema: JSONSchema = {
    properties: {
      from: {
        cid: 'bafkreipropertyclass',
        description: 'Reference to property class',
        type: 'string',
      },
      to: {
        cid: 'bafkreiaddressclass',
        description: 'Reference to address class',
        type: 'string',
      },
    },
    type: 'object',
  } as unknown as JSONSchema;

  const mockPropertyClassSchema: JSONSchema = {
    title: 'property',
    type: 'object',
    properties: {},
  };

  const mockAddressClassSchema: JSONSchema = {
    title: 'address',
    type: 'object',
    properties: {},
  };

  beforeEach(async () => {
    // Create temporary directory
    const tempDirBase = path.join(tmpdir(), 'elephant-cli-test-');
    tempDir = await fsPromises.mkdtemp(tempDirBase);

    // Initialize services
    schemaManifestService = new SchemaManifestService();
    schemaCache = new SchemaCacheService(path.join(tempDir, 'cache'));

    // Mock schema manifest loading
    vi.spyOn(schemaManifestService, 'loadSchemaManifest').mockResolvedValue(
      mockSchemaManifest as any
    );
    vi.spyOn(
      schemaManifestService,
      'getDataGroupCidByLabel'
    ).mockImplementation((label) => {
      return label === 'County' ? 'bafkreicountyschema' : null;
    });

    // Mock getFactSheetCommitHash to return a test commit hash
    vi.spyOn(factSheetUtils, 'getFactSheetVersion').mockReturnValue('1.2.3');

    // Create service and mock schema cache
    service = new FactSheetRelationshipService(
      schemaManifestService,
      schemaCache
    );
    vi.spyOn(schemaCache, 'get').mockImplementation(async (cid: string) => {
      if (cid === 'bafkreicountyschema') return mockDatagroupSchema;
      if (cid === 'bafkreirelationshipschema') return mockRelationshipSchema;
      if (cid === 'bafkreipropertyclass') return mockPropertyClassSchema;
      if (cid === 'bafkreiaddressclass') return mockAddressClassSchema;
      throw new Error(`Unknown CID requested in test: ${cid}`);
    });
  });

  afterEach(async () => {
    // Clean up temporary directory
    try {
      await fsPromises.rm(tempDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
    vi.restoreAllMocks();
  });

  describe('generateFactSheetFile', () => {
    it('should create fact_sheet.json with correct content', async () => {
      await service.generateFactSheetFile(tempDir);

      const factSheetPath = path.join(tempDir, 'fact_sheet.json');
      const exists = await fsPromises
        .access(factSheetPath)
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(true);

      const content = JSON.parse(
        await fsPromises.readFile(factSheetPath, 'utf-8')
      );
      expect(content).toEqual({
        ipfs_url: './index.html',
        full_generation_command:
          'npx -y @elephant-xyz/fact-sheet@1.2.3 generate --input ${inputDir} --output ${outputDir} --inline-js --inline-css --inline-svg',
      });
    });

    it('should handle null commit hash gracefully', async () => {
      // Mock getFactSheetCommitHash to return null
      vi.spyOn(factSheetUtils, 'getFactSheetVersion').mockReturnValue(null);

      await service.generateFactSheetFile(tempDir);

      const factSheetPath = path.join(tempDir, 'fact_sheet.json');
      const content = JSON.parse(
        await fsPromises.readFile(factSheetPath, 'utf-8')
      );
      expect(content).toEqual({
        ipfs_url: './index.html',
        full_generation_command: null,
      });
    });
  });

  describe('generateFactSheetRelationships', () => {
    beforeEach(async () => {
      // Create sample data files
      const countyDatagroup = {
        label: 'County',
        relationships: {
          property_has_address: {
            '/': './relationship_property_address.json',
          },
        },
      };

      const relationshipFile = {
        from: {
          '/': './property.json',
        },
        to: {
          '/': './address.json',
        },
      };

      const propertyFile = {
        id: '123',
        type: 'residential',
      };

      const addressFile = {
        street: '123 Main St',
        city: 'Example City',
      };

      // Write files to temp directory
      await fsPromises.writeFile(
        path.join(tempDir, 'bafkreicountyschema.json'),
        JSON.stringify(countyDatagroup, null, 2)
      );

      await fsPromises.writeFile(
        path.join(tempDir, 'relationship_property_address.json'),
        JSON.stringify(relationshipFile, null, 2)
      );

      await fsPromises.writeFile(
        path.join(tempDir, 'property.json'),
        JSON.stringify(propertyFile, null, 2)
      );

      await fsPromises.writeFile(
        path.join(tempDir, 'address.json'),
        JSON.stringify(addressFile, null, 2)
      );
    });

    it('should generate fact_sheet.json', async () => {
      await service.generateFactSheetRelationships(tempDir);

      const factSheetPath = path.join(tempDir, 'fact_sheet.json');
      const exists = await fsPromises
        .access(factSheetPath)
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(true);
    });

    it('should create relationship files from classes to fact_sheet', async () => {
      await service.generateFactSheetRelationships(tempDir);

      // Check for property to fact_sheet relationship
      const propertyRelPath = path.join(
        tempDir,
        'relationship_property_to_fact_sheet.json'
      );
      const propertyRelExists = await fsPromises
        .access(propertyRelPath)
        .then(() => true)
        .catch(() => false);
      expect(propertyRelExists).toBe(true);

      if (propertyRelExists) {
        const propertyRelContent = JSON.parse(
          await fsPromises.readFile(propertyRelPath, 'utf-8')
        );
        expect(propertyRelContent).toEqual({
          from: { '/': './property.json' },
          to: { '/': './fact_sheet.json' },
        });
      }

      // Check for address to fact_sheet relationship
      const addressRelPath = path.join(
        tempDir,
        'relationship_address_to_fact_sheet.json'
      );
      const addressRelExists = await fsPromises
        .access(addressRelPath)
        .then(() => true)
        .catch(() => false);
      expect(addressRelExists).toBe(true);

      if (addressRelExists) {
        const addressRelContent = JSON.parse(
          await fsPromises.readFile(addressRelPath, 'utf-8')
        );
        expect(addressRelContent).toEqual({
          from: { '/': './address.json' },
          to: { '/': './fact_sheet.json' },
        });
      }
    });

    it('should update datagroup files with fact_sheet relationships', async () => {
      await service.generateFactSheetRelationships(tempDir);

      // Read the updated datagroup file
      const datagroupPath = path.join(tempDir, 'bafkreicountyschema.json');
      const datagroupContent = JSON.parse(
        await fsPromises.readFile(datagroupPath, 'utf-8')
      );

      // Check that new relationships were added
      expect(datagroupContent.relationships).toHaveProperty(
        'property_has_fact_sheet'
      );
      expect(datagroupContent.relationships).toHaveProperty(
        'address_has_fact_sheet'
      );

      // Verify the relationship references (should always be arrays)
      expect(datagroupContent.relationships.property_has_fact_sheet).toEqual([
        {
          '/': './relationship_property_to_fact_sheet.json',
        },
      ]);

      expect(datagroupContent.relationships.address_has_fact_sheet).toEqual([
        {
          '/': './relationship_address_to_fact_sheet.json',
        },
      ]);
    });

    it('should handle arrays of relationships', async () => {
      // Add a datagroup with array relationships
      const datagroupWithArray = {
        label: 'County',
        relationships: {
          property_has_address: [
            { '/': './relationship_property_address_1.json' },
            { '/': './relationship_property_address_2.json' },
          ],
        },
      };

      const relationshipFile1 = {
        from: { '/': './property1.json' },
        to: { '/': './address1.json' },
      };

      const relationshipFile2 = {
        from: { '/': './property2.json' },
        to: { '/': './address2.json' },
      };

      await fsPromises.writeFile(
        path.join(tempDir, 'bafkreicountyschema.json'),
        JSON.stringify(datagroupWithArray, null, 2)
      );

      await fsPromises.writeFile(
        path.join(tempDir, 'relationship_property_address_1.json'),
        JSON.stringify(relationshipFile1, null, 2)
      );

      await fsPromises.writeFile(
        path.join(tempDir, 'relationship_property_address_2.json'),
        JSON.stringify(relationshipFile2, null, 2)
      );

      await fsPromises.writeFile(
        path.join(tempDir, 'property1.json'),
        JSON.stringify({ id: '1' }, null, 2)
      );

      await fsPromises.writeFile(
        path.join(tempDir, 'property2.json'),
        JSON.stringify({ id: '2' }, null, 2)
      );

      await fsPromises.writeFile(
        path.join(tempDir, 'address1.json'),
        JSON.stringify({ street: 'Street 1' }, null, 2)
      );

      await fsPromises.writeFile(
        path.join(tempDir, 'address2.json'),
        JSON.stringify({ street: 'Street 2' }, null, 2)
      );

      await service.generateFactSheetRelationships(tempDir);

      // Check that relationship files were created for all classes
      const expectedRelFiles = [
        'relationship_property1_to_fact_sheet.json',
        'relationship_property2_to_fact_sheet.json',
        'relationship_address1_to_fact_sheet.json',
        'relationship_address2_to_fact_sheet.json',
      ];

      for (const relFile of expectedRelFiles) {
        const relPath = path.join(tempDir, relFile);
        const exists = await fsPromises
          .access(relPath)
          .then(() => true)
          .catch(() => false);
        expect(exists).toBe(true);
      }

      // Verify that datagroup was updated with fact_sheet relationships as arrays
      const datagroupPath = path.join(tempDir, 'bafkreicountyschema.json');
      const datagroupContent = JSON.parse(
        await fsPromises.readFile(datagroupPath, 'utf-8')
      );

      // Property has multiple instances, should be an array with 2 items
      expect(datagroupContent.relationships.property_has_fact_sheet).toEqual([
        { '/': './relationship_property1_to_fact_sheet.json' },
        { '/': './relationship_property2_to_fact_sheet.json' },
      ]);

      // Address has multiple instances, should be an array with 2 items
      expect(datagroupContent.relationships.address_has_fact_sheet).toEqual([
        { '/': './relationship_address1_to_fact_sheet.json' },
        { '/': './relationship_address2_to_fact_sheet.json' },
      ]);
    });

    // Removed: behavior with null/undefined relationships is no longer supported

    // Removed: behavior without relationship schema CIDs is unsupported

    it('should not duplicate class mappings', async () => {
      // Create multiple datagroups referencing the same classes
      const datagroup1 = {
        label: 'County',
        relationships: {
          property_has_address: {
            '/': './rel1.json',
          },
        },
      };

      const datagroup2 = {
        label: 'County',
        relationships: {
          property_has_address: {
            '/': './rel2.json',
          },
        },
      };

      await fsPromises.writeFile(
        path.join(tempDir, 'bafkreicountyschema.json'),
        JSON.stringify(datagroup1, null, 2)
      );

      await fsPromises.writeFile(
        path.join(tempDir, 'bafkreicountyschema2.json'),
        JSON.stringify(datagroup2, null, 2)
      );

      await fsPromises.writeFile(
        path.join(tempDir, 'rel1.json'),
        JSON.stringify(
          {
            from: { '/': './property.json' },
            to: { '/': './address.json' },
          },
          null,
          2
        )
      );

      await fsPromises.writeFile(
        path.join(tempDir, 'rel2.json'),
        JSON.stringify(
          {
            from: { '/': './property.json' },
            to: { '/': './address.json' },
          },
          null,
          2
        )
      );

      await fsPromises.writeFile(
        path.join(tempDir, 'property.json'),
        JSON.stringify({ id: '123' }, null, 2)
      );

      await fsPromises.writeFile(
        path.join(tempDir, 'address.json'),
        JSON.stringify({ street: '123 Main St' }, null, 2)
      );

      await service.generateFactSheetRelationships(tempDir);

      // Should only create one relationship file per class
      const files = await fsPromises.readdir(tempDir);
      const propertyRelFiles = files.filter(
        (f) => f === 'relationship_property_to_fact_sheet.json'
      );
      const addressRelFiles = files.filter(
        (f) => f === 'relationship_address_to_fact_sheet.json'
      );

      expect(propertyRelFiles.length).toBe(1);
      expect(addressRelFiles.length).toBe(1);
    });
  });

  describe('error handling', () => {
    it('should handle IPFS fetch errors gracefully', async () => {
      // Create a fresh service instance with proper mocks
      const testSchemaManifestService = new SchemaManifestService();

      // Mock the loadSchemaManifest to succeed
      vi.spyOn(
        testSchemaManifestService,
        'loadSchemaManifest'
      ).mockResolvedValue({
        County: { ipfsCid: 'bafkreicountyschema', type: 'dataGroup' },
      } as any);

      vi.spyOn(
        testSchemaManifestService,
        'getDataGroupCidByLabel'
      ).mockImplementation((label) => {
        return label === 'County' ? 'bafkreicountyschema' : null;
      });

      const testSchemaCache = new SchemaCacheService(
        path.join(tempDir, 'cache-err')
      );
      const testService = new FactSheetRelationshipService(
        testSchemaManifestService,
        testSchemaCache
      );

      // Force schema cache retrieval to fail (simulates IPFS fetch failure)
      vi.spyOn(testSchemaCache, 'get').mockRejectedValue(
        new Error('Network error')
      );

      const datagroup = {
        label: 'County',
        relationships: {},
      };

      await fsPromises.writeFile(
        path.join(tempDir, 'bafkreicountyschema.json'),
        JSON.stringify(datagroup, null, 2)
      );

      // Should not throw, but log error
      await expect(
        testService.generateFactSheetRelationships(tempDir)
      ).resolves.not.toThrow();

      // fact_sheet.json should still be created
      const factSheetPath = path.join(tempDir, 'fact_sheet.json');
      const exists = await fsPromises
        .access(factSheetPath)
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(true);
    });

    it('should handle invalid JSON files', async () => {
      await fsPromises.writeFile(
        path.join(tempDir, 'invalid.json'),
        'not valid json'
      );

      await fsPromises.writeFile(
        path.join(tempDir, 'valid.json'),
        JSON.stringify({ label: 'County', relationships: {} }, null, 2)
      );

      // Should skip invalid files and process valid ones
      await expect(
        service.generateFactSheetRelationships(tempDir)
      ).resolves.not.toThrow();

      // fact_sheet.json should still be created
      const factSheetPath = path.join(tempDir, 'fact_sheet.json');
      const exists = await fsPromises
        .access(factSheetPath)
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(true);
    });
  });
});
