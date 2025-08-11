import { describe, it, expect, vi, beforeEach } from 'vitest';
import { promises as fsPromises } from 'fs';
import path from 'path';
import { scanSinglePropertyDirectoryV2 } from '../../../src/utils/single-property-file-scanner-v2.js';
import { SchemaManifestService } from '../../../src/services/schema-manifest.service.js';
import { SEED_DATAGROUP_SCHEMA_CID } from '../../../src/config/constants.js';

vi.mock('fs', () => ({
  promises: {
    readdir: vi.fn(),
    readFile: vi.fn(),
  },
}));

describe('scanSinglePropertyDirectoryV2', () => {
  let mockSchemaManifestService: SchemaManifestService;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create mock schema manifest service
    mockSchemaManifestService = {
      loadSchemaManifest: vi.fn().mockResolvedValue({}),
      getDataGroupCidByLabel: vi.fn(),
      getAllDataGroups: vi.fn(),
    } as any;
  });

  it('should identify datagroup files by structure', async () => {
    const mockFiles = [
      { name: 'photo-metadata.json', isFile: () => true },
      { name: 'property-details.json', isFile: () => true },
      { name: 'random-data.json', isFile: () => true },
      { name: 'directory', isFile: () => false },
    ];

    (fsPromises.readdir as any).mockResolvedValue(mockFiles);

    // Mock file contents
    (fsPromises.readFile as any)
      .mockResolvedValueOnce(
        JSON.stringify({
          label: 'Photo Metadata',
          relationships: { property: { '/': 'some-cid' } },
        })
      )
      .mockResolvedValueOnce(
        JSON.stringify({
          label: 'Property Details',
          relationships: { owner: { '/': 'another-cid' } },
        })
      )
      .mockResolvedValueOnce(
        JSON.stringify({
          someField: 'value',
          anotherField: 123,
        })
      );

    // Mock schema manifest service responses
    (
      mockSchemaManifestService.getDataGroupCidByLabel as any
    ).mockImplementation((label: string) => {
      if (label === 'Photo Metadata') return 'bafkreiphoto123';
      if (label === 'Property Details') return 'bafkreiproperty456';
      return null;
    });

    const result = await scanSinglePropertyDirectoryV2(
      '/test/dir',
      'test-property',
      mockSchemaManifestService
    );

    expect(result.allFiles).toHaveLength(2);
    expect(result.validFilesCount).toBe(2);
    expect(result.descriptiveFilesCount).toBe(1);

    // Check that datagroup files were identified correctly
    expect(result.allFiles[0]).toEqual({
      propertyCid: 'test-property',
      dataGroupCid: 'bafkreiphoto123',
      filePath: path.join('/test/dir', 'photo-metadata.json'),
    });

    expect(result.allFiles[1]).toEqual({
      propertyCid: 'test-property',
      dataGroupCid: 'bafkreiproperty456',
      filePath: path.join('/test/dir', 'property-details.json'),
    });

    expect(result.schemaCids).toContain('bafkreiphoto123');
    expect(result.schemaCids).toContain('bafkreiproperty456');
  });

  it('should handle seed datagroup files correctly', async () => {
    const mockFiles = [
      { name: 'seed.json', isFile: () => true },
      { name: 'other-data.json', isFile: () => true },
    ];

    (fsPromises.readdir as any).mockResolvedValue(mockFiles);

    // Mock file contents
    (fsPromises.readFile as any)
      .mockResolvedValueOnce(
        JSON.stringify({
          label: 'Property Seed',
          relationships: { property: { '/': 'property-cid' } },
        })
      )
      .mockResolvedValueOnce(
        JSON.stringify({
          label: 'Photo Metadata',
          relationships: {},
        })
      );

    // Mock schema manifest service responses
    (
      mockSchemaManifestService.getDataGroupCidByLabel as any
    ).mockImplementation((label: string) => {
      if (label === 'Property Seed') return SEED_DATAGROUP_SCHEMA_CID;
      if (label === 'Photo Metadata') return 'bafkreiphoto123';
      return null;
    });

    const result = await scanSinglePropertyDirectoryV2(
      '/test/dir',
      'test-property',
      mockSchemaManifestService
    );

    expect(result.hasSeedFile).toBe(true);
    expect(result.propertyCid).toBe('SEED_PENDING:test-property');

    // Both files should have SEED_PENDING property CID
    expect(result.allFiles[0].propertyCid).toBe('SEED_PENDING:test-property');
    expect(result.allFiles[1].propertyCid).toBe('SEED_PENDING:test-property');
  });

  it('should skip files that cannot be parsed', async () => {
    const mockFiles = [
      { name: 'valid.json', isFile: () => true },
      { name: 'invalid.json', isFile: () => true },
    ];

    (fsPromises.readdir as any).mockResolvedValue(mockFiles);

    // Mock file contents
    (fsPromises.readFile as any)
      .mockResolvedValueOnce(
        JSON.stringify({
          label: 'Valid Data',
          relationships: {},
        })
      )
      .mockResolvedValueOnce('{ invalid json }');

    (mockSchemaManifestService.getDataGroupCidByLabel as any).mockReturnValue(
      'bafkreivalid123'
    );

    const result = await scanSinglePropertyDirectoryV2(
      '/test/dir',
      'test-property',
      mockSchemaManifestService
    );

    expect(result.allFiles).toHaveLength(1);
    expect(result.validFilesCount).toBe(1);
    expect(result.descriptiveFilesCount).toBe(1); // Invalid file counted as descriptive
  });

  it('should handle datagroups not found in manifest', async () => {
    const mockFiles = [{ name: 'unknown.json', isFile: () => true }];

    (fsPromises.readdir as any).mockResolvedValue(mockFiles);

    (fsPromises.readFile as any).mockResolvedValue(
      JSON.stringify({
        label: 'Unknown Datagroup',
        relationships: {},
      })
    );

    // Return null for unknown datagroup
    (mockSchemaManifestService.getDataGroupCidByLabel as any).mockReturnValue(
      null
    );

    const result = await scanSinglePropertyDirectoryV2(
      '/test/dir',
      'test-property',
      mockSchemaManifestService
    );

    expect(result.allFiles).toHaveLength(0);
    expect(result.validFilesCount).toBe(0);
    expect(result.descriptiveFilesCount).toBe(1);
  });

  it('should treat non-datagroup files as descriptive', async () => {
    const mockFiles = [
      { name: 'data1.json', isFile: () => true },
      { name: 'data2.json', isFile: () => true },
    ];

    (fsPromises.readdir as any).mockResolvedValue(mockFiles);

    // Mock file contents - neither matches datagroup structure
    (fsPromises.readFile as any)
      .mockResolvedValueOnce(
        JSON.stringify({
          label: 'Has Label',
          // Missing relationships
        })
      )
      .mockResolvedValueOnce(
        JSON.stringify({
          // Missing label
          relationships: {},
        })
      );

    const result = await scanSinglePropertyDirectoryV2(
      '/test/dir',
      'test-property',
      mockSchemaManifestService
    );

    expect(result.allFiles).toHaveLength(0);
    expect(result.validFilesCount).toBe(0);
    expect(result.descriptiveFilesCount).toBe(2);
  });

  it('should filter out non-JSON files', async () => {
    const mockFiles = [
      { name: 'data.json', isFile: () => true },
      { name: 'image.png', isFile: () => true },
      { name: 'text.txt', isFile: () => true },
    ];

    (fsPromises.readdir as any).mockResolvedValue(mockFiles);

    (fsPromises.readFile as any).mockResolvedValue(
      JSON.stringify({
        label: 'Valid Data',
        relationships: {},
      })
    );

    (mockSchemaManifestService.getDataGroupCidByLabel as any).mockReturnValue(
      'bafkreivalid123'
    );

    const result = await scanSinglePropertyDirectoryV2(
      '/test/dir',
      'test-property',
      mockSchemaManifestService
    );

    expect(result.allFiles).toHaveLength(1);
    expect(fsPromises.readFile).toHaveBeenCalledTimes(1); // Only called for JSON file
  });
});
