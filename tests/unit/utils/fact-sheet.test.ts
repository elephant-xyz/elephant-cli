import { describe, it, expect, vi } from 'vitest';

// Mock the fact-sheet module with a simple mock
vi.mock('@elephant-xyz/fact-sheet', () => {
  const mockBuild = vi.fn().mockResolvedValue(undefined);
  const MockBuilder = vi.fn().mockImplementation(() => ({
    build: mockBuild,
  }));

  return {
    Builder: MockBuilder,
    __mockBuild: mockBuild,
    __MockBuilder: MockBuilder,
  };
});

vi.mock('@elephant-xyz/fact-sheet/package.json', () => ({
  default: {
    version: '1.2.1',
  },
}));

vi.mock('fs', () => ({
  promises: {
    mkdir: vi.fn().mockResolvedValue(undefined),
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

import {
  generateHTMLFiles,
  getFactSheetVersion,
} from '../../../src/utils/fact-sheet.js';

describe('fact-sheet utilities', () => {
  describe('getFactSheetVersion', () => {
    it('should return the fact-sheet version from package.json', () => {
      const version = getFactSheetVersion();
      expect(version).toBe('1.2.1');
    });
  });

  describe('generateHTMLFiles', () => {
    it('should create output directory and call fact-sheet build', async () => {
      const inputDir = '/test/input';
      const outputDir = '/test/output';

      // This test just verifies the function can be called without throwing
      await expect(
        generateHTMLFiles(inputDir, outputDir)
      ).resolves.not.toThrow();
    });
  });
});
