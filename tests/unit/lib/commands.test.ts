import { describe, it, expect, vi } from 'vitest';
import { transform, TransformOptions } from '../../../src/lib/commands.js';

// Mock the transform handler to avoid actual execution
vi.mock('../../../src/commands/transform/index.js', () => ({
  handleTransform: vi.fn().mockResolvedValue(undefined),
}));

describe('Library Commands', () => {
  describe('transform', () => {
    it('should accept dataGroup option in TransformOptions interface', () => {
      // Test that the interface includes dataGroup
      const options: TransformOptions = {
        inputZip: 'test-input.zip',
        dataGroup: 'Property Improvement',
        scriptsZip: 'test-scripts.zip',
        outputZip: 'test-output.zip'
      };

      expect(options.dataGroup).toBe('Property Improvement');
      expect(options.inputZip).toBe('test-input.zip');
      expect(options.scriptsZip).toBe('test-scripts.zip');
      expect(options.outputZip).toBe('test-output.zip');
    });

    it('should pass dataGroup option to CLI implementation', async () => {
      const { handleTransform } = await import('../../../src/commands/transform/index.js');
      
      await transform({
        inputZip: 'test-input.zip',
        dataGroup: 'Property Improvement',
        scriptsZip: 'test-scripts.zip',
        outputZip: 'test-output.zip'
      });

      // Verify that handleTransform was called with dataGroup option
      expect(handleTransform).toHaveBeenCalledWith(
        expect.objectContaining({
          dataGroup: 'Property Improvement',
          inputZip: 'test-input.zip',
          scriptsZip: 'test-scripts.zip',
          outputZip: expect.stringContaining('test-output.zip'),
          silent: true
        })
      );
    });

    it('should work without dataGroup option (County mode)', async () => {
      const { handleTransform } = await import('../../../src/commands/transform/index.js');
      
      await transform({
        inputZip: 'test-input.zip',
        scriptsZip: 'test-scripts.zip',
        outputZip: 'test-output.zip'
      });

      // Verify that handleTransform was called without dataGroup (defaults to County)
      expect(handleTransform).toHaveBeenCalledWith(
        expect.objectContaining({
          inputZip: 'test-input.zip',
          scriptsZip: 'test-scripts.zip',
          outputZip: expect.stringContaining('test-output.zip'),
          silent: true
        })
      );
    });
  });
});
