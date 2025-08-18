import { Command } from 'commander';
import { logger } from '../../utils/logger.js';
import { defaultGenerateTransformConfig } from './config.js';
import { generateTransform } from './runner.js';
import { ChatOpenAI } from '@langchain/openai';

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
      try {
        const model = new ChatOpenAI({
          model: cfg.modelName,
          streaming: false,
          verbose: false,
          temperature: cfg.temperature,
          maxRetries: 4,
        });
        const out = await generateTransform(inputZip, model, {
          outputZip: opts.outputZip,
          config: cfg,
        });
        logger.success(`Generated ${out}`);
      } catch (e) {
        logger.error(`generate-transform failed: ${String(e)}`);
        process.exitCode = 1;
      }
    });
}
