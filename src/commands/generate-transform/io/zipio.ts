import { promises as fs } from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';
import { tmpdir } from 'os';
import { logger } from '../../../utils/logger.js';

export async function createTempDir(prefix: string): Promise<string> {
  const base = path.join(tmpdir(), `${prefix}-`);
  const dir = await fs.mkdtemp(base);
  return dir;
}

export function unzipTo(srcZipPath: string, destDir: string): string[] {
  const zip = new AdmZip(srcZipPath);
  const entries = zip.getEntries();
  logger.info(`Extracting ${entries.length} entries from ${srcZipPath}`);
  logger.info(`zip_read: ${srcZipPath} entries: ${entries.length}`);
  zip.extractAllTo(destDir, true);
  return entries.map((e) => e.entryName);
}

export async function zipDirectory(
  srcDir: string,
  destZipPath: string
): Promise<void> {
  const zip = new AdmZip();
  async function addDir(dir: string, rel = ''): Promise<void> {
    const items = await fs.readdir(dir, { withFileTypes: true });
    for (const it of items) {
      const abs = path.join(dir, it.name);
      const relPath = path.join(rel, it.name).replace(/\\/g, '/');
      if (it.isDirectory()) {
        await addDir(abs, relPath);
      } else {
        const data = await fs.readFile(abs);
        zip.addFile(relPath, data);
      }
    }
  }
  await addDir(srcDir);
  zip.writeZip(destZipPath);
  logger.info(JSON.stringify({ event: 'zip_write', file: destZipPath }));
}
