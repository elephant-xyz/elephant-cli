import { promises as fs } from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { logger } from '../../utils/logger.js';
import { linkNodeModulesIntoTemp } from '../../utils/node-modules.js';

function execNode(
  entryAbsPath: string,
  args: string[],
  cwd: string,
  timeoutMs: number
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', [entryAbsPath, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd,
      env: { ...process.env, NODE_ENV: process.env.NODE_ENV || 'production' },
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
    proc.stdout.on('data', (d) => {
      stdout += d.toString();
    });
    proc.stderr.on('data', (d) => {
      stderr += d.toString();
    });
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

export async function runScriptsPipeline(
  scriptsDir: string,
  workDir: string,
  opts?: { extractorOnly?: boolean }
): Promise<void> {
  // Resolve script paths by name; scripts may be placed anywhere in scriptsDir
  const resolveScript = async (name: string): Promise<string> => {
    const found = await findFileRecursive(scriptsDir, name);
    if (!found) throw new Error(`Required script not found: ${name}`);
    return found;
  };
  linkNodeModulesIntoTemp(workDir);
  const timeoutMs = 120000; // 2 minutes default per script
  const extractorOnly = opts?.extractorOnly === true;

  if (!extractorOnly) {
    const owner = await resolveScript('ownerMapping.js');
    const structure = await resolveScript('structureMapping.js');
    const layout = await resolveScript('layoutMapping.js');
    const utility = await resolveScript('utilityMapping.js');
    const parallel = await Promise.all([
      execNode(owner, [], workDir, timeoutMs),
      execNode(structure, [], workDir, timeoutMs),
      execNode(layout, [], workDir, timeoutMs),
      execNode(utility, [], workDir, timeoutMs),
    ]);
    for (const [idx, res] of parallel.entries()) {
      if (res.code === 0) continue;
      const names = [
        'ownerMapping.js',
        'structureMapping.js',
        'layoutMapping.js',
        'utilityMapping.js',
      ];
      logger.error(`Script ${names[idx]} failed with code ${res.code}`);
      if (res.stderr) logger.error(res.stderr.trim());
      if (res.stdout) logger.error(res.stdout.trim());
      throw new Error(`Script failed: ${names[idx]}`);
    }
  }

  // In extractorOnly mode, allow any JS script(s) to run if data_extractor.js is absent
  try {
    const extraction = await resolveScript('data_extractor.js');
    const finalRes = await execNode(extraction, [], workDir, timeoutMs);
    if (finalRes.code !== 0) {
      if (finalRes.stderr) logger.error(finalRes.stderr.trim());
      if (finalRes.stdout) logger.error(finalRes.stdout.trim());
      throw new Error('data_extractor.js failed');
    }
    return;
  } catch {
    if (!extractorOnly) {
      throw new Error('Required script not found: data_extractor.js');
    }
    // Fallback: run all .js files inside scriptsDir
    const allScripts: string[] = await listAllJsFiles(scriptsDir);
    if (allScripts.length === 0) {
      throw new Error('No executable JS scripts found in scripts bundle');
    }
    for (const scriptPath of allScripts) {
      const res = await execNode(scriptPath, [], workDir, timeoutMs);
      if (res.code !== 0) {
        if (res.stderr) logger.error(res.stderr.trim());
        if (res.stdout) logger.error(res.stdout.trim());
        throw new Error(`Script failed: ${path.basename(scriptPath)}`);
      }
    }
  }
}

async function findFileRecursive(
  root: string,
  fileName: string
): Promise<string | null> {
  const stack: string[] = [root];
  while (stack.length) {
    const dir = stack.pop()!;
    const items = await fs.readdir(dir, { withFileTypes: true });
    for (const it of items) {
      const abs = path.join(dir, it.name);
      if (it.isDirectory()) stack.push(abs);
      else if (it.isFile() && it.name === fileName) return abs;
    }
  }
  return null;
}

async function listAllJsFiles(root: string): Promise<string[]> {
  const results: string[] = [];
  const stack: string[] = [root];
  while (stack.length) {
    const dir = stack.pop()!;
    const items = await fs.readdir(dir, { withFileTypes: true });
    for (const it of items) {
      const abs = path.join(dir, it.name);
      if (it.isDirectory()) stack.push(abs);
      else if (it.isFile() && it.name.endsWith('.js')) results.push(abs);
    }
  }
  return results;
}
