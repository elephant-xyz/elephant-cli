import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.spec.ts'],
    testTimeout: 15000, // 15 seconds for integration tests
    coverage: {
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts', 'src/**/*.cts'],
      exclude: ['src/**/*.d.ts', 'src/index.ts'],
      thresholds: {
        global: {
          branches: 80,
          functions: 80,
          lines: 80,
          statements: 80,
        },
      },
    },
    setupFiles: ['tests/setup.ts'],
  },
  resolve: {
    extensions: ['.ts', '.tsx', '.js', '.jsx', '.cts', '.mts', '.cjs', '.mjs'],
    alias: {
      '@': '/src',
    },
  },
  esbuild: {
    loader: 'ts',
    include: /\.[cm]?ts$/,
    exclude: [],
    target: 'es2022',
  },
  optimizeDeps: {
    esbuildOptions: {
      loader: {
        '.cts': 'ts',
        '.cjs': 'js',
      },
    },
  },
});
