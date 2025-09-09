import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import { existsSync, promises as fsPromises } from 'fs';
import AdmZip from 'adm-zip';
import path from 'path';

import { handleTransform } from '../../../src/commands/transform.js';
import * as factSheet from '../../../src/utils/fact-sheet.js';
import * as aiAgent from '../../../src/utils/ai-agent.js';
import { ZipExtractorService } from '../../../src/services/zip-extractor.service.js';
import * as zipUtils from '../../../src/utils/zip.js';
import * as schemaFetcher from '../../../src/utils/schema-fetcher.js';

// Mock modules
vi.mock('child_process');
vi.mock('fs');
vi.mock('fs/promises');
vi.mock('adm-zip');
vi.mock('../../../src/utils/fact-sheet.js');
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
  const mockPropertyName = 'property-dir';
  const mockHtmlOutputDir = '/tmp/generated-htmls';

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

    vi.mocked(factSheet.generateHTMLFiles).mockResolvedValue(undefined);

    // Mock AI-Agent function
    vi.mocked(aiAgent.runAIAgent).mockReturnValue(0);

    // Mock zip utilities
    vi.mocked(zipUtils.extractZipToTemp).mockResolvedValue(
      '/tmp/extracted-input'
    );

    // Mock schema fetcher
    vi.mocked(schemaFetcher.fetchSchemaManifest).mockResolvedValue({
      Seed: { ipfsCid: 'test-seed-cid', type: 'dataGroup' },
    });
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('handleTransform', () => {
    const options = { legacyMode: true };
    it('should successfully transform data with default output zip', async () => {
      const options = { legacyMode: true };

      // Mock curl check for fact-sheet
      vi.mocked(execSync).mockImplementation((cmd: any) => {
        if (cmd === 'which curl') {
          return '/usr/bin/curl';
        }
        return '';
      });

      // Mock extracted directory with JSON files
      vi.mocked(fsPromises.readdir).mockImplementation(async (dir: any) => {
        if (dir === mockExtractedDir) {
          return [
            {
              name: 'file1.json',
              isFile: () => true,
              isDirectory: () => false,
            },
            {
              name: 'file2.json',
              isFile: () => true,
              isDirectory: () => false,
            },
          ] as any;
        }
        if (dir === mockHtmlOutputDir) {
          return [
            {
              name: mockPropertyName,
              isFile: () => false,
              isDirectory: () => true,
            },
          ] as any;
        }
        if (dir === path.join(mockHtmlOutputDir, mockPropertyName)) {
          return [
            {
              name: 'index.html',
              isFile: () => true,
              isDirectory: () => false,
            },
            {
              name: 'styles.css',
              isFile: () => true,
              isDirectory: () => false,
            },
          ] as any;
        }
        return [];
      });

      await handleTransform(options);

      // Verify AI-agent was called
      expect(aiAgent.runAIAgent).toHaveBeenCalledWith(
        expect.arrayContaining([
          '--transform',
          '--output-zip',
          'transformed-data.zip',
        ])
      );

      // Verify output zip was created
      expect(AdmZip).toHaveBeenCalled();
      const zipInstance = vi.mocked(AdmZip).mock.results[0].value;
      expect(zipInstance.writeZip).toHaveBeenCalledWith('transformed-data.zip');
    });

    it('should use custom output zip path when provided', async () => {
      const customOutput = 'custom-output.zip';
      const options = { outputZip: customOutput, legacyMode: true };

      vi.mocked(execSync).mockReturnValue('');
      vi.mocked(fsPromises.readdir).mockImplementation(async (dir: any) => {
        if (dir === mockExtractedDir) {
          return [
            { name: 'file.json', isFile: () => true, isDirectory: () => false },
          ] as any;
        }
        return [];
      });

      await handleTransform(options);

      expect(aiAgent.runAIAgent).toHaveBeenCalledWith(
        expect.arrayContaining(['--output-zip', customOutput])
      );

      const zipInstance = vi.mocked(AdmZip).mock.results[0].value;
      expect(zipInstance.writeZip).toHaveBeenCalledWith(customOutput);
    });

    it('should handle property directory detection correctly', async () => {
      vi.mocked(execSync).mockReturnValue('');

      // Test case: property files in subdirectory
      vi.mocked(fsPromises.readdir).mockImplementation(async (dir: any) => {
        if (dir === mockExtractedDir) {
          // No JSON files at root, but has subdirectory
          return [
            { name: 'subdir', isFile: () => false, isDirectory: () => true },
          ] as any;
        }
        if (dir === path.join(mockExtractedDir, 'subdir')) {
          return [
            { name: 'data.json', isFile: () => true, isDirectory: () => false },
          ] as any;
        }
        return [];
      });

      await handleTransform(options);

      // Should detect and use the subdirectory
      expect(fsPromises.readdir).toHaveBeenCalledWith(
        mockExtractedDir,
        expect.any(Object)
      );
    });

    it('should merge HTML files correctly into property directory', async () => {
      const options = {};

      vi.mocked(execSync).mockImplementation((cmd: any) => {
        if (cmd === 'which curl') {
          return '/usr/bin/curl';
        }
        return '';
      });

      const mockHtmlFiles = [
        { name: 'index.html', isFile: () => true, isDirectory: () => false },
        { name: 'manifest.json', isFile: () => true, isDirectory: () => false },
        { name: 'icon.svg', isFile: () => true, isDirectory: () => false },
      ];

      let readDirCallCount = 0;
      vi.mocked(fsPromises.readdir).mockImplementation(async (dir: any) => {
        readDirCallCount++;
        if (dir === mockExtractedDir) {
          return [
            { name: 'data.json', isFile: () => true, isDirectory: () => false },
          ] as any;
        }
        // First call to htmlOutputDir returns the subdirectory
        if (
          typeof dir === 'string' &&
          dir.includes('generated-htmls') &&
          !dir.includes('property')
        ) {
          return [
            {
              name: 'property-subdir',
              isFile: () => false,
              isDirectory: () => true,
            },
          ] as any;
        }
        // Second call gets the files inside the subdirectory
        if (typeof dir === 'string' && dir.includes('property-subdir')) {
          return mockHtmlFiles as any;
        }
        return [];
      });

      await handleTransform(options);
    });

    it('should handle AI-agent execution failure', async () => {
      const options = {};

      // Mock AI-Agent to return non-zero exit code
      vi.mocked(aiAgent.runAIAgent).mockReturnValue(1);

      await handleTransform(options);

      expect(mockProcessExit).toHaveBeenCalledWith(1);
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('Error during transform')
      );
    });

    it('should handle missing output ZIP file', async () => {
      const options = {};

      vi.mocked(execSync).mockReturnValue('');
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

    it('should handle curl not being available', async () => {
      const options = {};

      vi.mocked(execSync).mockImplementation((cmd: any) => {
        if (cmd === 'which curl') {
          throw new Error('curl not found');
        }
        if (cmd.includes('uvx')) {
          return '';
        }
        return '';
      });

      await handleTransform(options);

      expect(mockProcessExit).toHaveBeenCalledWith(1);
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('Error during transform')
      );
    });

    it('should clean up temporary directories on success', async () => {
      vi.mocked(execSync).mockReturnValue('');
      vi.mocked(fsPromises.readdir).mockImplementation(async (dir: any) => {
        if (dir === mockExtractedDir) {
          return [
            { name: 'data.json', isFile: () => true, isDirectory: () => false },
          ] as any;
        }
        return [];
      });

      await handleTransform(options);

      // Verify cleanup was attempted
      expect(fsPromises.rm).toHaveBeenCalledWith(expect.any(String), {
        recursive: true,
        force: true,
      });
    });

    it('should clean up temporary directories on failure', async () => {
      // Setup to make the command go through extraction first
      vi.mocked(execSync).mockImplementation((cmd: any) => {
        if (cmd.includes('uvx')) {
          return ''; // Let AI-agent succeed
        }
        if (cmd === 'which curl') {
          return '/usr/bin/curl';
        }
        return '';
      });

      // Make the ZIP file not exist after AI-agent runs
      vi.mocked(existsSync).mockImplementation((path: any) => {
        if (path === 'transformed-data.zip') {
          return false; // Output ZIP doesn't exist
        }
        return true;
      });

      await handleTransform(options);

      // Since the error happens before extraction, no cleanup occurs
      // Let's modify to test cleanup when error happens after extraction
      vi.clearAllMocks();

      // Setup mocks for a later failure
      vi.mocked(execSync).mockReturnValue('');
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(fsPromises.readdir).mockImplementation(async (dir: any) => {
        if (dir === mockExtractedDir) {
          return [
            { name: 'data.json', isFile: () => true, isDirectory: () => false },
          ] as any;
        }
        return [];
      });

      // Make HTML generation fail
      vi.mocked(factSheet.generateHTMLFiles).mockRejectedValue(
        new Error('HTML generation failed')
      );

      await handleTransform(options);

      // Verify cleanup was attempted
      expect(fsPromises.rm).toHaveBeenCalled();
    });

    it('should pass through additional arguments to AI-agent', async () => {
      const options = {
        group: 'seed',
        inputCsv: 'data.csv',
        someOtherOption: 'value',
        legacyMode: true,
      };

      vi.mocked(execSync).mockReturnValue('');
      vi.mocked(fsPromises.readdir).mockResolvedValue([] as any);

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
  });
});
