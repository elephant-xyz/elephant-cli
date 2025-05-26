import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock chalk using factory functions to avoid hoisting issues
vi.mock('chalk', () => ({
  __esModule: true, 
  default: { 
    blue: vi.fn((text: string) => `blue(${text})`),
    green: vi.fn((text: string) => `green(${text})`),
    red: vi.fn((text: string) => `red(${text})`),
    yellow: vi.fn((text: string) => `yellow(${text})`),
  }
}));

// Import SUT (logger) AFTER the mocks
import { logger } from '../../../src/utils/logger';
import chalk from 'chalk';

describe('logger', () => {
  let consoleLogSpy: any;
  let consoleErrorSpy: any;
  let consoleWarnSpy: any;
  let consoleInfoSpy: any;

  beforeEach(() => {
    vi.clearAllMocks();

    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    consoleInfoSpy.mockRestore();
  });

  it('should log an info message with blue color', () => {
    const message = 'This is an info message.';
    logger.info(message);
    expect(chalk.blue).toHaveBeenCalledWith(message);
    expect(consoleInfoSpy).toHaveBeenCalledWith(`blue(${message})`);
  });

  it('should log a success message with green color', () => {
    const message = 'Operation successful.';
    logger.success(message);
    expect(chalk.green).toHaveBeenCalledWith(message);
    expect(consoleLogSpy).toHaveBeenCalledWith(`green(${message})`);
  });

  it('should log an error message with red color', () => {
    const message = 'An error occurred.';
    logger.error(message);
    expect(chalk.red).toHaveBeenCalledWith(message);
    expect(consoleErrorSpy).toHaveBeenCalledWith(`red(${message})`);
  });

  it('should log a warning message with yellow color', () => {
    const message = 'This is a warning.';
    logger.warn(message);
    expect(chalk.yellow).toHaveBeenCalledWith(message);
    expect(consoleWarnSpy).toHaveBeenCalledWith(`yellow(${message})`);
  });

  it('should log a plain message without color', () => {
    const message = 'Plain log message.';
    logger.log(message); // Assuming logger.log is intended to be console.log without chalk
    expect(chalk.blue).not.toHaveBeenCalled();
    expect(chalk.green).not.toHaveBeenCalled();
    expect(chalk.red).not.toHaveBeenCalled();
    expect(chalk.yellow).not.toHaveBeenCalled();
    expect(consoleLogSpy).toHaveBeenCalledWith(message);
  });
});