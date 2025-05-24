import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';

// Define mock functions for chalk methods FIRST
const mockChalkBlue = jest.fn((text: string) => `blue(${text})`);
const mockChalkGreen = jest.fn((text: string) => `green(${text})`);
const mockChalkRed = jest.fn((text: string) => `red(${text})`);
const mockChalkYellow = jest.fn((text: string) => `yellow(${text})`);

// Mock chalk using the functions defined above.
// This mock factory will be hoisted, and the functions above will be in its closure.
jest.mock('chalk', () => ({
  __esModule: true, 
  default: { 
    blue: mockChalkBlue,
    green: mockChalkGreen,
    red: mockChalkRed,
    yellow: mockChalkYellow,
  }
}));

// Import SUT (logger) AFTER the mocks
import { logger } from '../../../src/utils/logger';

describe('logger', () => {
  let consoleLogSpy: jest.SpiedFunction<typeof console.log>;
  let consoleErrorSpy: jest.SpiedFunction<typeof console.error>;
  let consoleWarnSpy: jest.SpiedFunction<typeof console.warn>;
  let consoleInfoSpy: jest.SpiedFunction<typeof console.info>;

  beforeEach(() => {
    jest.clearAllMocks();

    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    consoleInfoSpy = jest.spyOn(console, 'info').mockImplementation(() => {});
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
    expect(mockChalkBlue).toHaveBeenCalledWith(message);
    expect(consoleInfoSpy).toHaveBeenCalledWith(`blue(${message})`);
  });

  it('should log a success message with green color', () => {
    const message = 'Operation successful.';
    logger.success(message);
    expect(mockChalkGreen).toHaveBeenCalledWith(message);
    expect(consoleLogSpy).toHaveBeenCalledWith(`green(${message})`);
  });

  it('should log an error message with red color', () => {
    const message = 'An error occurred.';
    logger.error(message);
    expect(mockChalkRed).toHaveBeenCalledWith(message);
    expect(consoleErrorSpy).toHaveBeenCalledWith(`red(${message})`);
  });

  it('should log a warning message with yellow color', () => {
    const message = 'This is a warning.';
    logger.warn(message);
    expect(mockChalkYellow).toHaveBeenCalledWith(message);
    expect(consoleWarnSpy).toHaveBeenCalledWith(`yellow(${message})`);
  });

  it('should log a plain message without color', () => {
    const message = 'Plain log message.';
    logger.log(message); // Assuming logger.log is intended to be console.log without chalk
    expect(mockChalkBlue).not.toHaveBeenCalled();
    expect(mockChalkGreen).not.toHaveBeenCalled();
    expect(mockChalkRed).not.toHaveBeenCalled();
    expect(mockChalkYellow).not.toHaveBeenCalled();
    expect(consoleLogSpy).toHaveBeenCalledWith(message);
  });
});