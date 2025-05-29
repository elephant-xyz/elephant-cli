import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock ora module using factory function to avoid hoisting issues
vi.mock('ora', () => ({
  default: vi.fn((options) => {
    const mockSpinnerInstance = {
      start: vi.fn().mockReturnThis(),
      succeed: vi.fn().mockReturnThis(),
      fail: vi.fn().mockReturnThis(),
      stop: vi.fn().mockReturnThis(),
      warn: vi.fn().mockReturnThis(),
      info: vi.fn().mockReturnThis(),
      text: options?.text || '',
      isSpinning: false,
    };
    return mockSpinnerInstance;
  }),
}));

import ora from 'ora';
import { createSpinner } from '../../../src/utils/progress';

describe('progress utils', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createSpinner', () => {
    it('should create a spinner with the given text', () => {
      const text = 'Loading data...';

      const spinner = createSpinner(text);

      expect(ora).toHaveBeenCalledWith({ text });
      expect(spinner).toBeDefined();
    });

    it('should start the spinner immediately', () => {
      const text = 'Processing...';

      const spinner = createSpinner(text);

      expect(ora).toHaveBeenCalledWith({ text });
      expect(spinner.start).toHaveBeenCalledTimes(1);
    });

    it('should handle empty text', () => {
      const text = '';
      const spinner = createSpinner(text);

      expect(ora).toHaveBeenCalledWith({ text });
      expect(spinner.start).toHaveBeenCalled();
    });

    it('should handle special characters in text', () => {
      const specialText = '🚀 Loading with unicode! 测试 тест';

      createSpinner(specialText);

      expect(ora).toHaveBeenCalledWith({ text: specialText });
    });

    it('should return ora instance that can be chained', () => {
      const spinner = createSpinner('Test');

      expect(spinner.start).toBeDefined();
      expect(spinner.succeed).toBeDefined();
      expect(spinner.fail).toBeDefined();
      expect(spinner.stop).toBeDefined();
      expect(spinner).toBeDefined();
    });

    it('should handle multiple spinner creation', () => {
      const spinner1 = createSpinner('First spinner');
      const spinner2 = createSpinner('Second spinner');
      const spinner3 = createSpinner('Third spinner');

      expect(ora).toHaveBeenCalledTimes(3);
      expect(ora).toHaveBeenNthCalledWith(1, { text: 'First spinner' });
      expect(ora).toHaveBeenNthCalledWith(2, { text: 'Second spinner' });
      expect(ora).toHaveBeenNthCalledWith(3, { text: 'Third spinner' });
    });

    it('should create independent spinner instances', () => {
      const spinner1 = createSpinner('First');
      const spinner2 = createSpinner('Second');

      expect(ora).toHaveBeenCalledWith({ text: 'First' });
      expect(ora).toHaveBeenCalledWith({ text: 'Second' });
      expect(spinner1).toBeDefined();
      expect(spinner2).toBeDefined();
    });

    it('should handle very long text', () => {
      const longText = 'A'.repeat(1000);

      const spinner = createSpinner(longText);

      expect(ora).toHaveBeenCalledWith({ text: longText });
      expect(spinner.start).toHaveBeenCalled();
    });

    it('should handle multiline text', () => {
      const multilineText = 'Line 1\nLine 2\nLine 3';

      createSpinner(multilineText);

      expect(ora).toHaveBeenCalledWith({ text: multilineText });
    });

    it('should be used correctly in async context', async () => {
      const spinner = createSpinner('Async operation...');

      await new Promise((resolve) => setTimeout(resolve, 10));

      spinner.succeed('Done!');

      expect(spinner.succeed).toHaveBeenCalledWith('Done!');
    });

    it('should handle errors gracefully if ora itself throws', () => {
      // To test if createSpinner handles errors from ora,
      // the mock for ora would need to throw an error.
      const error = new Error('Ora initialization failed');
      vi.mocked(ora).mockImplementationOnce(() => {
        // Note: mockImplementationOnce
        throw error;
      });

      expect(() => createSpinner('Test')).toThrow('Ora initialization failed');
    });
  });
});
