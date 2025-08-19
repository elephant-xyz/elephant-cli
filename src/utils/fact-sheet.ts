import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { promises as fsPromises } from 'fs';
import path from 'path';
import * as os from 'os';
import { logger } from './logger.js';

export async function checkFactSheetInstalled(): Promise<boolean> {
  try {
    const pathInSystem = execSync('which fact-sheet', {
      stdio: 'pipe',
      encoding: 'utf8',
    }).trim();
    logger.debug(`fact-sheet found at: ${pathInSystem}`);
    return true;
  } catch {
    const expectedPath = path.join(os.homedir(), '.local', 'bin', 'fact-sheet');
    if (existsSync(expectedPath)) {
      logger.debug(`fact-sheet found at expected location: ${expectedPath}`);
      return true;
    }
    logger.debug('fact-sheet not found in PATH or expected location');
    return false;
  }
}

export function getFactSheetPath(): string {
  try {
    const pathInSystem = execSync('which fact-sheet', {
      stdio: 'pipe',
      encoding: 'utf8',
    }).trim();
    if (pathInSystem) {
      return 'fact-sheet';
    }
  } catch {
    // Not in PATH, use the expected installation location
  }

  return path.join(os.homedir(), '.local', 'bin', 'fact-sheet');
}

export async function installOrUpdateFactSheet(): Promise<void> {
  const isInstalled = await checkFactSheetInstalled();

  try {
    if (isInstalled) {
      logger.info('Fact-sheet tool found, updating to latest version...');
      const updateScript =
        'https://raw.githubusercontent.com/elephant-xyz/fact-sheet-template/main/update.sh';
      logger.debug(`Running update command: curl -fsSL ${updateScript} | bash`);

      try {
        const output = execSync(`curl -fsSL ${updateScript} | bash`, {
          encoding: 'utf8',
          stdio: 'pipe',
        });
        logger.debug(`Update script output: ${output}`);
        logger.success('Fact-sheet tool updated successfully');
      } catch (execError) {
        const stderr =
          execError instanceof Error && 'stderr' in execError
            ? (execError as any).stderr
            : '';
        const stdout =
          execError instanceof Error && 'stdout' in execError
            ? (execError as any).stdout
            : '';

        if (
          stderr.includes('cannot pull with rebase') ||
          stderr.includes('unstaged changes')
        ) {
          logger.error(
            'The fact-sheet tool has local modifications that prevent updating.'
          );
          logger.info('To fix this, run the following commands:');
          logger.info('  cd ~/.elephant-fact-sheet');
          logger.info('  git stash');
          logger.info('  bash update.sh');
          logger.info('  git stash pop');
          logger.warn('Attempting to continue with the current version...');
          return;
        }

        logger.error(
          `Update script failed. stdout: ${stdout}, stderr: ${stderr}`
        );
        throw execError;
      }
    } else {
      logger.info('Fact-sheet tool not found, installing...');
      const installScript =
        'https://raw.githubusercontent.com/elephant-xyz/fact-sheet-template/main/install.sh';
      logger.debug(
        `Running install command: curl -fsSL ${installScript} | bash`
      );

      try {
        const output = execSync(`curl -fsSL ${installScript} | bash`, {
          encoding: 'utf8',
          stdio: 'pipe',
        });
        logger.debug(`Install script output: ${output}`);
        logger.success('Fact-sheet tool installed successfully');
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
          `Install script failed. stdout: ${stdout}, stderr: ${stderr}`
        );
        throw execError;
      }
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    const errorDetails =
      error instanceof Error && error.stack ? error.stack : '';
    logger.error(`Failed to install/update fact-sheet tool: ${errorMsg}`);
    logger.debug(`Error stack trace: ${errorDetails}`);
    throw new Error(`Failed to install/update fact-sheet tool: ${errorMsg}`);
  }
}

export function getFactSheetCommitHash(): string | null {
  try {
    // The fact-sheet tool is typically installed in ~/.elephant-fact-sheet
    const factSheetRepoPath = path.join(os.homedir(), '.elephant-fact-sheet');

    if (!existsSync(factSheetRepoPath)) {
      logger.debug('Fact-sheet repository not found at ~/.elephant-fact-sheet');
      return null;
    }

    // Get the current commit hash
    const commitHash = execSync('git rev-parse HEAD', {
      cwd: factSheetRepoPath,
      encoding: 'utf8',
      stdio: 'pipe',
    }).trim();

    logger.debug(`Fact-sheet tool commit hash: ${commitHash}`);
    return commitHash;
  } catch (error) {
    logger.debug(`Could not get fact-sheet commit hash: ${error}`);
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

    const factSheetCmd = getFactSheetPath();

    try {
      const version = execSync(`${factSheetCmd} --version`, {
        encoding: 'utf8',
      }).trim();
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
