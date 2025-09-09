import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import { existsSync, promises as fsPromises } from 'fs';
import * as os from 'os';
import path from 'path';
import { generateHTMLFiles } from '../../../src/utils/fact-sheet.js';

// Mock modules
vi.mock('child_process');
vi.mock('fs');
vi.mock('fs/promises', () => ({
  default: {
    mkdir: vi.fn(),
  },
}));
vi.mock('../../../src/utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

describe('fact-sheet utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('generateHTMLFiles', () => {
    it('should generate HTML files successfully', async () => {
      const inputDir = '/test/input';
      const outputDir = '/test/output';

      vi.mocked(fsPromises.mkdir).mockResolvedValue(undefined);
      vi.mocked(execSync).mockImplementation((cmd: any) => {
        if (cmd.includes('--version')) {
          return '1.0.0';
        }
        if (cmd.includes('generate')) {
          return 'HTML files generated';
        }
        return 'fact-sheet';
      });

      await generateHTMLFiles(inputDir, outputDir);

      expect(fsPromises.mkdir).toHaveBeenCalledWith(outputDir, {
        recursive: true,
      });
      expect(execSync).toHaveBeenCalledWith(
        expect.stringContaining(
          'generate --input /test/input --output /test/output'
        ),
        expect.objectContaining({
          encoding: 'utf8',
          cwd: process.cwd(),
          stdio: 'pipe',
        })
      );
    });

    it('should handle fact-sheet version check failure gracefully', async () => {
      const inputDir = '/test/input';
      const outputDir = '/test/output';

      vi.mocked(fsPromises.mkdir).mockResolvedValue(undefined);
      vi.mocked(execSync).mockImplementation((cmd: any) => {
        if (cmd.includes('--version')) {
          throw new Error('Version check failed');
        }
        if (cmd.includes('generate')) {
          return 'HTML files generated';
        }
        return 'fact-sheet';
      });

      await generateHTMLFiles(inputDir, outputDir);

      expect(fsPromises.mkdir).toHaveBeenCalled();
      expect(execSync).toHaveBeenCalledWith(
        expect.stringContaining('generate'),
        expect.any(Object)
      );
    });

    it('should throw error when generation fails', async () => {
      const inputDir = '/test/input';
      const outputDir = '/test/output';

      vi.mocked(fsPromises.mkdir).mockResolvedValue(undefined);
      vi.mocked(execSync).mockImplementation((cmd: any) => {
        if (cmd.includes('generate')) {
          const error: any = new Error('Generation failed');
          error.stderr = 'Error generating HTML';
          error.stdout = 'Some output';
          throw error;
        }
        return 'fact-sheet';
      });

      await expect(generateHTMLFiles(inputDir, outputDir)).rejects.toThrow(
        'Failed to generate HTML files'
      );
    });
  });
});
