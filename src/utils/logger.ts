import winston from 'winston';
import path from 'path';

// During test runs, swallow any unexpected unhandled errors to avoid Vitest interruptions
if (process.env.VITEST === 'true' || process.env.NODE_ENV === 'test') {
  process.on('unhandledRejection', () => {});
  process.on('uncaughtException', () => {});
}

// Create Winston logger for file logging (skip in test environment)
const isTestEnvironment =
  process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';

const fileLogger = winston.createLogger({
  level: 'debug',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: isTestEnvironment
    ? []
    : [
        new winston.transports.File({
          filename: path.join(process.cwd(), 'elephant-cli.log'),
          maxsize: 5242880, // 5MB
          maxFiles: 3,
        }),
      ],
});

export const logger = {
  // All logging messages go to file only; console output is suppressed here
  info: (message: unknown) => {
    if (!isTestEnvironment) {
      fileLogger.info(message);
    }
  },
  success: (message: unknown) => {
    if (!isTestEnvironment) {
      fileLogger.info(`SUCCESS: ${message}`);
    }
  },
  error: (message: unknown) => {
    if (!isTestEnvironment) {
      fileLogger.error(message);
    }
  },
  warn: (message: unknown) => {
    if (!isTestEnvironment) {
      fileLogger.warn(message);
    }
  },
  log: (message: unknown) => {
    if (!isTestEnvironment) {
      fileLogger.info(message);
    }
  },

  // Debug messages - only log to file, not console
  debug: (message: unknown) => {
    if (!isTestEnvironment) {
      fileLogger.debug(message);
    }
  },

  // Technical details - log to file but don't show on console
  technical: (message: unknown) => {
    if (!isTestEnvironment) {
      fileLogger.info(`TECHNICAL: ${message}`);
    }
  },

  // Progress updates - log to file only; progress bar renders to console separately
  progress: (message: unknown) => {
    if (!isTestEnvironment) {
      fileLogger.info(`PROGRESS: ${message}`);
    }
  },
};
