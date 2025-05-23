import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import chalk from 'chalk';
import { logger } from '../../../src/utils/logger';

// Mock chalk
jest.mock('chalk', () => ({
  default: {
    blue: jest.fn((text: string) => `[BLUE]${text}[/BLUE]`),
    green: jest.fn((text: string) => `[GREEN]${text}[/GREEN]`),
    red: jest.fn((text: string) => `[RED]${text}[/RED]`),
    yellow: jest.fn((text: string) => `[YELLOW]${text}[/YELLOW]`),
  },
}));

describe('logger', () => {
  let consoleLogSpy: jest.SpiedFunction<typeof console.log>;

  beforeEach(() => {
    jest.clearAllMocks();
    // Override the global console mock from setup.ts for these tests
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  describe('info', () => {
    it('should log info message with blue icon', () => {
      const message = 'This is an info message';
      
      logger.info(message);

      expect(chalk.blue).toHaveBeenCalledWith('ℹ');
      expect(consoleLogSpy).toHaveBeenCalledWith('[BLUE]ℹ[/BLUE]', message);
    });

    it('should handle empty info message', () => {
      logger.info('');

      expect(consoleLogSpy).toHaveBeenCalledWith('[BLUE]ℹ[/BLUE]', '');
    });

    it('should handle special characters in info message', () => {
      const message = 'Info with special chars: !@#$%^&*()';
      
      logger.info(message);

      expect(consoleLogSpy).toHaveBeenCalledWith('[BLUE]ℹ[/BLUE]', message);
    });
  });

  describe('success', () => {
    it('should log success message with green checkmark', () => {
      const message = 'Operation completed successfully';
      
      logger.success(message);

      expect(chalk.green).toHaveBeenCalledWith('✓');
      expect(consoleLogSpy).toHaveBeenCalledWith('[GREEN]✓[/GREEN]', message);
    });

    it('should handle multiline success message', () => {
      const message = 'Success\nwith\nmultiple\nlines';
      
      logger.success(message);

      expect(consoleLogSpy).toHaveBeenCalledWith('[GREEN]✓[/GREEN]', message);
    });
  });

  describe('error', () => {
    it('should log error message with red X', () => {
      const message = 'An error occurred';
      
      logger.error(message);

      expect(chalk.red).toHaveBeenCalledWith('✗');
      expect(consoleLogSpy).toHaveBeenCalledWith('[RED]✗[/RED]', message);
    });

    it('should handle error objects converted to strings', () => {
      const errorMessage = 'Error: Something went wrong';
      
      logger.error(errorMessage);

      expect(consoleLogSpy).toHaveBeenCalledWith('[RED]✗[/RED]', errorMessage);
    });
  });

  describe('warn', () => {
    it('should log warning message with yellow warning sign', () => {
      const message = 'This is a warning';
      
      logger.warn(message);

      expect(chalk.yellow).toHaveBeenCalledWith('⚠');
      expect(consoleLogSpy).toHaveBeenCalledWith('[YELLOW]⚠[/YELLOW]', message);
    });

    it('should handle numeric values converted to strings', () => {
      const message = '42';
      
      logger.warn(message);

      expect(consoleLogSpy).toHaveBeenCalledWith('[YELLOW]⚠[/YELLOW]', message);
    });
  });

  describe('all methods', () => {
    it('should use correct icons for each log level', () => {
      logger.info('info');
      logger.success('success');
      logger.error('error');
      logger.warn('warn');

      expect(consoleLogSpy).toHaveBeenCalledTimes(4);
      
      // Verify icons
      expect(consoleLogSpy).toHaveBeenNthCalledWith(1, expect.stringContaining('ℹ'), 'info');
      expect(consoleLogSpy).toHaveBeenNthCalledWith(2, expect.stringContaining('✓'), 'success');
      expect(consoleLogSpy).toHaveBeenNthCalledWith(3, expect.stringContaining('✗'), 'error');
      expect(consoleLogSpy).toHaveBeenNthCalledWith(4, expect.stringContaining('⚠'), 'warn');
    });

    it('should apply correct colors', () => {
      logger.info('test');
      logger.success('test');
      logger.error('test');
      logger.warn('test');

      expect(chalk.blue).toHaveBeenCalledTimes(1);
      expect(chalk.green).toHaveBeenCalledTimes(1);
      expect(chalk.red).toHaveBeenCalledTimes(1);
      expect(chalk.yellow).toHaveBeenCalledTimes(1);
    });

    it('should handle very long messages', () => {
      const longMessage = 'A'.repeat(1000);
      
      logger.info(longMessage);
      logger.success(longMessage);
      logger.error(longMessage);
      logger.warn(longMessage);

      expect(consoleLogSpy).toHaveBeenCalledTimes(4);
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.any(String), longMessage);
    });

    it('should handle unicode characters', () => {
      const unicodeMessage = '🚀 Unicode test 测试 тест';
      
      logger.info(unicodeMessage);

      expect(consoleLogSpy).toHaveBeenCalledWith('[BLUE]ℹ[/BLUE]', unicodeMessage);
    });
  });
});