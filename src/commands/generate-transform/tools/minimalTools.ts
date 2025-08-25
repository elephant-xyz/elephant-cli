import path from 'path';
import fs from 'fs';
import {
  acornParse,
  prettierFormat,
  readTextFile,
  writeTextFile,
  execNodeScript,
  sha256,
} from '../io/fsutil.js';
import { logger } from '../../../utils/logger.js';
import { linkNodeModulesIntoTemp } from '../../../utils/node-modules.js';

export class MinimalTools {
  constructor(private readonly tempDir: string) {
    this.tempDir = tempDir;
    linkNodeModulesIntoTemp(this.tempDir, { source: 'tool' });
  }

  async readFile(relPath: string): Promise<string> {
    const content = await readTextFile(this.tempDir, relPath);
    return content;
  }

  async writeFile(
    relPath: string,
    content: string
  ): Promise<{ bytesWritten: number; absPath: string; hash: string }> {
    const formatted = await prettierFormat(content);
    await acornParse(formatted);
    const res = await writeTextFile(this.tempDir, relPath, formatted);
    const fileHash = sha256(formatted);
    logger.info(`syntax_check: ${relPath} ok: true hash: ${fileHash}`);
    return { ...res, hash: fileHash };
  }

  async executeJs(
    entryRelPath: string,
    args: string[] = [],
    timeoutMs = 30000
  ): Promise<{ code: number; stdout: string; stderr: string }> {
    const abs = path.join(this.tempDir, entryRelPath);
    const res = await execNodeScript(abs, args, timeoutMs, this.tempDir);
    return res;
  }

  async listDirectory(relPath: string): Promise<string[]> {
    const abs = path.join(this.tempDir, relPath);
    const files = await fs.promises.readdir(abs);
    return files;
  }
}
