import { Builder } from '@elephant-xyz/fact-sheet';
import factSheetPkg from '@elephant-xyz/fact-sheet/package.json' with { type: 'json' };
import { promises as fsPromises } from 'fs';
import { logger } from './logger.js';

export function getFactSheetVersion(): string | null {
  return factSheetPkg.version;
}

export async function generateHTMLFiles(
  inputDir: string,
  outputDir: string
): Promise<void> {
  logger.info(`Generating HTML files from ${inputDir} to ${outputDir}...`);

  await fsPromises.mkdir(outputDir, { recursive: true });
  logger.debug(`Created output directory: ${outputDir}`);

  const version = getFactSheetVersion();
  logger.debug(`Using fact-sheet version: ${version}`);

  const options = {
    input: inputDir,
    output: outputDir,
    inlineCss: true,
    inlineJs: true,
    inlineSvg: true,
    minify: true,
    verbose: false,
    quiet: true,
    ci: false,
  };

  logger.debug(`Building with options: ${JSON.stringify(options)}`);

  const builder = new Builder(options);
  await builder.build();

  logger.success('HTML files generated successfully');
}
