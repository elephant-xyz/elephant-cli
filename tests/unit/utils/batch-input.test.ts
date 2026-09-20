import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { promises as fsPromises } from 'fs';
import os from 'os';
import path from 'path';
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
    await fsPromises.mkdir(path.join(dir, '.git'));
    await fsPromises.mkdir(path.join(dir, '__MACOSX'));
    await fsPromises.writeFile(path.join(dir, '.stale.zip'), 'zip');
    return dir;
  }

  beforeEach(() => {
    vi.spyOn(process, 'exit').mockImplementation((() => {}) as never);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(
      dirs
        .splice(0)
        .map((dir) => fsPromises.rm(dir, { recursive: true, force: true }))
    );
  });

  it('is a batch only for a directory with zip or subdirectory children', async () => {
    const dir = await fixture();
    expect(await isBatchInput(dir)).toBe(true);
    expect(await isBatchInput(path.join(dir, 'a.zip'))).toBe(false);
    expect(await isBatchInput(path.join(dir, 'missing.zip'))).toBe(false);
    expect(await isBatchInput(path.join(dir, 'c'))).toBe(false);
    expect(await isBatchInput(path.join(dir, '__MACOSX'))).toBe(false);
  });

  it('runs the handler per child in sorted order with shared services and one csv', async () => {
    const dir = await fixture();
    const out = path.join(dir, 'out', 'combined.csv');
    const handler = vi.fn(
      async (options: { input: string; outputCsv?: string; cwd?: string }) => {
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
    expect(calls.map((call) => call.input)).toEqual([
      path.join(dir, 'a.zip'),
      path.join(dir, 'b.zip'),
      path.join(dir, 'c'),
    ]);
    expect(calls[2]).toMatchObject({ outputZip: 'c.out', silent: true });
    expect(calls[2].cwd).not.toContain(dir);
    for (const call of handler.mock.calls) {
      expect(call[1]).toBe(shared);
    }
    expect(await fsPromises.readFile(out, 'utf-8')).toBe(
      'h1,h2\na.zip,1\nb.zip,1\nc,1\n'
    );
  });

  it('skips hidden and tooling children', async () => {
    const dir = await fixture();
    const handler = vi.fn(async () => {});
    await runBatchInput({ input: dir, silent: true }, handler, shared);
    const names = handler.mock.calls.map((call) =>
      path.basename(call[0].input)
    );
    expect(names).toEqual(['a.zip', 'b.zip', 'c']);
  });

  it('combines per-property submit_errors and submit_warnings beside the output csv', async () => {
    const dir = await fixture();
    const out = path.join(dir, 'out', 'combined.csv');
    const handler = vi.fn(async (options: { input: string; cwd?: string }) => {
      const stem = path.basename(options.input, '.zip');
      await fsPromises.writeFile(
        path.join(options.cwd as string, 'submit_errors.csv'),
        `e1,e2\n${stem},err\n`
      );
      await fsPromises.writeFile(
        path.join(options.cwd as string, 'submit_warnings.csv'),
        'w1,w2\n'
      );
    });

    await runBatchInput(
      { input: dir, outputCsv: out, silent: true },
      handler,
      shared
    );

    expect(
      await fsPromises.readFile(
        path.join(dir, 'out', 'submit_errors.csv'),
        'utf-8'
      )
    ).toBe('e1,e2\na,err\nb,err\nc,err\n');
    expect(
      await fsPromises.readFile(
        path.join(dir, 'out', 'submit_warnings.csv'),
        'utf-8'
      )
    ).toBe('w1,w2\n');
  });

  it('aborts on duplicate stems before running anything', async () => {
    const dir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'batch-'));
    dirs.push(dir);
    await fsPromises.writeFile(path.join(dir, '12345.zip'), 'zip');
    await fsPromises.mkdir(path.join(dir, '12345'));
    await fsPromises.writeFile(path.join(dir, 'abc.zip'), 'zip');
    await fsPromises.writeFile(path.join(dir, 'ABC.zip'), 'zip');
    const handler = vi.fn(async () => {});

    await expect(
      runBatchInput({ input: dir, silent: true }, handler, shared)
    ).rejects.toThrow('Duplicate property names');
    expect(handler).not.toHaveBeenCalled();
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
    ).rejects.toThrow('1 of 3 properties failed: b');
    expect(handler).toHaveBeenCalledTimes(3);

    await runBatchInput({ input: dir }, handler, shared);
    expect(process.exit).toHaveBeenCalledWith(1);
  });
});
