import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import { promises as fs } from 'fs';
import path from 'path';
import { runScriptsPipeline } from '../../../../src/commands/transform/script-runner.js';

vi.mock('child_process');
vi.mock('fs', () => ({
  promises: {
    readdir: vi.fn(),
  },
}));
vi.mock('../../../../src/utils/logger.js', () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));
vi.mock('../../../../src/utils/node-modules.js', () => ({
  linkNodeModulesIntoTemp: vi.fn(),
}));

describe('script-runner', () => {
  const mockSpawn = vi.mocked(spawn);
  const mockFsReaddir = vi.mocked(fs.readdir);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('execNode', () => {
    const createMockProcess = () => {
      const proc = new EventEmitter() as any;
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      proc.kill = vi.fn();
      return proc;
    };

    it('should execute script successfully with exit code 0', async () => {
      // Mock successful script files discovery BEFORE calling the function
      mockFsReaddir.mockResolvedValue([
        {
          name: 'ownerMapping.js',
          isFile: () => true,
          isDirectory: () => false,
        },
        {
          name: 'structureMapping.js',
          isFile: () => true,
          isDirectory: () => false,
        },
        {
          name: 'layoutMapping.js',
          isFile: () => true,
          isDirectory: () => false,
        },
        {
          name: 'utilityMapping.js',
          isFile: () => true,
          isDirectory: () => false,
        },
        {
          name: 'data_extractor.js',
          isFile: () => true,
          isDirectory: () => false,
        },
      ] as any);

      // Mock all 5 spawn calls upfront
      let spawnCallCount = 0;
      mockSpawn.mockImplementation(() => {
        const proc = createMockProcess();
        spawnCallCount++;

        setTimeout(() => {
          if (spawnCallCount === 1) {
            proc.stdout.emit('data', Buffer.from('stdout output'));
          }
          proc.emit('exit', 0, null);
          proc.emit('close');
        }, 10);

        return proc as any;
      });

      const executePromise = runScriptsPipeline('/scripts', '/work');

      await vi.runAllTimersAsync();
      await executePromise;

      expect(spawnCallCount).toBe(5);
    });

    it('should handle timeout and kill process', async () => {
      // Set up mocks BEFORE calling the function
      mockFsReaddir.mockResolvedValue([
        {
          name: 'ownerMapping.js',
          isFile: () => true,
          isDirectory: () => false,
        },
        {
          name: 'structureMapping.js',
          isFile: () => true,
          isDirectory: () => false,
        },
        {
          name: 'layoutMapping.js',
          isFile: () => true,
          isDirectory: () => false,
        },
        {
          name: 'utilityMapping.js',
          isFile: () => true,
          isDirectory: () => false,
        },
        {
          name: 'data_extractor.js',
          isFile: () => true,
          isDirectory: () => false,
        },
      ] as any);

      const timedOutProc = createMockProcess();
      let firstCall = true;

      mockSpawn.mockImplementation(() => {
        if (firstCall) {
          firstCall = false;
          // First process will timeout - don't emit any events yet
          return timedOutProc as any;
        }

        const proc = createMockProcess();
        setTimeout(() => {
          proc.emit('exit', 0, null);
          proc.emit('close');
        }, 10);
        return proc as any;
      });

      const executePromise = runScriptsPipeline('/scripts', '/work');

      // Add a catch handler to prevent unhandled rejection warning
      executePromise.catch(() => {
        /* expected error */
      });

      // Advance timer to trigger timeout (default 120000ms)
      await vi.advanceTimersByTimeAsync(120001);

      // Process should be killed
      expect(timedOutProc.kill).toHaveBeenCalledWith('SIGKILL');

      // Emit close after kill
      timedOutProc.emit('close');

      await expect(executePromise).rejects.toThrow(/timed out/);
    });
  });

  describe('runScriptsPipeline', () => {
    it('should fail if required script is missing', async () => {
      mockFsReaddir.mockResolvedValue([
        { name: 'some-other.js', isFile: () => true, isDirectory: () => false },
      ] as any);

      await expect(runScriptsPipeline('/scripts', '/work')).rejects.toThrow(
        'Required script not found: ownerMapping.js'
      );
    });

    it('should run all parallel scripts before data_extractor', async () => {
      const spawnCalls: string[] = [];

      mockFsReaddir.mockResolvedValue([
        {
          name: 'ownerMapping.js',
          isFile: () => true,
          isDirectory: () => false,
        },
        {
          name: 'structureMapping.js',
          isFile: () => true,
          isDirectory: () => false,
        },
        {
          name: 'layoutMapping.js',
          isFile: () => true,
          isDirectory: () => false,
        },
        {
          name: 'utilityMapping.js',
          isFile: () => true,
          isDirectory: () => false,
        },
        {
          name: 'data_extractor.js',
          isFile: () => true,
          isDirectory: () => false,
        },
      ] as any);

      mockSpawn.mockImplementation((_, args) => {
        const scriptName = args?.[2]
          ? path.basename(args[2] as string)
          : 'unknown';
        spawnCalls.push(scriptName);

        const proc = new EventEmitter() as any;
        proc.stdout = new EventEmitter();
        proc.stderr = new EventEmitter();
        proc.kill = vi.fn();

        setTimeout(() => {
          proc.emit('exit', 0, null);
          proc.emit('close');
        }, 10);

        return proc as any;
      });

      const executePromise = runScriptsPipeline('/scripts', '/work');
      await vi.runAllTimersAsync();
      await executePromise;

      // Verify parallel scripts were called before data_extractor
      const extractorIndex = spawnCalls.indexOf('data_extractor.js');
      const parallelScripts = [
        'ownerMapping.js',
        'structureMapping.js',
        'layoutMapping.js',
        'utilityMapping.js',
      ];

      expect(extractorIndex).toBeGreaterThan(0);
      parallelScripts.forEach((script) => {
        const idx = spawnCalls.indexOf(script);
        expect(idx).toBeGreaterThanOrEqual(0);
        expect(idx).toBeLessThan(extractorIndex);
      });
    });

    it('should fail fast when any parallel script fails', async () => {
      mockFsReaddir.mockResolvedValue([
        {
          name: 'ownerMapping.js',
          isFile: () => true,
          isDirectory: () => false,
        },
        {
          name: 'structureMapping.js',
          isFile: () => true,
          isDirectory: () => false,
        },
        {
          name: 'layoutMapping.js',
          isFile: () => true,
          isDirectory: () => false,
        },
        {
          name: 'utilityMapping.js',
          isFile: () => true,
          isDirectory: () => false,
        },
        {
          name: 'data_extractor.js',
          isFile: () => true,
          isDirectory: () => false,
        },
      ] as any);

      let callCount = 0;
      mockSpawn.mockImplementation(() => {
        const proc = new EventEmitter() as any;
        proc.stdout = new EventEmitter();
        proc.stderr = new EventEmitter();
        proc.kill = vi.fn();

        const currentCall = callCount++;

        setTimeout(() => {
          // Make structureMapping fail (second script)
          if (currentCall === 1) {
            proc.stderr.emit('data', Buffer.from('Structure mapping error'));
            proc.emit('exit', 1, null);
          } else {
            proc.emit('exit', 0, null);
          }
          proc.emit('close');
        }, 10);

        return proc as any;
      });

      const executePromise = runScriptsPipeline('/scripts', '/work');
      executePromise.catch(() => {
        /* expected error */
      });
      await vi.runAllTimersAsync();
      await expect(executePromise).rejects.toThrow(
        /Script failed.*structureMapping\.js.*Structure mapping error/s
      );

      // data_extractor should not be called
      expect(callCount).toBe(4); // Only the 4 parallel scripts
    });

    it('should fail if data_extractor fails after parallel success', async () => {
      mockFsReaddir.mockResolvedValue([
        {
          name: 'ownerMapping.js',
          isFile: () => true,
          isDirectory: () => false,
        },
        {
          name: 'structureMapping.js',
          isFile: () => true,
          isDirectory: () => false,
        },
        {
          name: 'layoutMapping.js',
          isFile: () => true,
          isDirectory: () => false,
        },
        {
          name: 'utilityMapping.js',
          isFile: () => true,
          isDirectory: () => false,
        },
        {
          name: 'data_extractor.js',
          isFile: () => true,
          isDirectory: () => false,
        },
      ] as any);

      let callCount = 0;
      mockSpawn.mockImplementation((_, args) => {
        const proc = new EventEmitter() as any;
        proc.stdout = new EventEmitter();
        proc.stderr = new EventEmitter();
        proc.kill = vi.fn();

        const scriptName = args?.[2] ? path.basename(args[2] as string) : '';
        callCount++;

        setTimeout(() => {
          if (scriptName === 'data_extractor.js') {
            proc.stderr.emit('data', Buffer.from('Extraction failed'));
            proc.emit('exit', 1, null);
          } else {
            proc.emit('exit', 0, null);
          }
          proc.emit('close');
        }, 10);

        return proc as any;
      });

      const executePromise = runScriptsPipeline('/scripts', '/work');
      executePromise.catch(() => {
        /* expected error */
      });
      await vi.runAllTimersAsync();
      await expect(executePromise).rejects.toThrow(
        /Script failed.*data_extractor\.js.*Extraction failed/s
      );

      expect(callCount).toBe(5); // All scripts should be called
    });

    it('should handle null exit code as -1', async () => {
      mockFsReaddir.mockResolvedValue([
        {
          name: 'ownerMapping.js',
          isFile: () => true,
          isDirectory: () => false,
        },
        {
          name: 'structureMapping.js',
          isFile: () => true,
          isDirectory: () => false,
        },
        {
          name: 'layoutMapping.js',
          isFile: () => true,
          isDirectory: () => false,
        },
        {
          name: 'utilityMapping.js',
          isFile: () => true,
          isDirectory: () => false,
        },
        {
          name: 'data_extractor.js',
          isFile: () => true,
          isDirectory: () => false,
        },
      ] as any);

      let isFirstCall = true;
      mockSpawn.mockImplementation(() => {
        const proc = new EventEmitter() as any;
        proc.stdout = new EventEmitter();
        proc.stderr = new EventEmitter();
        proc.kill = vi.fn();

        setTimeout(() => {
          if (isFirstCall) {
            isFirstCall = false;
            proc.emit('exit', null, null);
          } else {
            proc.emit('exit', 0, null);
          }
          proc.emit('close');
        }, 10);

        return proc as any;
      });

      const executePromise = runScriptsPipeline('/scripts', '/work');
      executePromise.catch(() => {
        /* expected error */
      });
      await vi.runAllTimersAsync();
      await expect(executePromise).rejects.toThrow(/code=-1/);
    });
  });
});
