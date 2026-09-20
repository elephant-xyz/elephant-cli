import { promises as fsPromises } from 'fs';
import os from 'os';
import path from 'path';
import AdmZip from 'adm-zip';
import chalk from 'chalk';
import { logger } from './logger.js';

interface BatchOptions {
  input: string;
  outputCsv?: string;
  silent?: boolean;
}

/** True when the input is a directory of properties rather than a single ZIP. */
export async function isBatchInput(input: string): Promise<boolean> {
  return fsPromises.stat(input).then(
    (stats) => stats.isDirectory(),
    () => false
  );
}

async function appendCsv(target: string, part: string): Promise<void> {
  const text = await fsPromises.readFile(part, 'utf-8').catch(() => '');
  const lines = text.split('\n').filter((line) => line.trim() !== '');
  const size = await fsPromises.stat(target).then((stats) => stats.size);
  const rows = size === 0 ? lines : lines.slice(1);
  if (rows.length === 0) {
    return;
  }
  await fsPromises.appendFile(target, rows.join('\n') + '\n');
}

/**
 * Run a single-property handler once per immediate child of `options.input`
 * (every `.zip` file or subdirectory, sorted by name). Subdirectories are
 * zipped to a temp file first. Each property gets its own temp CSV, which is
 * appended to `options.outputCsv`. Failures are counted, not fatal, until the
 * summary; then exit 1 (or throw when `options.silent`).
 */
export async function runBatchInput<O extends BatchOptions, S>(
  options: O,
  handler: (options: O, overrides: S) => Promise<void>,
  shared: S,
  extra: (stem: string) => Partial<O> = () => ({})
): Promise<void> {
  const entries = await fsPromises.readdir(options.input, {
    withFileTypes: true,
  });
  const children = entries
    .filter(
      (entry) =>
        entry.isDirectory() ||
        (entry.isFile() && entry.name.toLowerCase().endsWith('.zip'))
    )
    .sort((a, b) => a.name.localeCompare(b.name));
  const tmp = await fsPromises.mkdtemp(
    path.join(os.tmpdir(), 'elephant-batch-')
  );
  if (options.outputCsv) {
    await fsPromises.mkdir(path.dirname(options.outputCsv), {
      recursive: true,
    });
    await fsPromises.writeFile(options.outputCsv, '');
  }
  const failed: string[] = [];
  // ponytail: sequential per property; add a concurrency flag if a county run is measured too slow
  for (const entry of children) {
    const source = path.join(options.input, entry.name);
    const stem = entry.isDirectory()
      ? entry.name
      : entry.name.slice(0, -'.zip'.length);
    const zip = entry.isDirectory() ? path.join(tmp, `${stem}.zip`) : source;
    if (entry.isDirectory()) {
      const archive = new AdmZip();
      archive.addLocalFolder(source);
      archive.writeZip(zip);
    }
    const part = path.join(tmp, `${stem}.csv`);
    if (!options.silent) {
      console.log(chalk.blue(`▶ ${stem}`));
    }
    logger.info(`Batch property ${stem}: ${source}`);
    await handler(
      {
        ...options,
        ...extra(stem),
        input: zip,
        outputCsv: part,
        silent: true,
      },
      shared
    ).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      failed.push(stem);
      logger.error(`Batch property ${stem} failed: ${message}`);
      if (!options.silent) {
        console.log(chalk.red(`  ✗ ${stem}: ${message}`));
      }
    });
    if (options.outputCsv) {
      await appendCsv(options.outputCsv, part);
    }
  }
  await fsPromises.rm(tmp, { recursive: true, force: true });
  const summary = `Properties processed: ${children.length}, succeeded: ${children.length - failed.length}, failed: ${failed.length}`;
  if (!options.silent) {
    console.log(
      failed.length > 0 ? chalk.yellow(summary) : chalk.green(summary)
    );
  }
  logger.info(summary);
  if (failed.length === 0) {
    return;
  }
  if (options.silent) {
    throw new Error(`${summary} (${failed.join(', ')})`);
  }
  process.exit(1);
}
