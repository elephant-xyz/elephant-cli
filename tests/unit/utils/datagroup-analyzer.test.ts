import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { promises as fsPromises } from 'fs';
import path from 'path';
import os from 'os';
import {
  analyzeDatagroupFiles,
  analyzeDatagroupFilesRecursive,
} from '../../../src/utils/datagroup-analyzer.js';
import { SchemaManifestService } from '../../../src/services/schema-manifest.service.js';

vi.mock('../../../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    success: vi.fn(),
    technical: vi.fn(),
  },
}));

describe('Datagroup Analyzer', () => {
  let tempDir: string;
  let mockSchemaManifestService: SchemaManifestService;

  beforeEach(async () => {
    // Create a temporary directory for test files
    tempDir = await fsPromises.mkdtemp(
      path.join(os.tmpdir(), 'datagroup-test-')
    );

    // Create mock schema manifest service
    mockSchemaManifestService = {
      loadSchemaManifest: vi.fn().mockResolvedValue(undefined),
      getDataGroupCidByLabel: vi.fn().mockImplementation((label: string) => {
        const labelToCid: Record<string, string> = {
          'Test Label 1': 'bafkreitest1schemacid',
          'Test Label 2': 'bafkreitest2schemacid',
          County: 'bafkreicountyschemacid',
        };
        return labelToCid[label];
      }),
    } as unknown as SchemaManifestService;
  });

  afterEach(async () => {
    // Clean up temporary directory
    await fsPromises.rm(tempDir, { recursive: true, force: true });
  });

  describe('analyzeDatagroupFiles', () => {
    it('should identify datagroup root files correctly', async () => {
      // Create datagroup files (with exactly "label" and "relationships" keys)
      await fsPromises.writeFile(
        path.join(tempDir, 'bafkreidatacid1.json'),
        JSON.stringify({
          label: 'Test Label 1',
          relationships: [],
        })
      );

      await fsPromises.writeFile(
        path.join(tempDir, 'bafkreidatacid2.json'),
        JSON.stringify({
          label: 'Test Label 2',
          relationships: ['some', 'relations'],
        })
      );

      // Create non-datagroup files
      await fsPromises.writeFile(
        path.join(tempDir, 'bafkreiother.json'),
        JSON.stringify({
          label: 'Has Label',
          relationships: [],
          extraField: 'This makes it not a datagroup root',
        })
      );

      await fsPromises.writeFile(
        path.join(tempDir, 'regular.json'),
        JSON.stringify({
          someField: 'value',
        })
      );

      const results = await analyzeDatagroupFiles(
        tempDir,
        mockSchemaManifestService
      );

      expect(results).toHaveLength(2);
      expect(results[0]).toEqual({
        filePath: path.join(tempDir, 'bafkreidatacid1.json'),
        fileName: 'bafkreidatacid1.json',
        dataCid: 'bafkreidatacid1',
        dataGroupCid: 'bafkreitest1schemacid',
        label: 'Test Label 1',
      });
      expect(results[1]).toEqual({
        filePath: path.join(tempDir, 'bafkreidatacid2.json'),
        fileName: 'bafkreidatacid2.json',
        dataCid: 'bafkreidatacid2',
        dataGroupCid: 'bafkreitest2schemacid',
        label: 'Test Label 2',
      });
    });

    it('should skip files with unrecognized labels', async () => {
      await fsPromises.writeFile(
        path.join(tempDir, 'bafkreiunknown.json'),
        JSON.stringify({
          label: 'Unknown Label',
          relationships: [],
        })
      );

      const results = await analyzeDatagroupFiles(
        tempDir,
        mockSchemaManifestService
      );

      expect(results).toHaveLength(0);
    });

    it('should handle invalid JSON files gracefully', async () => {
      await fsPromises.writeFile(
        path.join(tempDir, 'invalid.json'),
        'not valid json {'
      );

      await fsPromises.writeFile(
        path.join(tempDir, 'bafkreivalid.json'),
        JSON.stringify({
          label: 'Test Label 1',
          relationships: [],
        })
      );

      const results = await analyzeDatagroupFiles(
        tempDir,
        mockSchemaManifestService
      );

      // Should still process the valid file
      expect(results).toHaveLength(1);
      expect(results[0].dataCid).toBe('bafkreivalid');
    });

    it('should extract CID from filename correctly', async () => {
      const longCid =
        'bafkreigwbuvvl5x5szqxilma3kvhantomitsphsesyx6sndsy2m4yutmwq';
      await fsPromises.writeFile(
        path.join(tempDir, `${longCid}.json`),
        JSON.stringify({
          label: 'County',
          relationships: [],
        })
      );

      const results = await analyzeDatagroupFiles(
        tempDir,
        mockSchemaManifestService
      );

      expect(results).toHaveLength(1);
      expect(results[0].dataCid).toBe(longCid);
      expect(results[0].dataGroupCid).toBe('bafkreicountyschemacid');
    });
  });

  describe('analyzeDatagroupFilesRecursive', () => {
    it('should find datagroup files in nested directories', async () => {
      // Create nested directory structure
      const subDir1 = path.join(tempDir, 'property1');
      const subDir2 = path.join(tempDir, 'property2');
      await fsPromises.mkdir(subDir1, { recursive: true });
      await fsPromises.mkdir(subDir2, { recursive: true });

      // Add datagroup files in different directories
      await fsPromises.writeFile(
        path.join(subDir1, 'bafkreifile1.json'),
        JSON.stringify({
          label: 'Test Label 1',
          relationships: [],
        })
      );

      await fsPromises.writeFile(
        path.join(subDir2, 'bafkreifile2.json'),
        JSON.stringify({
          label: 'Test Label 2',
          relationships: [],
        })
      );

      // Add a file in root directory too
      await fsPromises.writeFile(
        path.join(tempDir, 'bafkreiroot.json'),
        JSON.stringify({
          label: 'County',
          relationships: [],
        })
      );

      const results = await analyzeDatagroupFilesRecursive(
        tempDir,
        mockSchemaManifestService
      );

      expect(results).toHaveLength(3);

      // Check that files from all directories are found
      const dataCids = results.map((r) => r.dataCid).sort();
      expect(dataCids).toEqual(['bafkreifile1', 'bafkreifile2', 'bafkreiroot']);
    });
  });
});
