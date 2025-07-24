import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fsPromises } from 'fs';
import path from 'path';
import { handleValidateAndUpload } from '../../src/commands/validate-and-upload';
import { IPFSService } from '../../src/services/ipfs.service';
import { PinataService } from '../../src/services/pinata.service';
import { JsonValidatorService } from '../../src/services/json-validator.service';
import { SchemaCacheService } from '../../src/services/schema-cache.service';
import { logger } from '../../src/utils/logger';
// Disable logging during tests
logger.silent = true;

// Mock process.exit to prevent test termination
const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => {
  throw new Error('process.exit called');
});

describe('IPLD Conversion Integration', () => {
  const testDir = path.join(process.cwd(), 'tmp', 'ipld-test');
  const resultsFile = path.join(testDir, 'results.csv');

  beforeEach(async () => {
    await fsPromises.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    // Clean up test directory
    try {
      await fsPromises.rm(testDir, { recursive: true, force: true });
    } catch (err) {
      // Ignore errors
    }
  });

  it('should convert file path links to IPFS CIDs during validation and upload for ipfs_url fields', async () => {
    // Create test directory structure following expected pattern
    const propertyDir = path.join(
      testDir,
      'QmTestPropertyCID123456789012345678901234567890'
    );
    await fsPromises.mkdir(propertyDir, { recursive: true });

    // Create a referenced image file in property directory
    const fakeImageData = Buffer.from('fake image data');
    await fsPromises.writeFile(
      path.join(propertyDir, 'referenced.png'),
      fakeImageData
    );

    // Create main data file with ipfs_url fields for image file links
    const mainData = {
      title: 'Main Document',
      type: 'primary',
      ipfs_url: './referenced.png',
      nestedData: {
        description: 'This has a link to supporting image',
        ipfs_url: './referenced.png',
      },
    };
    await fsPromises.writeFile(
      path.join(
        propertyDir,
        'QmTestDataGroupCID123456789012345678901234567.json'
      ),
      JSON.stringify(mainData, null, 2)
    );

    // Mock schema that is a valid data group schema
    const mockSchema = {
      type: 'object',
      properties: {
        label: { type: 'string' },
        relationships: { type: 'array' },
      },
      additionalProperties: true,
    };

    // Mock services
    const mockIPFSService = {
      fetchContent: async () => Buffer.from(JSON.stringify(mockSchema)),
    } as any;

    const mockSchemaCacheService = {
      getSchema: async () => mockSchema,
    } as any;

    const mockJsonValidatorService = new JsonValidatorService(
      mockIPFSService,
      testDir
    );

    let uploadedFiles: any[] = [];
    const mockPinataService = {
      uploadBatch: async (files: any[]) => {
        // Simulate upload and return CIDs
        return files.map((file, index) => {
          const mockCid = `QmMocked${index}${file.calculatedCid.substring(7, 20)}`;
          uploadedFiles.push({
            ...file,
            uploadedCid: mockCid,
          });
          return {
            success: true,
            cid: mockCid,
            propertyCid: file.propertyCid,
            dataGroupCid: file.dataGroupCid,
          };
        });
      },
    } as any;

    // Run validate and upload
    try {
      await handleValidateAndUpload(
        {
          inputDir: testDir,
          outputCsv: resultsFile,
          pinataJwt: 'mock-jwt',
          dryRun: false,
        },
        {
          ipfsServiceForSchemas: mockIPFSService,
          schemaCacheService: mockSchemaCacheService,
          jsonValidatorService: mockJsonValidatorService,
          pinataService: mockPinataService,
        }
      );
    } catch (error) {
      // Ignore process.exit errors in tests
      if (error instanceof Error && !error.message.includes('process.exit')) {
        throw error;
      }
    }

    // Verify results
    // With IPLD conversion, we expect 3 uploads:
    // 1. The referenced.json file
    // 2. The main file with first reference
    // 3. The main file with second reference (or final version)
    expect(uploadedFiles.length).toBeGreaterThanOrEqual(1);

    // Check that the main file was uploaded with converted links
    const mainFileUpload = uploadedFiles.find((f) =>
      f.filePath.includes('QmTestDataGroupCID123456789012345678901234567.json')
    );
    expect(mainFileUpload).toBeDefined();

    // Parse the uploaded content to verify links were converted
    const uploadedContent = JSON.parse(mainFileUpload.canonicalJson);

    // The ipfs_url field should now be an IPFS URI
    expect(uploadedContent.ipfs_url).toBeDefined();
    expect(uploadedContent.ipfs_url).toMatch(/^ipfs:\/\/QmMocked/);

    // The nested ipfs_url should also be converted
    expect(uploadedContent.nestedData.ipfs_url).toBeDefined();
    expect(uploadedContent.nestedData.ipfs_url).toMatch(/^ipfs:\/\/QmMocked/);

    // Both references should point to the same CID (same file)
    const cid1 = uploadedContent.ipfs_url.replace('ipfs://', '');
    const cid2 = uploadedContent.nestedData.ipfs_url.replace('ipfs://', '');
    expect(cid1).toBe(cid2);

    // Verify CSV was created
    const csvExists = await fsPromises
      .access(resultsFile)
      .then(() => true)
      .catch(() => false);
    expect(csvExists).toBe(true);
  });

  it('should handle mixed CID and file path links in ipfs_url fields', async () => {
    // Create test structure following expected pattern
    const propertyDir = path.join(
      testDir,
      'QmTestPropertyCID234567890123456789012345678901'
    );
    await fsPromises.mkdir(propertyDir, { recursive: true });

    // Create a local image file to reference
    await fsPromises.writeFile(
      path.join(propertyDir, 'local.jpg'),
      Buffer.from('fake jpg data')
    );

    // Create data with both CID and file path links in ipfs_url fields
    const mixedData = {
      name: 'Mixed Links Document',
      ipfs_url: 'QmYjtig7VJQ6XsnUjqqJvj7QaMcCAwtrgNdahSiFofrE7o',
      data: {
        localFile: {
          ipfs_url: './local.jpg',
        },
        absolutePath: {
          ipfs_url: path.join(propertyDir, 'local.jpg'),
        },
      },
    };

    await fsPromises.writeFile(
      path.join(
        propertyDir,
        'QmTestSchemaCID234567890123456789012345678901.json'
      ),
      JSON.stringify(mixedData, null, 2)
    );

    // Mock services
    const mockSchema = {
      type: 'object',
      properties: {
        label: { type: 'string' },
        relationships: { type: 'array' },
      },
      additionalProperties: true,
    };
    const mockIPFSService = {
      fetchContent: async () => Buffer.from(JSON.stringify(mockSchema)),
    } as any;

    const mockSchemaCacheService = {
      getSchema: async () => mockSchema,
    } as any;

    let uploadedContent: any;
    const mockPinataService = {
      uploadBatch: async (files: any[]) => {
        return files.map((file) => {
          if (
            file.filePath.includes(
              'QmTestSchemaCID234567890123456789012345678901.json'
            )
          ) {
            uploadedContent = JSON.parse(file.canonicalJson);
          }
          return {
            success: true,
            cid: `QmMocked${file.calculatedCid.substring(2, 15)}`,
            propertyCid: file.propertyCid,
            dataGroupCid: file.dataGroupCid,
          };
        });
      },
    } as any;

    try {
      await handleValidateAndUpload(
        {
          inputDir: testDir,
          outputCsv: resultsFile,
          pinataJwt: 'mock-jwt',
          dryRun: false,
        },
        {
          ipfsServiceForSchemas: mockIPFSService,
          schemaCacheService: mockSchemaCacheService,
          pinataService: mockPinataService,
        }
      );
    } catch (error) {
      // Ignore process.exit errors in tests
      if (error instanceof Error && !error.message.includes('process.exit')) {
        throw error;
      }
    }

    // Verify the uploaded content
    expect(uploadedContent).toBeDefined();

    // Existing CID should be converted to IPFS URI
    expect(uploadedContent.ipfs_url).toBe(
      'ipfs://QmYjtig7VJQ6XsnUjqqJvj7QaMcCAwtrgNdahSiFofrE7o'
    );

    // Local file should be converted to IPFS URI
    expect(uploadedContent.data.localFile.ipfs_url).toMatch(
      /^ipfs:\/\/QmMocked/
    );

    // Absolute path should also be converted to IPFS URI
    expect(uploadedContent.data.absolutePath.ipfs_url).toMatch(
      /^ipfs:\/\/QmMocked/
    );

    // Both local references should have the same CID
    const localCid = uploadedContent.data.localFile.ipfs_url.replace(
      'ipfs://',
      ''
    );
    const absoluteCid = uploadedContent.data.absolutePath.ipfs_url.replace(
      'ipfs://',
      ''
    );
    expect(localCid).toBe(absoluteCid);
  });
});
