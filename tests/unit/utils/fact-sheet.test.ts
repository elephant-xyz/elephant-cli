import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import { existsSync, promises as fsPromises } from 'fs';
import * as os from 'os';
import path from 'path';
import {
  checkFactSheetInstalled,
  getFactSheetPath,
  installOrUpdateFactSheet,
  generateHTMLFiles,
} from '../../../src/utils/fact-sheet.js';

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

  describe('checkFactSheetInstalled', () => {
    it('should return true when fact-sheet is found in PATH', async () => {
      vi.mocked(execSync).mockReturnValue('/usr/local/bin/fact-sheet\n');

      const result = await checkFactSheetInstalled();

      expect(result).toBe(true);
      expect(execSync).toHaveBeenCalledWith('which fact-sheet', {
        stdio: 'pipe',
        encoding: 'utf8',
      });
    });

    it('should return true when fact-sheet exists in expected location', async () => {
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error('command not found');
      });
      vi.mocked(existsSync).mockReturnValue(true);

      const result = await checkFactSheetInstalled();

      expect(result).toBe(true);
      expect(existsSync).toHaveBeenCalledWith(
        path.join(os.homedir(), '.local', 'bin', 'fact-sheet')
      );
    });

    it('should return false when fact-sheet is not found', async () => {
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error('command not found');
      });
      vi.mocked(existsSync).mockReturnValue(false);

      const result = await checkFactSheetInstalled();

      expect(result).toBe(false);
    });
  });

  describe('getFactSheetPath', () => {
    it('should return fact-sheet when found in PATH', () => {
      vi.mocked(execSync).mockReturnValue('/usr/local/bin/fact-sheet\n');

      const result = getFactSheetPath();

      expect(result).toBe('fact-sheet');
    });

    it('should return full path when not in PATH', () => {
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error('command not found');
      });

      const result = getFactSheetPath();

      expect(result).toBe(
        path.join(os.homedir(), '.local', 'bin', 'fact-sheet')
      );
    });
  });

  describe('installOrUpdateFactSheet', () => {
    it('should update when fact-sheet is already installed', async () => {
      // Mock checkFactSheetInstalled to return true
      vi.mocked(execSync).mockImplementation((cmd: any) => {
        if (cmd === 'which fact-sheet') {
          return '/usr/local/bin/fact-sheet\n';
        }
        if (cmd.includes('update.sh')) {
          return 'Updated successfully';
        }
        return '';
      });
      vi.mocked(existsSync).mockReturnValue(true);

      await installOrUpdateFactSheet();

      expect(execSync).toHaveBeenCalledWith(
        expect.stringContaining('update.sh'),
        expect.objectContaining({
          encoding: 'utf8',
          stdio: 'pipe',
        })
      );
    });

    it('should install when fact-sheet is not found', async () => {
      // Mock checkFactSheetInstalled to return false
      vi.mocked(execSync).mockImplementation((cmd: any) => {
        if (cmd === 'which fact-sheet') {
          throw new Error('command not found');
        }
        if (cmd.includes('install.sh')) {
          return 'Installed successfully';
        }
        return '';
      });
      vi.mocked(existsSync).mockReturnValue(false);

      await installOrUpdateFactSheet();

      expect(execSync).toHaveBeenCalledWith(
        expect.stringContaining('install.sh'),
        expect.objectContaining({
          encoding: 'utf8',
          stdio: 'pipe',
        })
      );
    });

    it('should handle git errors during update', async () => {
      vi.mocked(execSync).mockImplementation((cmd: any) => {
        if (cmd === 'which fact-sheet') {
          return '/usr/local/bin/fact-sheet\n';
        }
        if (cmd.includes('update.sh')) {
          const error: any = new Error('Update failed');
          error.stderr = 'cannot pull with rebase: You have unstaged changes';
          throw error;
        }
        return '';
      });
      vi.mocked(existsSync).mockReturnValue(true);

      // Should not throw, but log warning
      await expect(installOrUpdateFactSheet()).resolves.toBeUndefined();
    });

    it('should throw error when installation fails', async () => {
      vi.mocked(execSync).mockImplementation((cmd: any) => {
        if (cmd === 'which fact-sheet') {
          throw new Error('command not found');
        }
        if (cmd.includes('install.sh')) {
          throw new Error('Installation failed');
        }
        return '';
      });
      vi.mocked(existsSync).mockReturnValue(false);

      await expect(installOrUpdateFactSheet()).rejects.toThrow(
        'Failed to install/update fact-sheet tool'
      );
    });
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
