import { Command } from 'commander';
import { logger } from '../../utils/logger.js';
import { defaultGenerateTransformConfig } from './config.js';
import { generateTransform } from './runner.js';
import { ChatOpenAI } from '@langchain/openai';
import { createSpinner } from '../../utils/progress.js';

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
    .action(async (inputZip: string, opts: { outputZip: string }) => {
      if (!process.env.OPENAI_API_KEY) {
        console.error(
          'OPENAI_API_KEY environment variable is required for generate-transform command'
        );
        console.info(
          'Please set your OpenAI API key: export OPENAI_API_KEY=your_key_here'
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
        });
        spinner.succeed('Model initialized.');

        spinner.start('Preparing workspace...');
        const humanizeNode = (
          name: 'ownerAnalysis' | 'structureExtraction' | 'extraction'
        ): string => {
          if (name === 'ownerAnalysis') return 'Owner analysis';
          if (name === 'structureExtraction') return 'Structure extraction';
          return 'Data extraction';
        };

        const out = await generateTransform(inputZip, model, {
          outputZip: opts.outputZip,
          config: cfg,
          onProgress: (evt) => {
            if (evt.kind === 'message') {
              spinner.text = evt.message;
              return;
            }
            if (evt.kind === 'phase') {
              if (evt.phase === 'initializing') {
                spinner.start('Preparing workspace...');
                return;
              }
              if (evt.phase === 'unzipping') {
                spinner.start('Unzipping input...');
                return;
              }
              if (evt.phase === 'discovering') {
                spinner.start('Discovering required files...');
                return;
              }
              if (evt.phase === 'preparing') {
                spinner.start(evt.message || 'Preparing inputs...');
                return;
              }
              if (evt.phase === 'running_graph') {
                spinner.start('Running generation pipeline...');
                return;
              }
              if (evt.phase === 'bundling') {
                spinner.start('Bundling output...');
                return;
              }
              if (evt.phase === 'completed') {
                spinner.succeed('Generation pipeline completed.');
                return;
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
        });
        spinner.succeed('Generation complete.');
        logger.success(`Generated ${out}`);
      } catch (e) {
        spinner.fail('generate-transform failed');
        logger.error(`generate-transform failed: ${String(e)}`);
        process.exitCode = 1;
      }
    });
}
