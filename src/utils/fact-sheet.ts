import { execSync } from 'child_process';
import { promises as fsPromises } from 'fs';
import { logger } from './logger.js';

export function getFactSheetVersion(): string | null {
  try {
    const version = execSync('npx fact-sheet --version', {
      encoding: 'utf8',
    }).trim();
    logger.debug(`fact-sheet version: ${version}`);
    return version;
  } catch (error) {
    logger.debug(`Could not get fact-sheet version: ${error}`);
    return null;
  }
}

export async function generateHTMLFiles(
  inputDir: string,
  outputDir: string
): Promise<void> {
  try {
    logger.info(`Generating HTML files from ${inputDir} to ${outputDir}...`);

    await fsPromises.mkdir(outputDir, { recursive: true });
    logger.debug(`Created output directory: ${outputDir}`);

    const factSheetCmd = 'npx fact-sheet';

    try {
      const version = getFactSheetVersion();
      logger.debug(`Using fact-sheet version: ${version}`);
    } catch (versionError) {
      logger.warn('Could not determine fact-sheet version');
    }

    const command = `${factSheetCmd} generate --input ${inputDir} --output ${outputDir} --inline-js --inline-css --inline-svg`;
    logger.debug(`Running command: ${command}`);

    try {
      const output = execSync(command, {
        encoding: 'utf8',
        cwd: process.cwd(),
        stdio: 'pipe',
      });
      logger.debug(`Fact-sheet generate output: ${output}`);
      logger.success('HTML files generated successfully');
    } catch (execError) {
      const stderr =
        execError instanceof Error && 'stderr' in execError
          ? (execError as any).stderr
          : '';
      const stdout =
        execError instanceof Error && 'stdout' in execError
          ? (execError as any).stdout
          : '';
      logger.error(
        `Fact-sheet generate failed. stdout: ${stdout}, stderr: ${stderr}`
      );
      throw execError;
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error && error.stack ? error.stack : '';
    logger.error(`Failed to generate HTML files: ${errorMsg}`);
    logger.debug(`Error stack trace: ${errorStack}`);
    throw new Error(`Failed to generate HTML files: ${errorMsg}`);
  }
}
