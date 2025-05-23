import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { createSpinner } from '../../../src/utils/progress';

// Create mock ora function
const mockOra = jest.fn();

// Mock ora module
jest.mock('ora', () => {
  return {
    __esModule: true,
    default: mockOra
  };
});

describe('progress utils', () => {
  let mockSpinner: any;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Create mock spinner instance
    mockSpinner = {
      start: jest.fn().mockReturnThis(),
      succeed: jest.fn().mockReturnThis(),
      fail: jest.fn().mockReturnThis(),
      stop: jest.fn().mockReturnThis(),
      warn: jest.fn().mockReturnThis(),
      info: jest.fn().mockReturnThis(),
      text: '',
      isSpinning: false,
    };

    // Mock ora to return our mock spinner
    mockOra.mockReturnValue(mockSpinner);
  });

  describe('createSpinner', () => {
    it('should create a spinner with the given text', () => {
      const text = 'Loading data...';
      
      const spinner = createSpinner(text);

      expect(mockOra).toHaveBeenCalledWith(text);
      expect(spinner).toBe(mockSpinner);
    });

    it('should start the spinner immediately', () => {
      const text = 'Processing...';
      
      createSpinner(text);

      expect(mockOra).toHaveBeenCalledWith(text);
      expect(mockSpinner.start).toHaveBeenCalledTimes(1);
    });

    it('should handle empty text', () => {
      createSpinner('');

      expect(mockOra).toHaveBeenCalledWith('');
      expect(mockSpinner.start).toHaveBeenCalled();
    });

    it('should handle special characters in text', () => {
      const specialText = '🚀 Loading with unicode! 测试 тест';
      
      createSpinner(specialText);

      expect(mockOra).toHaveBeenCalledWith(specialText);
    });

    it('should return ora instance that can be chained', () => {
      const spinner = createSpinner('Test');

      // Verify it returns the mock spinner which has chainable methods
      expect(spinner.start).toBeDefined();
      expect(spinner.succeed).toBeDefined();
      expect(spinner.fail).toBeDefined();
      expect(spinner.stop).toBeDefined();
    });

    it('should handle multiple spinner creation', () => {
      const spinner1 = createSpinner('First spinner');
      const spinner2 = createSpinner('Second spinner');
      const spinner3 = createSpinner('Third spinner');

      expect(mockOra).toHaveBeenCalledTimes(3);
      expect(mockOra).toHaveBeenNthCalledWith(1, 'First spinner');
      expect(mockOra).toHaveBeenNthCalledWith(2, 'Second spinner');
      expect(mockOra).toHaveBeenNthCalledWith(3, 'Third spinner');
      
      // Each should have start called
      expect(mockSpinner.start).toHaveBeenCalledTimes(3);
    });

    it('should create independent spinner instances', () => {
      const mockSpinner1 = {
        start: jest.fn().mockReturnThis(),
        text: 'Spinner 1',
      };
      const mockSpinner2 = {
        start: jest.fn().mockReturnThis(),
        text: 'Spinner 2',
      };

      mockOra
        .mockReturnValueOnce(mockSpinner1)
        .mockReturnValueOnce(mockSpinner2);

      const spinner1 = createSpinner('First');
      const spinner2 = createSpinner('Second');

      expect(spinner1).not.toBe(spinner2);
      expect(spinner1.text).toBe('Spinner 1');
      expect(spinner2.text).toBe('Spinner 2');
    });

    it('should handle very long text', () => {
      const longText = 'A'.repeat(1000);
      
      createSpinner(longText);

      expect(mockOra).toHaveBeenCalledWith(longText);
      expect(mockSpinner.start).toHaveBeenCalled();
    });

    it('should handle multiline text', () => {
      const multilineText = 'Line 1\nLine 2\nLine 3';
      
      createSpinner(multilineText);

      expect(mockOra).toHaveBeenCalledWith(multilineText);
    });

    it('should be used correctly in async context', async () => {
      const spinner = createSpinner('Async operation...');
      
      // Simulate async operation
      await new Promise(resolve => setTimeout(resolve, 10));
      
      // Verify spinner can be controlled after async operation
      spinner.succeed('Done!');
      
      expect(mockSpinner.succeed).toHaveBeenCalledWith('Done!');
    });

    it('should handle errors gracefully', () => {
      // Test that if ora throws an error, it's propagated
      const error = new Error('Ora initialization failed');
      mockOra.mockImplementation(() => {
        throw error;
      });

      expect(() => createSpinner('Test')).toThrow('Ora initialization failed');
    });
  });
});