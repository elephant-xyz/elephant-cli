import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSpinner } from '../../../src/utils/progress';

// Define the shape of the mock spinner instance at the module level
const mockSpinnerInstance = {
  start: vi.fn().mockReturnThis(),
  succeed: vi.fn().mockReturnThis(),
  fail: vi.fn().mockReturnThis(),
  stop: vi.fn().mockReturnThis(),
  warn: vi.fn().mockReturnThis(),
  info: vi.fn().mockReturnThis(),
  text: '',
  isSpinning: false,
};

// Mock ora module
const mockOra = vi.fn((text?: string) => {
  mockSpinnerInstance.text = text || ''; // Optionally capture text if needed
  return mockSpinnerInstance;
});

vi.mock('ora', () => ({ default: mockOra }));

describe('progress utils', () => {
  // No need for `let mockSpinner: any;` here anymore, use mockSpinnerInstance directly

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Reset individual methods on mockSpinnerInstance
    mockSpinnerInstance.start.mockClear().mockReturnThis();
    mockSpinnerInstance.succeed.mockClear().mockReturnThis();
    mockSpinnerInstance.fail.mockClear().mockReturnThis();
    mockSpinnerInstance.stop.mockClear().mockReturnThis();
    mockSpinnerInstance.warn.mockClear().mockReturnThis();
    mockSpinnerInstance.info.mockClear().mockReturnThis();
    mockSpinnerInstance.text = '';
    mockSpinnerInstance.isSpinning = false;
  });

  describe('createSpinner', () => {
    it('should create a spinner with the given text', () => {
      const text = 'Loading data...';

      const spinner = createSpinner(text);

      expect(mockOra).toHaveBeenCalledWith(text);
      expect(spinner).toBe(mockSpinnerInstance);
    });

    it('should start the spinner immediately', () => {
      const text = 'Processing...';
      
      createSpinner(text);

      expect(mockOra).toHaveBeenCalledWith(text);
      expect(mockSpinnerInstance.start).toHaveBeenCalledTimes(1);
    });

    it('should handle empty text', () => {
      createSpinner('');

      expect(mockOra).toHaveBeenCalledWith('');
      expect(mockSpinnerInstance.start).toHaveBeenCalled();
    });

    it('should handle special characters in text', () => {
      const specialText = '🚀 Loading with unicode! 测试 тест';
      
      createSpinner(specialText);

      expect(mockOra).toHaveBeenCalledWith(specialText);
    });

    it('should return ora instance that can be chained', () => {
      const spinner = createSpinner('Test');

      expect(spinner.start).toBeDefined();
      expect(spinner.succeed).toBeDefined();
      expect(spinner.fail).toBeDefined();
      expect(spinner.stop).toBeDefined();
      expect(spinner).toBe(mockSpinnerInstance);
    });

    it('should handle multiple spinner creation', () => {
      const spinner1 = createSpinner('First spinner');
      const spinner2 = createSpinner('Second spinner');
      const spinner3 = createSpinner('Third spinner');

      expect(mockOra).toHaveBeenCalledTimes(3);
      expect(mockOra).toHaveBeenNthCalledWith(1, 'First spinner');
      expect(mockOra).toHaveBeenNthCalledWith(2, 'Second spinner');
      expect(mockOra).toHaveBeenNthCalledWith(3, 'Third spinner');
      
      expect(mockSpinnerInstance.start).toHaveBeenCalledTimes(3);
    });

    it('should create independent spinner instances (conceptually, though mock is shared)', () => {
      // With the current mock structure, ora() always returns the same mockSpinnerInstance.
      // This is usually fine for testing, as we reset its state in beforeEach.
      // If true independence is needed, the mock factory for 'ora' would need to be more complex.
      const spinner1 = createSpinner('First');
      // mockSpinnerInstance.text would be 'First' here
      const spinner2 = createSpinner('Second');
      // mockSpinnerInstance.text would be 'Second' here

      expect(mockOra).toHaveBeenCalledWith('First');
      expect(mockOra).toHaveBeenCalledWith('Second');
      // spinner1 and spinner2 will be the same object: mockSpinnerInstance
      expect(spinner1).toBe(mockSpinnerInstance);
      expect(spinner2).toBe(mockSpinnerInstance);
      expect(mockSpinnerInstance.text).toBe('Second'); // Reflects the last call
    });

    it('should handle very long text', () => {
      const longText = 'A'.repeat(1000);
      
      createSpinner(longText);

      expect(mockOra).toHaveBeenCalledWith(longText);
      expect(mockSpinnerInstance.start).toHaveBeenCalled();
    });

    it('should handle multiline text', () => {
      const multilineText = 'Line 1\nLine 2\nLine 3';
      
      createSpinner(multilineText);

      expect(mockOra).toHaveBeenCalledWith(multilineText);
    });

    it('should be used correctly in async context', async () => {
      const spinner = createSpinner('Async operation...');
      
      await new Promise(resolve => setTimeout(resolve, 10));
      
      spinner.succeed('Done!');
      
      expect(mockSpinnerInstance.succeed).toHaveBeenCalledWith('Done!');
    });

    it('should handle errors gracefully if ora itself throws (not covered by this mock)', () => {
      // To test if createSpinner handles errors from ora,
      // the mock for ora would need to throw an error.
      const error = new Error('Ora initialization failed');
      mockOra.mockImplementationOnce(() => { // Note: mockImplementationOnce
        throw error;
      });

      expect(() => createSpinner('Test')).toThrow('Ora initialization failed');
    });
  });
});