import { Dirent, promises as fsPromises } from 'fs';
import os from 'os';
import path from 'path';
import chalk from 'chalk';
import { logger } from './logger.js';
import { SchemaCacheService } from '../services/schema-cache.service.js';
import { SchemaManifestService } from '../services/schema-manifest.service.js';

interface BatchOptions {
  input: string;
  outputCsv?: string;
  silent?: boolean;
  cwd?: string;
}

interface SharedServices {
  schemaCacheService?: SchemaCacheService;
  schemaManifestService?: SchemaManifestService;
}

/** Per-run reports every handler writes relative to `cwd`; combined next to `outputCsv`. */
const REPORTS = ['submit_errors.csv', 'submit_warnings.csv'];

function isHidden(name: string): boolean {
  return name.startsWith('.') || name.startsWith('__');
}

async function listChildren(dir: string): Promise<Dirent[]> {
  const entries = await fsPromises
    .readdir(dir, { withFileTypes: true })
    .catch(() => [] as Dirent[]);
  return entries
    .filter((entry) => {
      if (isHidden(entry.name)) {
        logger.info(`Skipping hidden child ${entry.name}`);
        return false;
      }
      return (
        entry.isDirectory() ||
        (entry.isFile() && entry.name.toLowerCase().endsWith('.zip'))
      );
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** True when the input is a directory holding at least one property (`.zip` file or subdirectory). */
export async function isBatchInput(input: string): Promise<boolean> {
  return (await listChildren(input)).length > 0;
}

/** Fill the services every property in a batch must share, unless the caller already supplied them. */
export function sharedServices<S extends SharedServices>(overrides: S): S {
  return {
    ...overrides,
    schemaCacheService:
      overrides.schemaCacheService ?? new SchemaCacheService(),
    schemaManifestService:
      overrides.schemaManifestService ?? new SchemaManifestService(),
  };
}

export function bail(options: BatchOptions, message: string): never {
  console.error(chalk.red(`❌ ${message}`));
  if (options.silent) {
    throw new Error(message);
  }
  process.exit(1);
}

async function appendCsv(target: string, part: string): Promise<void> {
  const text = await fsPromises.readFile(part, 'utf-8').catch(() => '');
  const lines = text.split('\n').filter((line) => line.trim() !== '');
  const size = await fsPromises.stat(target).then(
    (stats) => stats.size,
    () => 0
  );
  const rows = size === 0 ? lines : lines.slice(1);
  if (rows.length === 0) {
    return;
  }
  await fsPromises.appendFile(target, rows.join('\n') + '\n');
}

/**
 * Run a single-property handler once per child of `options.input` (every
 * `.zip` file or subdirectory, sorted by name; names starting with `.` or
 * `__` are skipped). Each property runs with its own `cwd` and `outputCsv`
 * under a temp directory; those are appended to `options.outputCsv` and to
 * `submit_errors.csv` / `submit_warnings.csv` beside it. Failures are
 * counted, not fatal, until the summary; then exit 1 (or throw when
 * `options.silent`). `finish` runs once after the last property, before
 * the summary, so batch-wide outputs are completed even when some failed.
 */
export async function runBatchInput<O extends BatchOptions, S>(
  options: O,
  handler: (options: O, overrides: S) => Promise<void>,
  shared: S,
  extra: (stem: string) => Partial<O> = () => ({}),
  finish: () => Promise<void> = async () => {}
): Promise<void> {
  const children = await listChildren(options.input);
  const stems = children.map((entry) =>
    entry.isDirectory() ? entry.name : entry.name.slice(0, -'.zip'.length)
  );
  const lower = stems.map((s) => s.toLowerCase());
  const dupes = stems.filter((s, i) => lower.indexOf(s.toLowerCase()) !== i);
  if (dupes.length > 0) {
    bail(
      options,
      `Duplicate property names in ${options.input}: ${dupes.join(', ')}`
    );
  }
  const combined = options.outputCsv;
  const reports = combined
    ? REPORTS.map((name) => path.join(path.dirname(combined), name))
    : [];
  for (const report of reports) {
    await fsPromises.rm(report, { force: true });
  }
  if (combined) {
    await fsPromises.mkdir(path.dirname(combined), { recursive: true });
    await fsPromises.writeFile(combined, '');
  }
  const tmp = await fsPromises.mkdtemp(
    path.join(os.tmpdir(), 'elephant-batch-')
  );
  const failed: string[] = [];
  // ponytail: sequential per property; add a concurrency flag if a county run is measured too slow
  for (const [index, entry] of children.entries()) {
    const stem = stems[index];
    const cwd = path.join(tmp, stem);
    const part = path.join(cwd, 'output.csv');
    logger.info(`Batch property ${stem}: ${entry.name}`);
    await fsPromises
      .mkdir(cwd, { recursive: true })
      .then(() =>
        handler(
          {
            ...options,
            ...extra(stem),
            input: path.join(options.input, entry.name),
            outputCsv: part,
            cwd,
            silent: true,
          },
          shared
        )
      )
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        failed.push(stem);
        logger.error(`Batch property ${stem} failed: ${message}`);
      });
    if (combined) {
      await appendCsv(combined, part);
    }
    for (const report of reports) {
      await appendCsv(report, path.join(cwd, path.basename(report)));
    }
  }
  await fsPromises.rm(tmp, { recursive: true, force: true });
  await finish();
  const summary = `Properties processed: ${children.length}, succeeded: ${children.length - failed.length}, failed: ${failed.length}`;
  if (!options.silent) {
    console.log(
      failed.length > 0 ? chalk.yellow(summary) : chalk.green(summary)
    );
  }
  logger.info(summary);
  if (failed.length > 0) {
    bail(
      options,
      `${failed.length} of ${children.length} properties failed: ${failed.join(', ')}`
    );
  }
}
