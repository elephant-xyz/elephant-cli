import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';
import { spawn } from 'child_process';
import { logger } from '../../../utils/logger.js';

export async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

export function assertSubPath(baseDir: string, targetPath: string): void {
  const resolvedBase = path.resolve(baseDir);
  const resolvedTarget = path.resolve(targetPath);
  const rel = path.relative(resolvedBase, resolvedTarget);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`Path outside of allowed directory: ${targetPath}`);
  }
}

export async function writeTextFile(
  baseDir: string,
  relativePath: string,
  content: string
): Promise<{ bytesWritten: number; absPath: string } | never> {
  const absPath = path.join(baseDir, relativePath);
  assertSubPath(baseDir, absPath);
  await ensureDir(path.dirname(absPath));
  await fs.writeFile(absPath, content, 'utf-8');
  return { bytesWritten: Buffer.byteLength(content, 'utf-8'), absPath };
}

export async function readTextFile(
  baseDir: string,
  relativePath: string
): Promise<string> {
  const absPath = path.join(baseDir, relativePath);
  assertSubPath(baseDir, absPath);
  const data = await fs.readFile(absPath, 'utf-8');
  return data;
}

export function sha256(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

export async function prettierFormat(content: string): Promise<string> {
  // Lazy import prettier to avoid ESM loader churn
  const prettier = await import('prettier');
  return prettier.format(content, { parser: 'babel' });
}

export async function acornParse(content: string): Promise<void> {
  const acorn = await import('acorn');
  try {
    acorn.parse(content, { ecmaVersion: 'latest', sourceType: 'module' });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Syntax error: ${msg}`);
  }
}

export async function execNodeScript(
  entryAbsPath: string,
  args: string[] = [],
  timeoutMs: number = 30000,
  cwd?: string
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', [entryAbsPath, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NODE_ENV: process.env.NODE_ENV || 'production' },
      cwd,
    });

    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      logger.warn(
        `Killing script due to timeout after ${timeoutMs}ms: ${entryAbsPath}`
      );
      proc.kill('SIGKILL');
      reject(new Error('E_TIMEOUT'));
    }, timeoutMs);

    proc.stdout.on('data', (d) => (stdout += d.toString()));
    proc.stderr.on('data', (d) => (stderr += d.toString()));

    proc.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}
