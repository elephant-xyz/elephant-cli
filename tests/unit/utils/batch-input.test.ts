import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { promises as fsPromises } from 'fs';
import os from 'os';
import path from 'path';
import AdmZip from 'adm-zip';
import { isBatchInput, runBatchInput } from '../../../src/utils/batch-input.js';

describe('batch input', () => {
  const dirs: string[] = [];
  const shared = { schemaCacheService: {}, schemaManifestService: {} };

  async function fixture(): Promise<string> {
    const dir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'batch-'));
    dirs.push(dir);
    await fsPromises.writeFile(path.join(dir, 'b.zip'), 'zip');
    await fsPromises.writeFile(path.join(dir, 'a.zip'), 'zip');
    await fsPromises.writeFile(path.join(dir, 'ignored.txt'), 'x');
    await fsPromises.mkdir(path.join(dir, 'c'));
    await fsPromises.writeFile(path.join(dir, 'c', 'seed.json'), '{}');
    return dir;
  }

  beforeEach(() => {
    vi.spyOn(process, 'exit').mockImplementation((() => {}) as never);
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(
      dirs
        .splice(0)
        .map((dir) => fsPromises.rm(dir, { recursive: true, force: true }))
    );
  });

  it('distinguishes a directory from a zip or missing path', async () => {
    const dir = await fixture();
    expect(await isBatchInput(dir)).toBe(true);
    expect(await isBatchInput(path.join(dir, 'a.zip'))).toBe(false);
    expect(await isBatchInput(path.join(dir, 'missing.zip'))).toBe(false);
  });

  it('runs the handler per child in sorted order with shared services and one csv', async () => {
    const dir = await fixture();
    const out = path.join(dir, 'out', 'combined.csv');
    const handler = vi.fn(
      async (options: { input: string; outputCsv?: string }) => {
        if (options.input.endsWith('c.zip')) {
          const names = new AdmZip(options.input)
            .getEntries()
            .map((entry) => entry.entryName);
          expect(names).toEqual(['seed.json']);
        }
        await fsPromises.writeFile(
          options.outputCsv as string,
          `h1,h2\n${path.basename(options.input)},1\n`
        );
      }
    );

    await runBatchInput(
      { input: dir, outputCsv: out, silent: true },
      handler,
      shared,
      (stem) => ({ outputZip: `${stem}.out` })
    );

    expect(handler).toHaveBeenCalledTimes(3);
    const calls = handler.mock.calls.map((call) => call[0]);
    expect(calls.map((call) => path.basename(call.input))).toEqual([
      'a.zip',
      'b.zip',
      'c.zip',
    ]);
    expect(calls[0].input).toBe(path.join(dir, 'a.zip'));
    expect(calls[2].input).not.toContain(dir);
    expect(calls[2]).toMatchObject({ outputZip: 'c.out', silent: true });
    for (const call of handler.mock.calls) {
      expect(call[1]).toBe(shared);
    }
    expect(await fsPromises.readFile(out, 'utf-8')).toBe(
      'h1,h2\na.zip,1\nb.zip,1\nc.zip,1\n'
    );
  });

  it('continues past a failing child and reports the failure', async () => {
    const dir = await fixture();
    const handler = vi.fn(async (options: { input: string }) => {
      if (options.input.endsWith('b.zip')) {
        throw new Error('boom');
      }
    });

    await expect(
      runBatchInput({ input: dir, silent: true }, handler, shared)
    ).rejects.toThrow('failed: 1 (b)');
    expect(handler).toHaveBeenCalledTimes(3);

    await runBatchInput({ input: dir }, handler, shared);
    expect(process.exit).toHaveBeenCalledWith(1);
  });
});
