import chalk from 'chalk';
import { Command } from 'commander';
import { logger } from '../../utils/logger.js';
import { defaultGenerateTransformConfig } from './config.js';
import { generateTransform } from './runner.js';
import { ChatOpenAI } from '@langchain/openai';
import { createSpinner } from '../../utils/progress.js';
import AdmZip from 'adm-zip';
import path from 'path';
import {
  fetchSchemaManifest,
  fetchFromIpfs,
} from '../../utils/schema-fetcher.js';
import { promptRegistry } from './prompts/langchain-registry.js';
import type { Ora } from 'ora';
import { z } from 'zod';
import { readFileSync } from 'fs';
import { parse as parseCsv } from 'csv-parse/sync';

const ErrorSchemaSingle = z.object({
  type: z.string(),
  message: z.string(),
  path: z.string(),
});
const ErrorSchemaMultiple = z.array(ErrorSchemaSingle);

export type GenerateTransformCommandOptions = {
  inputZip: string;
  outputZip?: string;
  dataDictionary?: string;
  scriptsZip?: string;
  error?: string;
  errorCsv?: string;
  silent?: boolean;
  cwd?: string;
};

export function registerGenerateTransformCommand(program: Command): void {
  program
    .command('generate-transform')
    .description('Generate JavaScript extraction scripts from an input ZIP')
    .argument(
      '<inputZip>',
      'Path to input ZIP containing unnormalized_address.json, property_seed.json, and an HTML/JSON file'
    )
    .option(
      '-o, --output-zip <path>',
      'Output ZIP file',
      'generated-scripts.zip'
    )
    .option('-d, --data-dictionary <path>', 'Path to data dictionary')
    .option('--scripts-zip <path>', 'Path to scripts ZIP file')
    .option(
      '-e, --error <string>',
      'Error message that was produced during the transform process'
    )
    .option(
      '--error-csv <path>',
      'Path to validation errors CSV produced by validate command'
    )
    .action(
      async (
        inputZip: string,
        opts: Omit<GenerateTransformCommandOptions, 'inputZip' | 'silent'>
      ) => {
        await handleGenerateTransform({
          inputZip,
          outputZip: opts.outputZip,
          dataDictionary: opts.dataDictionary,
          scriptsZip: opts.scriptsZip,
          error: opts.error,
          errorCsv: opts.errorCsv,
          silent: false,
        });
      }
    );
}

export async function handleGenerateTransform(
  options: GenerateTransformCommandOptions
): Promise<string> {
  const workingDir = options.cwd || process.cwd();
  const resolvedInputZip = path.resolve(workingDir, options.inputZip);
  const resolvedOutputZip = path.resolve(
    workingDir,
    options.outputZip || 'generated-scripts.zip'
  );
  const resolvedDataDictionary = options.dataDictionary
    ? path.resolve(workingDir, options.dataDictionary)
    : undefined;
  const resolvedScriptsZip = options.scriptsZip
    ? path.resolve(workingDir, options.scriptsZip)
    : undefined;
  const resolvedErrorCsv = options.errorCsv
    ? path.resolve(workingDir, options.errorCsv)
    : undefined;
  const spinner = options.silent ? undefined : createSpinner('Initializing...');
  const missingKeyMessage =
    'OPENAI_API_KEY environment variable is required for generate-transform command';

  if (!process.env.OPENAI_API_KEY) {
    if (options.silent) {
      throw new Error(missingKeyMessage);
    }
    console.error(chalk.red(missingKeyMessage));
    console.info(
      chalk.red(
        'Please set your OpenAI API key: export OPENAI_API_KEY=your_key_here'
      )
    );
    process.exitCode = 1;
    return '';
  }

  const hasScripts = Boolean(resolvedScriptsZip);
  const hasErrorJson = Boolean(options.error);
  const hasErrorCsv = Boolean(resolvedErrorCsv);
  const hasAnyError = hasErrorJson || hasErrorCsv;
  const invalidRepairArgs =
    hasScripts !== hasAnyError || (hasErrorJson && hasErrorCsv);
  if (invalidRepairArgs) {
    const repairMessage =
      'Repair mode requires --scripts-zip and exactly one of --error or --error-csv';
    if (options.silent) {
      throw new Error(repairMessage);
    }
    console.error(chalk.red(repairMessage));
    process.exitCode = 1;
    return '';
  }

  const cfg = defaultGenerateTransformConfig;

  try {
    spinner?.start('Initializing OpenAI model...');
    const model = new ChatOpenAI({
      model: cfg.modelName,
      streaming: false,
      verbose: false,
      temperature: cfg.temperature,
      maxRetries: 4,
    });
    spinner?.succeed('Model initialized.');

    if (resolvedScriptsZip && options.error) {
      const outPath = await repairExtractionScript({
        error: options.error,
        model,
        outputZip: resolvedOutputZip,
        scriptsZip: resolvedScriptsZip,
        spinner,
      });
      logger.success(`Generated ${outPath}`);
      return outPath;
    }

    if (resolvedScriptsZip && resolvedErrorCsv) {
      spinner?.start('Parsing validation errors CSV...');
      const errorJson = await buildErrorsFromCsv(resolvedErrorCsv);
      spinner?.succeed('Validation errors CSV parsed.');
      const outPath = await repairExtractionScript({
        error: errorJson,
        model,
        outputZip: resolvedOutputZip,
        scriptsZip: resolvedScriptsZip,
        spinner,
      });
      logger.success(`Generated ${outPath}`);
      return outPath;
    }

    spinner?.start('Preparing workspace...');
    const nodeLabels = {
      ownerAnalysis: 'Owner analysis',
      structureExtraction: 'Structure extraction',
      extraction: 'Data extraction',
    } as const;
    const humanizeNode = (name: keyof typeof nodeLabels): string =>
      nodeLabels[name];

    const out = await generateTransform(
      resolvedInputZip,
      model,
      resolvedDataDictionary || '',
      {
        outputZip: resolvedOutputZip,
        config: cfg,
        onProgress: (evt) => {
          if (evt.kind === 'message') {
            if (spinner) spinner.text = evt.message;
            return;
          }
          if (evt.kind === 'phase') {
            if (evt.phase === 'initializing')
              spinner?.start('Preparing workspace...');
            if (evt.phase === 'unzipping') spinner?.start('Unzipping input...');
            if (evt.phase === 'discovering')
              spinner?.start('Discovering required files...');
            if (evt.phase === 'preparing')
              spinner?.start(evt.message || 'Preparing inputs...');
            if (evt.phase === 'running_graph')
              spinner?.start('Running generation pipeline...');
            if (evt.phase === 'bundling') spinner?.start('Bundling output...');
            if (evt.phase === 'completed')
              spinner?.succeed('Generation pipeline completed.');
            return;
          }
          if (evt.kind === 'node') {
            const label = humanizeNode(evt.name);
            if (evt.stage === 'start') {
              spinner?.start(`Running ${label}...`);
              return;
            }
            spinner?.succeed(`${label} completed.`);
          }
        },
      }
    );
    spinner?.succeed('Generation complete.');
    logger.success(`Generated ${out}`);
    return out;
  } catch (e) {
    spinner?.fail('generate-transform failed');
    logger.error(`generate-transform failed: ${String(e)}`);
    if (options.silent) {
      throw e instanceof Error ? e : new Error(String(e));
    }
    process.exitCode = 1;
    return '';
  }
}

