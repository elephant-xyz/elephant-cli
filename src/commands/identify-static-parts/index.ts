import { Command } from 'commander';
import { promises as fs } from 'fs';
import path from 'path';
import { tmpdir } from 'os';
import chalk from 'chalk';
import { extractZipToTemp } from '../../utils/zip.js';
import { StaticPartsIdentifierService } from '../../services/static-parts-identifier.service.js';

interface IdentifyStaticPartsOptions {
  inputZip: string;
  output?: string;
}

async function identifyStaticParts(
  options: IdentifyStaticPartsOptions
): Promise<void> {
  const { inputZip, output } = options;

  console.log(chalk.blue('\n=== Identify Static Parts ===\n'));

  let tempDir: string | null = null;

  try {
    console.log(chalk.gray('[1/4] Extracting input zip...'));
    const tempRoot = await fs.mkdtemp(
      path.join(tmpdir(), 'elephant-static-parts-')
    );
    tempDir = tempRoot;
    await extractZipToTemp(inputZip, tempRoot);

    console.log(chalk.gray('[2/4] Reading HTML files...'));
    const files = await fs.readdir(tempRoot, { withFileTypes: true });
    const htmlFiles = files
      .filter((f) => f.isFile() && /\.html?$/i.test(f.name))
      .map((f) => path.join(tempRoot, f.name));

    if (htmlFiles.length < 2) {
      throw new Error(
        `At least 2 HTML files are required, found ${htmlFiles.length}`
      );
    }

    console.log(chalk.green(`    ✓ Found ${htmlFiles.length} HTML files`));

    const htmlContents = await Promise.all(
      htmlFiles.map((file) => fs.readFile(file, 'utf-8'))
    );

    console.log(chalk.gray('[3/4] Analyzing static parts...'));
    const service = new StaticPartsIdentifierService();
    const selectors = await service.identifyStaticParts(htmlContents);

    console.log(
      chalk.green(`    ✓ Identified ${selectors.length} static selectors`)
    );

    console.log(chalk.gray('[4/4] Writing CSV output...'));

    const outputPath = output || 'static-parts.csv';
    const csvContent =
      'cssSelector\n' + selectors.map((s) => `"${s}"`).join('\n');

    await fs.writeFile(outputPath, csvContent, 'utf-8');

    console.log(chalk.green(`\n✓ CSV saved to: ${outputPath}\n`));

    console.log(chalk.bold('\n📊 STATIC PARTS SUMMARY\n'));
    console.log('='.repeat(70));
    console.log(`  Total static selectors: ${selectors.length}`);
    console.log(`  HTML files analyzed: ${htmlFiles.length}`);
    console.log('='.repeat(70));

    if (selectors.length > 0) {
      console.log(chalk.gray('\nFirst 10 selectors:'));
      selectors.slice(0, 10).forEach((sel) => {
        console.log(chalk.gray(`  • ${sel}`));
      });
      if (selectors.length > 10) {
        console.log(chalk.gray(`  ... and ${selectors.length - 10} more`));
      }
    }

    console.log();
  } finally {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

export function registerIdentifyStaticPartsCommand(program: Command): void {
  program
    .command('identify-static-parts')
    .description(
      'Identify static DOM parts that are identical across multiple HTML files'
    )
    .requiredOption(
      '--input-zip <path>',
      'Path to zip file containing HTML files (minimum 2 files)'
    )
    .option(
      '--output <path>',
      'Output CSV file path (default: static-parts.csv)',
      'static-parts.csv'
    )
    .action(async (options) => {
      try {
        await identifyStaticParts(options);
      } catch (error) {
        console.error(
          chalk.red('\n❌ Error:'),
          error instanceof Error ? error.message : String(error)
        );
        process.exit(1);
      }
    });
}
