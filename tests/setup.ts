// Vitest setup file for test configuration
import { vi, afterEach } from 'vitest';

// Mock console methods to avoid cluttering test output
global.console = {
  ...console,
  log: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
};

// Reset mocks after each test
afterEach(() => {
  vi.clearAllMocks();
});