type RepairExtractionScriptArgs = {
  error: string;
  model: ChatOpenAI;
  outputZip: string;
  scriptsZip: string;
  spinner?: Ora;
};

async function repairExtractionScript(
  args: RepairExtractionScriptArgs
): Promise<string> {
  const { error, model, outputZip, scriptsZip, spinner } = args;

  spinner?.start('Loading scripts archive...');
  const zipPath = path.resolve(scriptsZip);
  const archive = new AdmZip(zipPath);
  const entry = archive
    .getEntries()
    .find((item) => item.entryName.endsWith('data_extractor.js'));
  if (!entry) {
    throw new Error(
      'data_extractor.js was not found in the provided scripts ZIP'
    );
  }
  const script = entry.getData().toString('utf8');
  spinner?.succeed('Existing script extracted.');

  spinner?.start('Parsing error details...');
  const parsed = JSON.parse(error);
  const multi = ErrorSchemaMultiple.safeParse(parsed);
  const isMulti = multi.success;
  const errorPayload = error;
  let specText = '';

  if (isMulti) {
    const uniquePaths = Array.from(
      new Set(
        multi.data
          .map((e) => String(e.path || ''))
          .filter((p) => p.includes('.'))
      )
    );
    if (uniquePaths.length === 0) {
      throw new Error('No valid error paths found');
    }

    spinner?.succeed('Error details parsed.');
    spinner?.start('Fetching schema manifest...');
    const manifest = await fetchSchemaManifest();
    spinner?.succeed('Schema manifest fetched.');

    spinner?.start('Fetching schema definitions...');
    const snippets = await Promise.all(
      uniquePaths.map(async (p) => {
        const parts = p.split('.');
        if (parts.length !== 2) {
          throw new Error('Error path must follow <class>.<property> format');
        }
        const cls = parts[0];
        const prop = parts[1];
        const meta = manifest[cls];
        if (!meta) {
          throw new Error(`Schema manifest is missing class entry for ${cls}`);
        }
        const schemaJson = await fetchFromIpfs(meta.ipfsCid);
        const schema = JSON.parse(schemaJson) as {
          properties?: Record<string, unknown>;
        };
        const props = schema.properties;
        if (!props || typeof props !== 'object') {
          throw new Error(`Schema for ${cls} does not contain properties`);
        }
        const spec = (props as Record<string, unknown>)[prop];
        if (!spec) {
          throw new Error(
            `Schema for ${cls} does not include property ${prop}`
          );
        }
        const body = JSON.stringify(spec, null, 2);
        return `// ${cls}.${prop}\n${body}`;
      })
    );
    specText = snippets.join('\n\n');
    spinner?.succeed('Schema details prepared.');
  } else {
    const single = ErrorSchemaSingle.parse(parsed);
    const parts = String(single.path || '').split('.');
    if (parts.length !== 2) {
      throw new Error('Error path must follow <class>.<property> format');
    }
    const cls = parts[0];
    const prop = parts[1];
    spinner?.succeed('Error details parsed.');

    spinner?.start('Fetching schema manifest...');
    const manifest = await fetchSchemaManifest();
    const meta = manifest[cls];
    if (!meta) {
      throw new Error(`Schema manifest is missing class entry for ${cls}`);
    }
    spinner?.succeed('Schema manifest fetched.');

    spinner?.start('Fetching schema definition...');
    const schemaJson = await fetchFromIpfs(meta.ipfsCid);
    const schema = JSON.parse(schemaJson) as {
      properties?: Record<string, unknown>;
    };
    const props = schema.properties;
    if (!props || typeof props !== 'object') {
      throw new Error(`Schema for ${cls} does not contain properties`);
    }
    const spec = (props as Record<string, unknown>)[prop];
    if (!spec) {
      throw new Error(`Schema for ${cls} does not include property ${prop}`);
    }
    specText = JSON.stringify(spec, null, 2);
    spinner?.succeed('Schema details prepared.');
  }

  spinner?.start('Requesting GPT fix...');
  const template = await promptRegistry.getPromptTemplate('error-fix');
  const prompt = await template.format({
    script,
    error: errorPayload,
    schema: specText,
  });
  const pickScript = (body: string): string => {
    const match = body.match(/```(?:javascript|js)?\s*([\s\S]*?)```/i);
    if (match) return match[1].trim();
    return body.trim();
  };
  const message = await model.invoke(prompt);
  const body = message.text;
  const fixed = pickScript(body);
  if (!fixed) {
    throw new Error('Model response did not include an updated script');
  }
  spinner?.succeed('GPT fix generated.');

  spinner?.start('Writing updated scripts archive...');
  entry.setData(Buffer.from(`${fixed}\n`, 'utf8'));
  const outPath = path.resolve(outputZip);
  archive.writeZip(outPath);
  spinner?.succeed('Updated archive written.');
  return outPath;
}

