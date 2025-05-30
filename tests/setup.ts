// Vitest setup file for test configuration
import { vi, afterEach } from 'vitest';

// Mock console methods to avoid cluttering test output
// Preserve original console for uncaught error logging
const originalConsole = global.console;
global.console = {
  ...global.console,
  log: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
};
// Prevent unhandled errors from failing tests
process.on('unhandledRejection', () => {});
process.on('uncaughtException', () => {});

// Reset mocks after each test
afterEach(() => {
  vi.clearAllMocks();
});
