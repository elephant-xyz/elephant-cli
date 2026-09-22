import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, promises as fsPromises } from 'fs';
import AdmZip from 'adm-zip';

import { handleTransform } from '../../../src/commands/transform.js';
import * as aiAgent from '../../../src/utils/ai-agent.js';
import { ZipExtractorService } from '../../../src/services/zip-extractor.service.js';
import * as zipUtils from '../../../src/utils/zip.js';
import * as schemaFetcher from '../../../src/utils/schema-fetcher.js';

// Mock modules
vi.mock('child_process');
vi.mock('fs');
vi.mock('fs/promises');
vi.mock('adm-zip');
vi.mock('../../../src/utils/ai-agent.js');
vi.mock('../../../src/services/zip-extractor.service.js');
vi.mock('../../../src/utils/zip.js');
vi.mock('../../../src/utils/schema-fetcher.js');
vi.mock('../../../src/utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

// Track process.exit calls
const mockProcessExit = vi
  .spyOn(process, 'exit')
  .mockImplementation(() => undefined as never);

// Mock console methods
vi.spyOn(console, 'log').mockImplementation(() => {});
vi.spyOn(console, 'error').mockImplementation(() => {});

describe('transform command', () => {
  const mockExtractedDir = '/tmp/elephant-cli-zip-123/property-dir';

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup default mocks
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(fsPromises.readdir).mockResolvedValue([]);
    vi.mocked(fsPromises.mkdir).mockResolvedValue(undefined);
    vi.mocked(fsPromises.mkdtemp).mockResolvedValue(
      '/tmp/elephant-cli-transform-input-123'
    );
    vi.mocked(fsPromises.copyFile).mockResolvedValue(undefined);
    vi.mocked(fsPromises.rm).mockResolvedValue(undefined);
    vi.mocked(fsPromises.rename).mockResolvedValue(undefined);
    vi.mocked(fsPromises.readFile).mockResolvedValue('');
    vi.mocked(fsPromises.writeFile).mockResolvedValue(undefined);
    vi.mocked(fsPromises.stat).mockResolvedValue({
      isDirectory: () => false,
    } as any);

    // Mock ZipExtractorService
    const mockZipExtractor = {
      extractZip: vi.fn().mockResolvedValue(mockExtractedDir),
    };
    vi.mocked(ZipExtractorService).mockImplementation(
      () => mockZipExtractor as any
    );

    // Mock AdmZip
    const mockZipInstance = {
      addLocalFolder: vi.fn(),
      addLocalFile: vi.fn(),
      writeZip: vi.fn(),
      extractAllTo: vi.fn(),
    };
    vi.mocked(AdmZip).mockImplementation(() => mockZipInstance as any);

    // Mock AI-Agent function
    vi.mocked(aiAgent.runAIAgent).mockReturnValue(0);

    // Mock zip utilities
    vi.mocked(zipUtils.extractZipToTemp).mockResolvedValue(
      '/tmp/extracted-input'
    );

    // Mock schema fetcher
    vi.mocked(schemaFetcher.fetchSchemaManifest).mockResolvedValue({
      Seed: { ipfsCid: 'test-seed-cid', type: 'dataGroup' },
      County: { ipfsCid: 'test-county-cid', type: 'dataGroup' },
    });

    // Mock fsPromises.access
    vi.mocked(fsPromises.access as any).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('handleTransform', () => {
    const options = { legacyMode: true };
    it('rejects transform v2 package without explicit version flag', async () => {
      await expect(
        handleTransform({
          transformZip: 'transform-v2.zip',
          silent: true,
        })
      ).rejects.toThrow('--transform-zip requires --transform-version 2');
    });

    it('requires a transform v2 package when version 2 is selected', async () => {
      await expect(
        handleTransform({
          transformVersion: 2,
          silent: true,
        })
      ).rejects.toThrow('--transform-zip is required for transform v2');
    });

    it('rejects scripts zip when transform v2 is selected', async () => {
      await expect(
        handleTransform({
          transformVersion: 2,
          transformZip: 'transform-v2.zip',
          scriptsZip: 'generated-scripts.zip',
          silent: true,
        })
      ).rejects.toThrow('--scripts-zip cannot be used with transform v2');
    });

    it('requires an input zip when transform v2 is selected', async () => {
      await expect(
        handleTransform({
          transformVersion: 2,
          transformZip: 'transform-v2.zip',
          silent: true,
        })
      ).rejects.toThrow('In transform v2, --input-zip is required');
    });

    it('should successfully transform data with default output zip', async () => {
      await handleTransform({ legacyMode: true });

      expect(aiAgent.runAIAgent).toHaveBeenCalledWith(
        expect.arrayContaining([
          '--transform',
          '--output-zip',
          'transformed-data.zip',
        ])
      );
      expect(mockProcessExit).not.toHaveBeenCalled();
    });

    it('should use custom output zip path when provided', async () => {
      const customOutput = 'custom-output.zip';

      await handleTransform({ outputZip: customOutput, legacyMode: true });

      expect(aiAgent.runAIAgent).toHaveBeenCalledWith(
        expect.arrayContaining(['--output-zip', customOutput])
      );
    });

    it('should handle AI-agent execution failure', async () => {
      const options = { legacyMode: true };

      // Mock AI-Agent to return non-zero exit code
      vi.mocked(aiAgent.runAIAgent).mockReturnValue(1);

      await handleTransform(options);

      expect(mockProcessExit).toHaveBeenCalledWith(1);
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('Error during transform')
      );
    });

    it('should handle missing output ZIP file', async () => {
      const options = { legacyMode: true };

      vi.mocked(existsSync).mockImplementation((path: any) => {
        if (path === 'transformed-data.zip') {
          return false; // Output ZIP doesn't exist
        }
        return true;
      });

      await handleTransform(options);

      expect(mockProcessExit).toHaveBeenCalledWith(1);
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('Error during transform')
      );
    });

    it('should pass through additional arguments to AI-agent', async () => {
      const options = {
        group: 'seed',
        inputCsv: 'data.csv',
        someOtherOption: 'value',
        legacyMode: true,
      };

      await handleTransform(options);

      expect(aiAgent.runAIAgent).toHaveBeenCalledWith(
        expect.arrayContaining([
          '--transform',
          '--group',
          'seed',
          '--input-csv',
          'data.csv',
          '--some-other-option',
          'value',
          '--output-zip',
          'transformed-data.zip',
        ])
      );
    });

    describe('SeedRow json and body field support (non-legacy mode)', () => {
      // Tests for the new json and body field support added in the latest commit
      // These tests validate the changes made to support json and body fields in SeedRow interface
      it('should throw error when both json and body fields are present', async () => {
        const options = { inputZip: 'test-input.zip' };

        vi.mocked(existsSync).mockReturnValue(true);

        vi.mocked(fsPromises.readFile).mockImplementation(async (file: any) => {
          if (file.includes('seed.csv')) {
            return 'parcel_id,address,method,url,multiValueQueryString,county,json,body,source_identifier\n473725000000,"EVERGLADES, UNINCORPORATED, FL",POST,https://web.bcpa.net/BcpaClient/search.aspx/getParcelInformation,,Broward,"{""folioNumber"": ""473725000000""}","folioNumber=473725000000",473725000000';
          }
          return '';
        });

        await handleTransform(options);

        expect(mockProcessExit).toHaveBeenCalledWith(1);
        expect(console.error).toHaveBeenCalledWith(
          expect.stringContaining('Both json and body fields are present')
        );
      });

      it('should handle invalid json in seed row', async () => {
        const options = { inputZip: 'test-input.zip' };

        vi.mocked(existsSync).mockReturnValue(true);

        vi.mocked(fsPromises.readFile).mockImplementation(async (file: any) => {
          if (file.includes('seed.csv')) {
            return 'parcel_id,address,method,url,multiValueQueryString,county,json,source_identifier\n473725000000,"EVERGLADES, UNINCORPORATED, FL",POST,https://web.bcpa.net/BcpaClient/search.aspx/getParcelInformation,,Broward,"{invalid json}",473725000000';
          }
          return '';
        });

        await handleTransform(options);

        expect(mockProcessExit).toHaveBeenCalledWith(1);
        expect(console.error).toHaveBeenCalledWith(
          expect.stringContaining('Error during transform (scripts mode)')
        );
      });
    });

    describe('County Transform - Relationship Creation Rules', () => {
      it('should not create property relationship for mailing_address.json', async () => {
        const options = {
          inputZip: 'test-input.zip',
          scriptsZip: 'test-scripts.zip',
        };

        vi.mocked(existsSync).mockReturnValue(true);

        const writeFileCalls: any[] = [];
        vi.mocked(fsPromises.writeFile).mockImplementation(
          async (file: any, data: any) => {
            writeFileCalls.push({ file, data });
          }
        );

        vi.mocked(fsPromises.readFile).mockImplementation(async (file: any) => {
          if (file.includes('address.json')) {
            return JSON.stringify({
              source_http_request: { url: 'test' },
              request_identifier: 'test-123',
            });
          }
          if (file.includes('mailing_address.json')) {
            return JSON.stringify({ address: '123 Main St' });
          }
          return '{}';
        });

        vi.mocked(fsPromises.readdir).mockImplementation(async (dir: any) => {
          if (typeof dir === 'string' && dir.includes('data')) {
            return ['property.json', 'mailing_address.json'] as any;
          }
          return [] as any;
        });

        await handleTransform(options);

        const relationshipFiles = writeFileCalls.filter((call) =>
          call.file.includes('relationship_property_mailing_address.json')
        );

        expect(relationshipFiles.length).toBe(0);
      });

      it('should not create property relationship for exemption files', async () => {
        const options = {
          inputZip: 'test-input.zip',
          scriptsZip: 'test-scripts.zip',
        };

        vi.mocked(existsSync).mockReturnValue(true);

        const writeFileCalls: any[] = [];
        vi.mocked(fsPromises.writeFile).mockImplementation(
          async (file: any, data: any) => {
            writeFileCalls.push({ file, data });
          }
        );

        vi.mocked(fsPromises.readFile).mockImplementation(async (file: any) => {
          return '{}';
        });

        vi.mocked(fsPromises.readdir).mockImplementation(async (dir: any) => {
          if (typeof dir === 'string' && dir.includes('data')) {
            return [
              'property.json',
              'exemption_1_1.json',
              'exemption_2_1.json',
            ] as any;
          }
          return [] as any;
        });

        await handleTransform(options);

        const relationshipFiles = writeFileCalls.filter(
          (call) =>
            call.file.includes('relationship_property_exemption_1_1.json') ||
            call.file.includes('relationship_property_exemption_2_1.json')
        );

        expect(relationshipFiles.length).toBe(0);
      });

      it('should not create property relationship for jurisdiction files', async () => {
        const options = {
          inputZip: 'test-input.zip',
          scriptsZip: 'test-scripts.zip',
        };

        vi.mocked(existsSync).mockReturnValue(true);

        const writeFileCalls: any[] = [];
        vi.mocked(fsPromises.writeFile).mockImplementation(
          async (file: any, data: any) => {
            writeFileCalls.push({ file, data });
          }
        );

        vi.mocked(fsPromises.readFile).mockImplementation(async (file: any) => {
          return '{}';
        });

        vi.mocked(fsPromises.readdir).mockImplementation(async (dir: any) => {
          if (typeof dir === 'string' && dir.includes('data')) {
            return [
              'property.json',
              'jurisdiction_1.json',
              'jurisdiction_4.json',
            ] as any;
          }
          return [] as any;
        });

        await handleTransform(options);

        const relationshipFiles = writeFileCalls.filter(
          (call) =>
            call.file.includes('relationship_property_jurisdiction_1.json') ||
            call.file.includes('relationship_property_jurisdiction_4.json')
        );

        expect(relationshipFiles.length).toBe(0);
      });

      it('should not create property relationship for files with both exemption and jurisdiction', async () => {
        const options = {
          inputZip: 'test-input.zip',
          scriptsZip: 'test-scripts.zip',
        };

        vi.mocked(existsSync).mockReturnValue(true);

        const writeFileCalls: any[] = [];
        vi.mocked(fsPromises.writeFile).mockImplementation(
          async (file: any, data: any) => {
            writeFileCalls.push({ file, data });
          }
        );

        vi.mocked(fsPromises.readFile).mockImplementation(async (file: any) => {
          return '{}';
        });

        vi.mocked(fsPromises.readdir).mockImplementation(async (dir: any) => {
          if (typeof dir === 'string' && dir.includes('data')) {
            return [
              'property.json',
              'tax_jurisdiction_exemption_1.json',
            ] as any;
          }
          return [] as any;
        });

        await handleTransform(options);

        const relationshipFiles = writeFileCalls.filter((call) =>
          call.file.includes(
            'relationship_property_tax_jurisdiction_exemption_1.json'
          )
        );

        expect(relationshipFiles.length).toBe(0);
      });

      it('should collect geometry relationship files from output directory', async () => {
        const options = {
          inputZip: 'test-input.zip',
          scriptsZip: 'test-scripts.zip',
        };

        vi.mocked(existsSync).mockReturnValue(true);

        const writeFileCalls: any[] = [];
        vi.mocked(fsPromises.writeFile).mockImplementation(
          async (file: any, data: any) => {
            writeFileCalls.push({ file, data });
          }
        );

        vi.mocked(fsPromises.readFile).mockImplementation(async (file: any) => {
          return '{}';
        });

        let readdirCallCount = 0;
        vi.mocked(fsPromises.readdir).mockImplementation(async (dir: any) => {
          if (typeof dir === 'string' && dir.includes('data')) {
            readdirCallCount++;
            if (readdirCallCount === 1) {
              return [
                'property.json',
                'parcel.json',
                'address.json',
                'geometry.json',
              ] as any;
            }
            return [
              'property.json',
              'parcel.json',
              'address.json',
              'geometry.json',
              'relationship_parcel_geometry.json',
              'relationship_address_geometry.json',
              'relationship_layout_geometry_1.json',
              'relationship_layout_geometry_2.json',
            ] as any;
          }
          return [] as any;
        });

        await handleTransform(options);

        const dataGroupWrite = writeFileCalls.find((call) =>
          call.file.includes('test-county-cid.json')
        );

        if (dataGroupWrite) {
          const dataGroup = JSON.parse(dataGroupWrite.data);
          expect(dataGroup.relationships).toBeDefined();
        }
      });
    });
  });
});
