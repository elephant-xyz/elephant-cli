import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync } from 'fs';
import { spawnSync, execSync } from 'child_process';
import { runAIAgent } from '../../../src/utils/ai-agent.js';

// Mock modules
vi.mock('fs');
vi.mock('child_process');
vi.mock('../../../src/utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
  },
}));

describe('AI-Agent utility', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset environment variables
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.resetAllMocks();
  });

  describe('runAIAgent', () => {
    it('should use explicit path from environment variable when set', () => {
      const localBinPath = '/custom/path/test-evaluator-agent';
      process.env.ELEPHANT_AI_AGENT_PATH = localBinPath;

      vi.mocked(existsSync).mockImplementation((path) => path === localBinPath);
      vi.mocked(spawnSync).mockReturnValue({
        status: 0,
        signal: null,
        output: [],
        pid: 123,
        stdout: Buffer.from(''),
        stderr: Buffer.from(''),
      } as any);

      const args = [
        '--transform',
        '--group',
        'seed',
        '--input-csv',
        'data.csv',
      ];
      const exitCode = runAIAgent(args);

      expect(existsSync).toHaveBeenCalledWith(localBinPath);
      expect(spawnSync).toHaveBeenCalledWith(
        localBinPath,
        args,
        expect.objectContaining({
          stdio: ['inherit', 'pipe', 'inherit'],
          cwd: process.cwd(),
        })
      );
      expect(exitCode).toBe(0);
    });

    it('should use binary found via which command', () => {
      delete process.env.ELEPHANT_AI_AGENT_PATH;
      const whichPath = '/usr/local/bin/test-evaluator-agent';

      vi.mocked(execSync).mockImplementation((cmd: any) => {
        if (cmd === 'which test-evaluator-agent') {
          return whichPath + '\n';
        }
        return '';
      });
      vi.mocked(existsSync).mockImplementation((path) => path === whichPath);
      vi.mocked(spawnSync).mockReturnValue({
        status: 0,
        signal: null,
        output: [],
        pid: 123,
        stdout: Buffer.from(''),
        stderr: Buffer.from(''),
      } as any);

      const args = ['--transform', '--group', 'seed'];
      const exitCode = runAIAgent(args);

      expect(execSync).toHaveBeenCalledWith(
        'which test-evaluator-agent',
        expect.any(Object)
      );
      expect(spawnSync).toHaveBeenCalledWith(
        whichPath,
        args,
        expect.objectContaining({
          stdio: ['inherit', 'pipe', 'inherit'],
          cwd: process.cwd(),
        })
      );
      expect(exitCode).toBe(0);
    });

    it('should fall back to uvx when no local binary exists', () => {
      delete process.env.ELEPHANT_AI_AGENT_PATH;

      // Mock 'which' to throw (command not found)
      vi.mocked(execSync).mockImplementation((cmd: any) => {
        if (cmd === 'which test-evaluator-agent') {
          throw new Error('command not found');
        }
        return '';
      });

      // No binary exists anywhere
      vi.mocked(existsSync).mockReturnValue(false);

      vi.mocked(spawnSync).mockReturnValue({
        status: 0,
        signal: null,
        output: [],
        pid: 456,
        stdout: Buffer.from(''),
        stderr: Buffer.from(''),
      } as any);

      const args = [
        '--transform',
        '--group',
        'county',
        '--input-zip',
        'data.zip',
      ];
      const exitCode = runAIAgent(args);

      expect(spawnSync).toHaveBeenCalledWith(
        'uvx',
        [
          '--from',
          expect.stringContaining(
            'git+https://github.com/elephant-xyz/AI-Agent@'
          ),
          'test-evaluator-agent',
          ...args,
        ],
        expect.objectContaining({
          stdio: ['inherit', 'pipe', 'inherit'],
          cwd: process.cwd(),
        })
      );
      expect(exitCode).toBe(0);
    });

    it('should use default /opt/elephant location when which fails but file exists', () => {
      delete process.env.ELEPHANT_AI_AGENT_PATH;
      const defaultPath = '/opt/elephant/bin/test-evaluator-agent';

      // Mock 'which' to fail
      vi.mocked(execSync).mockImplementation((cmd: any) => {
        if (cmd === 'which test-evaluator-agent') {
          throw new Error('command not found');
        }
        return '';
      });

      // Default path exists
      vi.mocked(existsSync).mockImplementation((path) => path === defaultPath);

      vi.mocked(spawnSync).mockReturnValue({
        status: 0,
        signal: null,
        output: [],
        pid: 789,
        stdout: Buffer.from(''),
        stderr: Buffer.from(''),
      } as any);

      const args = ['--transform'];
      const exitCode = runAIAgent(args);

      expect(existsSync).toHaveBeenCalledWith(defaultPath);
      expect(spawnSync).toHaveBeenCalledWith(
        defaultPath,
        args,
        expect.objectContaining({
          stdio: ['inherit', 'pipe', 'inherit'],
          cwd: process.cwd(),
        })
      );
      expect(exitCode).toBe(0);
    });

    it('should throw error when local binary fails to execute', () => {
      const binPath = '/opt/elephant/bin/test-evaluator-agent';
      process.env.ELEPHANT_AI_AGENT_PATH = binPath;

      vi.mocked(existsSync).mockImplementation((path) => path === binPath);
      const error = new Error('Permission denied');
      vi.mocked(spawnSync).mockReturnValue({
        error,
        status: null,
        signal: null,
        output: [],
        pid: 0,
        stdout: Buffer.from(''),
        stderr: Buffer.from(''),
      } as any);

      expect(() => runAIAgent(['--transform'])).toThrow('Permission denied');
    });

    it('should throw error with helpful message when uvx is not installed', () => {
      delete process.env.ELEPHANT_AI_AGENT_PATH;

      // Mock 'which' to fail
      vi.mocked(execSync).mockImplementation((cmd: any) => {
        if (cmd === 'which test-evaluator-agent') {
          throw new Error('command not found');
        }
        return '';
      });

      vi.mocked(existsSync).mockReturnValue(false);
      const error: any = new Error('spawn uvx ENOENT');
      error.code = 'ENOENT';
      vi.mocked(spawnSync).mockReturnValue({
        error,
        status: null,
        signal: null,
        output: [],
        pid: 0,
        stdout: Buffer.from(''),
        stderr: Buffer.from(''),
      } as any);

      expect(() => runAIAgent(['--transform'])).toThrow('spawn uvx ENOENT');
    });

    it('should return non-zero exit code when AI-Agent fails', () => {
      const binPath = '/custom/bin/test-evaluator-agent';
      process.env.ELEPHANT_AI_AGENT_PATH = binPath;

      vi.mocked(existsSync).mockImplementation((path) => path === binPath);
      vi.mocked(spawnSync).mockReturnValue({
        status: 1,
        signal: null,
        output: [],
        pid: 123,
        stdout: Buffer.from(''),
        stderr: Buffer.from('Error'),
      } as any);

      const exitCode = runAIAgent(['--transform', '--invalid-arg']);

      expect(exitCode).toBe(1);
    });

    it('should return 1 when status is null', () => {
      const binPath = '/custom/bin/test-evaluator-agent';
      process.env.ELEPHANT_AI_AGENT_PATH = binPath;

      vi.mocked(existsSync).mockImplementation((path) => path === binPath);
      vi.mocked(spawnSync).mockReturnValue({
        status: null,
        signal: 'SIGTERM',
        output: [],
        pid: 123,
        stdout: Buffer.from(''),
        stderr: Buffer.from(''),
      } as any);

      const exitCode = runAIAgent(['--transform']);

      expect(exitCode).toBe(1);
    });

    it('should properly pass all arguments to the AI-Agent', () => {
      const binPath = '/usr/bin/test-evaluator-agent';
      process.env.ELEPHANT_AI_AGENT_PATH = binPath;

      vi.mocked(existsSync).mockImplementation((path) => path === binPath);
      vi.mocked(spawnSync).mockReturnValue({
        status: 0,
        signal: null,
        output: [],
        pid: 123,
        stdout: Buffer.from(''),
        stderr: Buffer.from(''),
      } as any);

      const args = [
        '--transform',
        '--group',
        'seed',
        '--input-csv',
        'test.csv',
        '--output-zip',
        'output.zip',
        '--verbose',
      ];

      runAIAgent(args);

      expect(spawnSync).toHaveBeenCalledWith(
        expect.any(String),
        args,
        expect.any(Object)
      );
    });
  });
});
