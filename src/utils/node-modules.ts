import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { logger } from './logger.js';

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

function findCheerioNodeModules(): string {
  const modulePath = fileURLToPath(import.meta.resolve('cheerio'));
  const match = modulePath.match(/(.*node_modules)/);
  if (!match) {
    throw new Error('Failed to find node_modules directory');
  }
  return match[1];
}

export function linkNodeModulesIntoTemp(tempDir: string): void {
  const nodeModules: string = findCheerioNodeModules();
  const linkPath: string = path.join(tempDir, 'node_modules');
  ensureSymlinkDir(nodeModules, linkPath);
}
