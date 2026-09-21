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
  outputJson?: string;
  /** Atlas county page (`counties/<STATE>/<county>.json`) to create or update. */
  atlasPage?: string;
  /** Required with `atlasPage` when the page does not exist; must match it when it does. */
  county?: string;
  state?: string;
  fips?: string;
  silent?: boolean;
  cwd?: string;
}

export interface ExportTablesServiceOverrides {
  schemaCacheService?: SchemaCacheService;
}

const UNITS: Record<string, number> = { k: 2 ** 10, m: 2 ** 20, g: 2 ** 30 };

/** `1g` -> 1073741824; undefined unless the text is a positive size. Absent means `1g`. */
export function parsePartSize(
  text: string | number = '1g'
): number | undefined {
  const [, digits, unit] =
    String(text)
      .toLowerCase()
      .match(/^(\d+)([kmg]?)$/) ?? [];
  const bytes = Number(digits) * (UNITS[unit] ?? 1);
  return bytes > 0 ? bytes : undefined;
}

export function registerExportTablesCommand(program: Command) {
  program
    .command('export-tables <input>')
    .description(
      'Export a county CAR (from hash --output-car) as Zstd-compressed Parquet tables: one per lexicon class, one per relationship type, and properties from the index, plus a tables.car index whose part links are UnixFS file CIDs.'
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
      '--output-json <path>',
      'Write the export summary (tables root, county root, per-table rows and parts) as JSON.'
    )
    .option(
      '--atlas-page <path>',
      'Create or update the Atlas county page (counties/<STATE>/<county>.json) with the county root, data-group schema and tables root of this export.'
    )
    .option(
      '--county <key>',
      'Atlas county key; required with --atlas-page when the page does not exist, must match it when it does.'
    )
    .option('--state <ST>', 'Two-letter state code for the Atlas page.')
    .option('--fips <code>', 'Five-digit county FIPS code for the Atlas page.')
    .action(async (input, options) => {
      const workingDir = options.cwd || process.cwd();
      await handleExportTables({
        ...options,
        input: path.resolve(workingDir, input),
        output: path.resolve(workingDir, options.output),
        atlasPage: options.atlasPage
          ? path.resolve(workingDir, options.atlasPage)
          : undefined,
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
  const partSize = parsePartSize(options.partSize);
  if (!partSize) {
    return fail(
      `--part-size must be a positive byte count such as 1g, got ${options.partSize}`
    );
  }
  const stats = await fsPromises.stat(options.input).catch(() => undefined);
  if (!stats?.isFile()) {
    return fail(
      `Failed to process input: ${options.input} is not a readable file`
    );
  }
  const result = await exportTables(
    {
      input: options.input,
      output: options.output,
      partSize,
      atlasPage: options.atlasPage,
      county: options.county,
      state: options.state,
      fips: options.fips,
    },
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
    if (result.atlas) {
      console.log(
        chalk.green(
          `Atlas page written: ${result.atlas.page} group ${result.atlas.group}`
        )
      );
    }
  }
  return result;
}
