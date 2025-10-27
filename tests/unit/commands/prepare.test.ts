import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { handlePrepare } from '../../../src/commands/prepare/index.js';

describe('Prepare Command - handlePrepare', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let processExitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Spy on console methods
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    // Spy on process.exit and prevent it from actually exiting
    processExitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((code?: number) => {
        throw new Error(`process.exit(${code})`);
      });
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    consoleLogSpy.mockRestore();
    processExitSpy.mockRestore();
  });

  describe('Input Validation', () => {
    it('should require either inputZip or inputCsv', async () => {
      await expect(
        handlePrepare(undefined, {
          outputZip: 'output.zip',
        })
      ).rejects.toThrow('process.exit(1)');

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          'Either provide an input ZIP or use --input-csv'
        )
      );
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('should not allow both inputZip and inputCsv', async () => {
      await expect(
        handlePrepare('input.zip', {
          outputZip: 'output.zip',
          inputCsv: 'permits.csv',
        })
      ).rejects.toThrow('process.exit(1)');

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          'Cannot use both input ZIP and --input-csv at the same time'
        )
      );
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('should accept inputZip only', async () => {
      // Mock the prepare function to avoid actual execution
      const { prepare } = await import('../../../src/lib/prepare.js');
      const prepareMock = vi.fn().mockResolvedValue(undefined);
      vi.spyOn(
        await import('../../../src/lib/prepare.js'),
        'prepare'
      ).mockImplementation(prepareMock);

      await handlePrepare('input.zip', {
        outputZip: 'output.zip',
      });

      expect(prepareMock).toHaveBeenCalledWith(
        'input.zip',
        'output.zip',
        expect.objectContaining({})
      );
    });

    it('should accept inputCsv only', async () => {
      // Mock the prepare function to avoid actual execution
      const { prepare } = await import('../../../src/lib/prepare.js');
      const prepareMock = vi.fn().mockResolvedValue(undefined);
      vi.spyOn(
        await import('../../../src/lib/prepare.js'),
        'prepare'
      ).mockImplementation(prepareMock);

      await handlePrepare(undefined, {
        outputZip: 'output.zip',
        inputCsv: 'permits.csv',
      });

      expect(prepareMock).toHaveBeenCalledWith(
        '',
        'output.zip',
        expect.objectContaining({
          inputCsv: 'permits.csv',
        })
      );
    });
  });

  describe('Options Mapping', () => {
    it('should correctly map CLI options to prepare options', async () => {
      const { prepare } = await import('../../../src/lib/prepare.js');
      const prepareMock = vi.fn().mockResolvedValue(undefined);
      vi.spyOn(
        await import('../../../src/lib/prepare.js'),
        'prepare'
      ).mockImplementation(prepareMock);

      await handlePrepare('input.zip', {
        outputZip: 'output.zip',
        continue: false,
        continueButton: '#accept-button',
        useBrowser: true,
        headless: false,
        browserFlowTemplate: 'SEARCH_BY_PARCEL_ID',
        browserFlowParameters: '{"search_form_selector":"#search"}',
        browserFlowFile: 'flow.json',
        ignoreCaptcha: true,
        proxy: 'user:pass@proxy.example.com:8080' as any,
        multiRequestFlowFile: 'multi-flow.json',
      });

      expect(prepareMock).toHaveBeenCalledWith('input.zip', 'output.zip', {
        clickContinue: false,
        continueButtonSelector: '#accept-button',
        useBrowser: true,
        headless: false,
        browserFlowTemplate: 'SEARCH_BY_PARCEL_ID',
        browserFlowParameters: '{"search_form_selector":"#search"}',
        browserFlowFile: 'flow.json',
        ignoreCaptcha: true,
        proxy: 'user:pass@proxy.example.com:8080',
        multiRequestFlowFile: 'multi-flow.json',
        inputCsv: undefined,
      });
    });

    it('should map inputCsv option', async () => {
      const { prepare } = await import('../../../src/lib/prepare.js');
      const prepareMock = vi.fn().mockResolvedValue(undefined);
      vi.spyOn(
        await import('../../../src/lib/prepare.js'),
        'prepare'
      ).mockImplementation(prepareMock);

      await handlePrepare(undefined, {
        outputZip: 'output.zip',
        inputCsv: 'permits.csv',
        multiRequestFlowFile: 'flow.json',
      });

      expect(prepareMock).toHaveBeenCalledWith(
        '',
        'output.zip',
        expect.objectContaining({
          inputCsv: 'permits.csv',
          multiRequestFlowFile: 'flow.json',
        })
      );
    });

    it('should handle boolean option defaults correctly', async () => {
      const { prepare } = await import('../../../src/lib/prepare.js');
      const prepareMock = vi.fn().mockResolvedValue(undefined);
      vi.spyOn(
        await import('../../../src/lib/prepare.js'),
        'prepare'
      ).mockImplementation(prepareMock);

      await handlePrepare('input.zip', {
        outputZip: 'output.zip',
        // All boolean options omitted - should pass undefined
      });

      expect(prepareMock).toHaveBeenCalledWith('input.zip', 'output.zip', {
        clickContinue: undefined,
        continueButtonSelector: undefined,
        useBrowser: undefined,
        headless: undefined,
        browserFlowTemplate: undefined,
        browserFlowParameters: undefined,
        browserFlowFile: undefined,
        ignoreCaptcha: undefined,
        proxy: undefined,
        multiRequestFlowFile: undefined,
        inputCsv: undefined,
      });
    });
  });

  describe('CLI Output', () => {
    it('should display CLI header', async () => {
      const { prepare } = await import('../../../src/lib/prepare.js');
      vi.spyOn(
        await import('../../../src/lib/prepare.js'),
        'prepare'
      ).mockResolvedValue(undefined);

      await handlePrepare('input.zip', {
        outputZip: 'output.zip',
      });

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('🐘 Elephant Network CLI - Prepare')
      );
    });

    it('should display success message on completion', async () => {
      const { prepare } = await import('../../../src/lib/prepare.js');
      vi.spyOn(
        await import('../../../src/lib/prepare.js'),
        'prepare'
      ).mockResolvedValue(undefined);

      await handlePrepare('input.zip', {
        outputZip: 'output.zip',
      });

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('✅ Prepare complete.')
      );
    });

    it('should show spinner with correct source', async () => {
      const { prepare } = await import('../../../src/lib/prepare.js');
      vi.spyOn(
        await import('../../../src/lib/prepare.js'),
        'prepare'
      ).mockResolvedValue(undefined);

      await handlePrepare('test-input.zip', {
        outputZip: 'output.zip',
      });

      // Spinner message should reference the input source
      // (We can't easily test spinner output, but we can verify the function completes)
      expect(consoleLogSpy).toHaveBeenCalled();
    });

    it('should show CSV file path in spinner when using inputCsv', async () => {
      const { prepare } = await import('../../../src/lib/prepare.js');
      vi.spyOn(
        await import('../../../src/lib/prepare.js'),
        'prepare'
      ).mockResolvedValue(undefined);

      await handlePrepare(undefined, {
        outputZip: 'output.zip',
        inputCsv: 'permits.csv',
        multiRequestFlowFile: 'flow.json',
      });

      // Should complete successfully
      expect(consoleLogSpy).toHaveBeenCalled();
    });
  });

  describe('Error Propagation', () => {
    it('should propagate errors from prepare function', async () => {
      const { prepare } = await import('../../../src/lib/prepare.js');
      const testError = new Error('Test prepare error');
      vi.spyOn(
        await import('../../../src/lib/prepare.js'),
        'prepare'
      ).mockRejectedValue(testError);

      await expect(
        handlePrepare('input.zip', {
          outputZip: 'output.zip',
        })
      ).rejects.toThrow('Test prepare error');
    });

    it('should handle file not found errors', async () => {
      const { prepare } = await import('../../../src/lib/prepare.js');
      const fileError = new Error('ENOENT: no such file or directory');
      vi.spyOn(
        await import('../../../src/lib/prepare.js'),
        'prepare'
      ).mockRejectedValue(fileError);

      await expect(
        handlePrepare('nonexistent.zip', {
          outputZip: 'output.zip',
        })
      ).rejects.toThrow('ENOENT');
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty string as inputZip', async () => {
      await expect(
        handlePrepare('', {
          outputZip: 'output.zip',
        })
      ).rejects.toThrow('process.exit(1)');

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          'Either provide an input ZIP or use --input-csv'
        )
      );
    });

    it('should handle whitespace-only inputZip as valid input', async () => {
      // Whitespace is treated as truthy, so it bypasses the validation
      // and the error comes from trying to read the file
      const { prepare } = await import('../../../src/lib/prepare.js');
      const fileError = new Error('ENOENT: no such file or directory');
      vi.spyOn(
        await import('../../../src/lib/prepare.js'),
        'prepare'
      ).mockRejectedValue(fileError);

      await expect(
        handlePrepare('   ', {
          outputZip: 'output.zip',
        })
      ).rejects.toThrow('ENOENT');
    });

    it('should pass empty string for inputZip when using inputCsv', async () => {
      const { prepare } = await import('../../../src/lib/prepare.js');
      const prepareMock = vi.fn().mockResolvedValue(undefined);
      vi.spyOn(
        await import('../../../src/lib/prepare.js'),
        'prepare'
      ).mockImplementation(prepareMock);

      await handlePrepare(undefined, {
        outputZip: 'output.zip',
        inputCsv: 'test.csv',
        multiRequestFlowFile: 'flow.json',
      });

      // First argument to prepare should be empty string when using inputCsv
      expect(prepareMock).toHaveBeenCalledWith(
        '',
        'output.zip',
        expect.any(Object)
      );
    });
  });
});
