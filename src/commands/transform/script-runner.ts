import { promises as fs } from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';
import { spawn } from 'child_process';
import { logger } from '../../utils/logger.js';
import { linkNodeModulesIntoTemp } from '../../utils/node-modules.js';

export async function extractZipToTemp(
  zipPath: string,
  tempRoot: string,
  subdir: string
): Promise<string> {
  const outDir = path.join(tempRoot, subdir);
  await fs.mkdir(outDir, { recursive: true });
  const zip = new AdmZip(zipPath);
  zip.extractAllTo(outDir, true);
  return outDir;
}

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
  workDir: string
): Promise<void> {
  // Resolve script paths by name; scripts may be placed anywhere in scriptsDir
  const resolveScript = async (name: string): Promise<string> => {
    const found = await findFileRecursive(scriptsDir, name);
    if (!found) throw new Error(`Required script not found: ${name}`);
    return found;
  };
  linkNodeModulesIntoTemp(workDir, { source: 'project' });
  const owner = await resolveScript('ownerMapping.js');
  const structure = await resolveScript('structureMapping.js');
  const layout = await resolveScript('layoutMapping.js');
  const utility = await resolveScript('utilityMapping.js');

  // Run four in parallel
  const timeoutMs = 120000; // 2 minutes default per script
  const parallel = await Promise.all([
    execNode(owner, [], workDir, timeoutMs),
    execNode(structure, [], workDir, timeoutMs),
    execNode(layout, [], workDir, timeoutMs),
    execNode(utility, [], workDir, timeoutMs),
  ]);
  for (const [idx, res] of parallel.entries()) {
    if (res.code !== 0) {
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

  const extraction = await resolveScript('data_extractor.js');
  const finalRes = await execNode(extraction, [], workDir, timeoutMs);
  if (finalRes.code !== 0) {
    if (finalRes.stderr) logger.error(finalRes.stderr.trim());
    throw new Error('dataExtraction.js failed');
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
