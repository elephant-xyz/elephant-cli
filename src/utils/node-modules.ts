import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { logger } from './logger.js';

export interface LinkOptions {
  source?: 'tool' | 'project';
}

function findNearestNodeModules(startDir: string): string | null {
  let dir: string = path.resolve(startDir);
  for (;;) {
    // If we are already inside a node_modules directory, return it
    if (path.basename(dir) === 'node_modules') {
      try {
        return fs.realpathSync(dir);
      } catch {
        // fall through to try parent
      }
    }
    const candidate: string = path.join(dir, 'node_modules');
    try {
      const st: fs.Stats = fs.statSync(candidate);
      if (st.isDirectory()) {
        return fs.realpathSync(candidate);
      }
    } catch {
      // Not found at this level, continue ascending
    }
    const parent: string = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function resolveNodeModulesViaRequire(
  moduleNameHints: string[] = ['cheerio']
): string | null {
  const req = createRequire(import.meta.url);
  for (const name of moduleNameHints) {
    try {
      const resolved = req.resolve(`${name}/package.json`);
      let dir = path.dirname(resolved);
      for (;;) {
        if (path.basename(dir) === 'node_modules') {
          try {
            return fs.realpathSync(dir);
          } catch {
            break;
          }
        }
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
      }
    } catch {
      // try next hint
    }
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

  // 1) Try the preferred source
  let nodeModules: string | null = findNearestNodeModules(startDir);

  // 2) Fallback to the tool's install location (useful when running via npx)
  if (!nodeModules && startDir !== moduleDir) {
    nodeModules = findNearestNodeModules(moduleDir);
  }

  // 3) Last resort: resolve any known dependency and derive its node_modules
  if (!nodeModules) {
    nodeModules = resolveNodeModulesViaRequire();
  }

  if (!nodeModules) {
    const tried = [startDir, moduleDir].filter((v, i, a) => a.indexOf(v) === i);
    throw new Error(
      `Unable to locate a node_modules directory. Tried: ${tried.join(', ')}`
    );
  }
  const linkPath: string = path.join(resolvedTemp, 'node_modules');
  ensureSymlinkDir(nodeModules, linkPath);
}
