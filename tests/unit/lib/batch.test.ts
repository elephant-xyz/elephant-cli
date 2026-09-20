import { describe, it, expect, vi, afterEach } from 'vitest';
import { promises as fsPromises } from 'fs';
import os from 'os';
import path from 'path';
import { validate, hash } from '../../../src/lib/commands.js';
import { runBatchInput } from '../../../src/utils/batch-input.js';

vi.mock('../../../src/utils/batch-input.js', () => ({
  isBatchInput: vi.fn(async () => true),
  runBatchInput: vi.fn(async () => {}),
  sharedServices: vi.fn((overrides: unknown) => overrides),
}));

describe('library batch input', () => {
  const dirs: string[] = [];

  async function fixture(): Promise<string> {
    const dir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'lib-batch-'));
    dirs.push(dir);
    return dir;
  }

  afterEach(async () => {
    vi.clearAllMocks();
    await Promise.all(
      dirs
        .splice(0)
        .map((dir) => fsPromises.rm(dir, { recursive: true, force: true }))
    );
  });

  it('validate() routes a directory through the batch runner', async () => {
    const dir = await fixture();
    const result = await validate({ input: dir, outputCsv: 'errors.csv' });
    expect(result.success).toBe(true);
    expect(vi.mocked(runBatchInput).mock.calls[0][0]).toMatchObject({
      input: dir,
      silent: true,
    });
  });

  it('hash() routes a directory through the batch runner and creates the output directory', async () => {
    const dir = await fixture();
    const out = path.join(dir, 'hashed');
    const result = await hash({ input: dir, outputZip: out });
    expect(result.success).toBe(true);
    expect((await fsPromises.stat(out)).isDirectory()).toBe(true);
    expect(vi.mocked(runBatchInput).mock.calls[0][0]).toMatchObject({
      input: dir,
      outputZip: out,
    });
  });

  it('hash() rejects an --output-zip that is an existing file', async () => {
    const dir = await fixture();
    const out = path.join(dir, 'hashed-data.zip');
    await fsPromises.writeFile(out, 'zip');
    const result = await hash({ input: dir, outputZip: out });
    expect(result.success).toBe(false);
    expect(result.error).toContain('is a file');
    expect(runBatchInput).not.toHaveBeenCalled();
  });
});
