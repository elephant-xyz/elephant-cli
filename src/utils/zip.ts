import AdmZip from 'adm-zip';
import { promises as fs } from 'fs';
import path from 'path';

export async function extractZipToTemp(
  zipPath: string,
  tempRoot: string,
  subdir?: string
): Promise<string> {
  const outDir = subdir ? path.join(tempRoot, subdir) : tempRoot;
  await fs.mkdir(outDir, { recursive: true });
  const zip = new AdmZip(zipPath);
  zip.extractAllTo(outDir, true);
  return outDir;
}
