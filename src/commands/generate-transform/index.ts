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

const ErrorSchema = z.object({
  type: z.string(),
  message: z.string(),
  path: z.string(),
});

export type GenerateTransformCommandOptions = {
  inputZip: string;
  outputZip?: string;
  dataDictionary?: string;
  scriptsZip?: string;
  error?: string;
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

  const repairArgsIncomplete =
    Boolean(resolvedScriptsZip || options.error) &&
    !(resolvedScriptsZip && options.error);
  if (repairArgsIncomplete) {
    const repairMessage =
      'Both --scripts-zip and --error options must be provided together';
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
  const errJson = ErrorSchema.parse(JSON.parse(error));
  const parts = String(errJson.path || '').split('.');
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
  const spec = props[prop];
  if (!spec) {
    throw new Error(`Schema for ${cls} does not include property ${prop}`);
  }
  const specText = JSON.stringify(spec, null, 2);
  spinner?.succeed('Schema details prepared.');

  spinner?.start('Requesting GPT fix...');
  const template = await promptRegistry.getPromptTemplate('error-fix');
  const prompt = await template.format({
    script,
    error,
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
