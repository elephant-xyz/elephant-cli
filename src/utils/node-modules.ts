import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger } from './logger.js';

export interface LinkOptions {
  source?: 'tool' | 'project';
}

function findNearestNodeModules(startDir: string): string | null {
  let dir: string = path.resolve(startDir);
  for (;;) {
    const candidate: string = path.join(dir, 'node_modules');
    try {
      const st: fs.Stats = fs.statSync(candidate);
      if (st.isDirectory()) {
        return fs.realpathSync(candidate);
      }
    } catch {
      logger.warn(`Unable to find node_modules in ${dir}`);
    }
    const parent: string = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function ensureSymlinkDir(targetAbs: string, linkPathAbs: string): void {
  const linkType: fs.symlink.Type =
    process.platform === 'win32' ? 'junction' : 'dir';
  const replaceWithLink = (): void => {
    try {
      fs.rmSync(linkPathAbs, { recursive: true, force: true });
    } catch {
      logger.warn(`Unable to remove ${linkPathAbs}`);
    }
    fs.symlinkSync(targetAbs, linkPathAbs, linkType);
  };
  try {
    let currentTarget: string | null = null;
    try {
      currentTarget = fs.realpathSync(linkPathAbs);
    } catch {
      currentTarget = null;
    }
    if (currentTarget !== targetAbs) {
      replaceWithLink();
    }
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === 'ENOENT') {
      fs.symlinkSync(targetAbs, linkPathAbs, linkType);
    } else {
      throw err;
    }
  }
}

export function linkNodeModulesIntoTemp(
  tempDir: string,
  opts: LinkOptions = { source: 'tool' }
): void {
  const resolvedTemp: string = path.resolve(tempDir);
  fs.mkdirSync(resolvedTemp, { recursive: true });
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const startDir: string =
    opts.source === 'project' ? process.cwd() : moduleDir;
  const nodeModules: string | null = findNearestNodeModules(startDir);
  if (nodeModules === null) {
    throw new Error(
      `Unable to locate a node_modules directory starting from: ${startDir}`
    );
  }
  const linkPath: string = path.join(resolvedTemp, 'node_modules');
  ensureSymlinkDir(nodeModules, linkPath);
}
