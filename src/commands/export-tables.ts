import { Command } from 'commander';
import { promises as fsPromises } from 'fs';
import path from 'path';
import chalk from 'chalk';
import { logger } from '../utils/logger.js';
import { SchemaCacheService } from '../services/schema-cache.service.js';
import {
  exportTables,
  ExportTablesResult,
} from '../services/tables-export.service.js';

export interface ExportTablesCommandOptions {
  input: string;
  output: string;
  /** Bytes, or a number with a `k`, `m` or `g` suffix; default `1g`. */
  partSize?: string | number;
  /** `zstd` (default) or `snappy`. */
  codec?: string;
  outputJson?: string;
  silent?: boolean;
  cwd?: string;
}

export interface ExportTablesServiceOverrides {
  schemaCacheService?: SchemaCacheService;
}

const UNITS: Record<string, number> = {
  '': 1,
  k: 1 << 10,
  m: 1 << 20,
  g: 1 << 30,
};

/** `1g` -> 1073741824; undefined when the text is not a positive size. */
export function parsePartSize(text: string | number): number | undefined {
  const match = String(text)
    .trim()
    .toLowerCase()
    .match(/^(\d+)([kmg]?)$/);
  const bytes = match ? Number(match[1]) * UNITS[match[2]] : 0;
  return bytes > 0 ? bytes : undefined;
}

export function registerExportTablesCommand(program: Command) {
  program
    .command('export-tables <input>')
    .description(
      'Export a county CAR (from hash --output-car) as Parquet tables: one per lexicon class, one per relationship type, and properties from the index, plus a tables.car index whose part links are UnixFS file CIDs.'
    )
    .requiredOption(
      '--output <dir>',
      'Directory that receives <table>/part-NNNNN.parquet files and tables.car.'
    )
    .option(
      '--part-size <bytes>',
      'Cap on the bytes of one Parquet part; accepts k, m and g suffixes.',
      '1g'
    )
    .option(
      '--codec <zstd|snappy>',
      'Page compression of every Parquet column; zstd is level 3 through node:zlib.',
      'zstd'
    )
    .option(
      '--output-json <path>',
      'Write the export summary (tables root, county root, per-table rows and parts) as JSON.'
    )
    .action(async (input, options) => {
      const workingDir = options.cwd || process.cwd();
      await handleExportTables({
        ...options,
        input: path.resolve(workingDir, input),
        output: path.resolve(workingDir, options.output),
        cwd: workingDir,
      });
    });
}

export async function handleExportTables(
  options: ExportTablesCommandOptions,
  serviceOverrides: ExportTablesServiceOverrides = {}
): Promise<ExportTablesResult> {
  if (!options.silent) {
    console.log(chalk.bold.blue('🐘 Elephant Network CLI - Export Tables'));
    console.log();
  }
  const fail = (message: string): never => {
    logger.error(message);
    if (options.silent) {
      throw new Error(message);
    }
    console.error(chalk.red(`❌ ${message}`));
    process.exit(1);
  };
  const partSize = parsePartSize(options.partSize ?? '1g');
  if (!partSize) {
    return fail(
      `--part-size must be a positive byte count such as 1g, got ${options.partSize}`
    );
  }
  const codec = (options.codec ?? 'zstd').toLowerCase();
  if (codec !== 'zstd' && codec !== 'snappy') {
    return fail(`--codec must be zstd or snappy, got ${options.codec}`);
  }
  const stats = await fsPromises.stat(options.input).catch(() => undefined);
  if (!stats?.isFile()) {
    return fail(
      `Failed to process input: ${options.input} is not a readable file`
    );
  }
  const result = await exportTables(
    { input: options.input, output: options.output, partSize, codec },
    {
      schemaCacheService:
        serviceOverrides.schemaCacheService ?? new SchemaCacheService(),
    }
  ).catch((error: unknown) =>
    fail(
      `Failed to export tables: ${error instanceof Error ? error.message : String(error)}`
    )
  );
  if (options.outputJson) {
    await fsPromises.writeFile(
      path.resolve(options.cwd || process.cwd(), options.outputJson),
      JSON.stringify(result, null, 2)
    );
  }
  if (!options.silent) {
    console.log(
      chalk.green(
        `Tables written: ${result.output} (${Object.keys(result.tables).length} tables, ${result.parts} parts, root ${result.root})`
      )
    );
  }
  return result;
}