async function buildErrorsFromCsv(csvPath: string): Promise<string> {
  const content = readFileSync(path.resolve(csvPath), 'utf-8');
  const records: Array<Record<string, string>> = parseCsv(content, {
    columns: true,
    skip_empty_lines: true,
  });
  if (!records.length) {
    throw new Error('CSV file is empty');
  }

  const byKey = new Map<
    string,
    { type: string; message: string; path: string; currentValue: string }
  >();

  for (const r of records) {
    const pathStr = String(r.error_path || '').trim();
    const msg = String(r.error_message || '').trim();
    const dgCid = String(r.data_group_cid || '').trim();
    if (!pathStr || !msg || !dgCid) continue;

    const mapped = await mapCsvErrorPathToClassProperty(dgCid, pathStr);
    if (!mapped) continue;
    const key = `${mapped.className}.${mapped.property}`;
    if (!byKey.has(key)) {
      byKey.set(key, {
        type: 'validation_error',
        message: msg,
        path: key,
        currentValue: r.currentValue || '',
      });
    }
  }

  const arr = Array.from(byKey.values());
  if (!arr.length) {
    throw new Error('No mappable errors found in CSV');
  }
  return JSON.stringify(arr);
}

async function mapCsvErrorPathToClassProperty(
  dataGroupCid: string,
  errorPath: string
): Promise<{ className: string; property: string } | null> {
  const segments = errorPath.split('/').filter(Boolean);
  if (segments.length < 4 || segments[0] !== 'relationships') return null;

  const relName = segments[1];
  const sideIndex = segments.findIndex((s) => s === 'from' || s === 'to');
  if (sideIndex < 0) return null;
  const side = segments[sideIndex];
  const prop = segments[sideIndex + 1];
  if (!prop) return null;

  const dataGroupSchemaJson = await fetchFromIpfs(dataGroupCid);
  const dataGroupSchema = JSON.parse(dataGroupSchemaJson) as {
    properties?: { relationships?: { properties?: Record<string, unknown> } };
  };
  const relProps = dataGroupSchema.properties?.relationships?.properties;
  if (!relProps || typeof relProps !== 'object') return null;
  const relEntry = relProps[relName] as
    | { cid: string }
    | { items: { cid: string } }
    | undefined;
  if (!relEntry) return null;
  const relSchemaCid = 'items' in relEntry ? relEntry.items.cid : relEntry.cid;

  const relSchemaJson = await fetchFromIpfs(relSchemaCid);
  const relSchema = JSON.parse(relSchemaJson) as {
    properties?: { from?: { cid: string }; to?: { cid: string } };
  };
  const sideObj = relSchema.properties?.[side as 'from' | 'to'];
  if (!sideObj || typeof sideObj.cid !== 'string') return null;

  const classSchemaJson = await fetchFromIpfs(sideObj.cid);
  const classSchema = JSON.parse(classSchemaJson) as { title?: string };
  const className = classSchema.title;
  if (!className) return null;

  return { className, property: prop };
}
