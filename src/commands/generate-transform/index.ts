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
      '-e --error <string>',
      'Error message that was produced during the transform process'
    )
    .action(
      async (
        inputZip: string,
        opts: {
          outputZip: string;
          dataDictionary?: string;
          scriptsZip?: string;
          error?: string;
        }
      ) => {
        if (!process.env.OPENAI_API_KEY) {
          console.error(
            chalk.red(
              'OPENAI_API_KEY environment variable is required for generate-transform command'
            )
          );
          console.info(
            chalk.red(
              'Please set your OpenAI API key: export OPENAI_API_KEY=your_key_here'
            )
          );
          process.exitCode = 1;
          return;
        }
        if (
          (opts.scriptsZip || opts.error) &&
          !(opts.scriptsZip && opts.error)
        ) {
          console.error(
            chalk.red(
              'Both --scripts-zip and --error options must be provided together'
            )
          );
          process.exitCode = 1;
          return;
        }

        const cfg = defaultGenerateTransformConfig;
        const spinner = createSpinner('Initializing...');
        try {
          spinner.start('Initializing OpenAI model...');
          const model = new ChatOpenAI({
            model: cfg.modelName,
            streaming: false,
            verbose: false,
            temperature: cfg.temperature,
            maxRetries: 4,
            reasoningEffort: 'medium',
          });
          spinner.succeed('Model initialized.');

          if (opts.scriptsZip && opts.error) {
            const outPath = await repairExtractionScript({
              error: opts.error,
              model,
              outputZip: opts.outputZip,
              scriptsZip: opts.scriptsZip,
              spinner,
            });
            logger.success(`Generated ${outPath}`);
            return;
          }

          spinner.start('Preparing workspace...');
          const nodeLabels = {
            ownerAnalysis: 'Owner analysis',
            structureExtraction: 'Structure extraction',
            extraction: 'Data extraction',
          } as const;
          const humanizeNode = (name: keyof typeof nodeLabels): string =>
            nodeLabels[name];

          const out = await generateTransform(
            inputZip,
            model,
            opts.dataDictionary,
            {
              outputZip: opts.outputZip,
              config: cfg,
              onProgress: (evt) => {
                if (evt.kind === 'message') {
                  spinner.text = evt.message;
                  return;
                }
                if (evt.kind === 'phase') {
                  switch (evt.phase) {
                    case 'initializing':
                      spinner.start('Preparing workspace...');
                      break;
                    case 'unzipping':
                      spinner.start('Unzipping input...');
                      break;
                    case 'discovering':
                      spinner.start('Discovering required files...');
                      break;
                    case 'preparing':
                      spinner.start(evt.message || 'Preparing inputs...');
                      break;
                    case 'running_graph':
                      spinner.start('Running generation pipeline...');
                      break;
                    case 'bundling':
                      spinner.start('Bundling output...');
                      break;
                    case 'completed':
                      spinner.succeed('Generation pipeline completed.');
                      break;
                    default:
                      break;
                  }
                  return;
                }
                if (evt.kind === 'node') {
                  const label = humanizeNode(evt.name);
                  if (evt.stage === 'start') {
                    spinner.start(`Running ${label}...`);
                    return;
                  }
                  spinner.succeed(`${label} completed.`);
                }
              },
            }
          );
          spinner.succeed('Generation complete.');
          logger.success(`Generated ${out}`);
        } catch (e) {
          spinner.fail('generate-transform failed');
          logger.error(`generate-transform failed: ${String(e)}`);
          process.exitCode = 1;
        }
      }
    );
}

type RepairExtractionScriptArgs = {
  error: string;
  model: ChatOpenAI;
  outputZip: string;
  scriptsZip: string;
  spinner: Ora;
};

async function repairExtractionScript(
  args: RepairExtractionScriptArgs
): Promise<string> {
  const { error, model, outputZip, scriptsZip, spinner } = args;

  spinner.start('Loading scripts archive...');
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
  spinner.succeed('Existing script extracted.');

  spinner.start('Parsing error details...');
  console.log(error);
  const errJson = JSON.parse(error) as {
    type?: string;
    message?: string;
    path?: string;
  };
  const parts = String(errJson.path || '').split('.');
  if (parts.length !== 2) {
    throw new Error('Error path must follow <class>.<property> format');
  }
  const cls = parts[0];
  const prop = parts[1];
  spinner.succeed('Error details parsed.');

  spinner.start('Fetching schema manifest...');
  const manifest = await fetchSchemaManifest();
  const meta = manifest[cls];
  if (!meta) {
    throw new Error(`Schema manifest is missing class entry for ${cls}`);
  }
  spinner.succeed('Schema manifest fetched.');

  spinner.start('Fetching schema definition...');
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
  spinner.succeed('Schema details prepared.');

  spinner.start('Requesting GPT fix...');
  const template = await promptRegistry.getPromptTemplate('error-fix');
  const prompt = await template.format({
    script,
    error,
    schema: specText,
  });
  const toText = (value: unknown): string => {
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) {
      const joined = value.map((part) => toText(part)).filter(Boolean);
      return joined.join('\n');
    }
    if (
      value &&
      typeof value === 'object' &&
      'text' in (value as Record<string, unknown>) &&
      typeof (value as { text?: unknown }).text === 'string'
    ) {
      return String((value as { text?: unknown }).text);
    }
    return `${value ?? ''}`;
  };
  const pickScript = (body: string): string => {
    const match = body.match(/```(?:javascript|js)?\s*([\s\S]*?)```/i);
    if (match) return match[1].trim();
    return body.trim();
  };
  const message = await model.invoke(prompt);
  const body = toText((message as { content?: unknown }).content ?? message);
  const fixed = pickScript(body);
  if (!fixed) {
    throw new Error('Model response did not include an updated script');
  }
  spinner.succeed('GPT fix generated.');

  spinner.start('Writing updated scripts archive...');
  entry.setData(Buffer.from(`${fixed}\n`, 'utf8'));
  const outPath = path.resolve(outputZip);
  archive.writeZip(outPath);
  spinner.succeed('Updated archive written.');
  return outPath;
}
