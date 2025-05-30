import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock chalk using factory functions to avoid hoisting issues
vi.mock('chalk', () => ({
  __esModule: true,
  default: {
    blue: vi.fn((text: string) => `blue(${text})`),
    green: vi.fn((text: string) => `green(${text})`),
    red: vi.fn((text: string) => `red(${text})`),
    yellow: vi.fn((text: string) => `yellow(${text})`),
  },
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

  it('should not output anything to console in test environment', () => {
    const msg = 'Test message';
    logger.info(msg);
    logger.success(msg);
    logger.error(msg);
    logger.warn(msg);
    logger.log(msg);
    logger.debug(msg);
    logger.technical(msg);
    logger.progress(msg);
    expect(consoleInfoSpy).not.toHaveBeenCalled();
    expect(consoleLogSpy).not.toHaveBeenCalled();
    expect(consoleWarnSpy).not.toHaveBeenCalled();
    expect(consoleErrorSpy).not.toHaveBeenCalled();
    expect(chalk.blue).not.toHaveBeenCalled();
    expect(chalk.green).not.toHaveBeenCalled();
    expect(chalk.red).not.toHaveBeenCalled();
    expect(chalk.yellow).not.toHaveBeenCalled();
  });
});
