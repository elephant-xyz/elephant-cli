import chalk from 'chalk';
import winston from 'winston';
import path from 'path';

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
  // User-facing messages - show on console and log to file
  info: (message: string) => {
    console.info(chalk.blue(message));
    if (!isTestEnvironment) {
      fileLogger.info(message);
    }
  },
  success: (message: string) => {
    console.log(chalk.green(message));
    if (!isTestEnvironment) {
      fileLogger.info(`SUCCESS: ${message}`);
    }
  },
  error: (message: string) => {
    console.error(chalk.red(message));
    if (!isTestEnvironment) {
      fileLogger.error(message);
    }
  },
  warn: (message: string) => {
    console.warn(chalk.yellow(message));
    if (!isTestEnvironment) {
      fileLogger.warn(message);
    }
  },
  log: (message: string) => {
    console.log(message);
    if (!isTestEnvironment) {
      fileLogger.info(message);
    }
  },

  // Debug messages - only log to file, not console
  debug: (message: string) => {
    if (!isTestEnvironment) {
      fileLogger.debug(message);
    }
  },

  // Technical details - log to file but don't show on console
  technical: (message: string) => {
    if (!isTestEnvironment) {
      fileLogger.info(`TECHNICAL: ${message}`);
    }
  },

  // Progress updates - simple console output
  progress: (message: string) => {
    console.log(chalk.gray(`  ${message}`));
    if (!isTestEnvironment) {
      fileLogger.info(`PROGRESS: ${message}`);
    }
  },
};
