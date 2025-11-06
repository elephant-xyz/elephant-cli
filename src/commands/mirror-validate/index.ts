import { Command } from 'commander';
import { promises as fs } from 'fs';
import path from 'path';
import { tmpdir } from 'os';
import chalk from 'chalk';
import { extractZipToTemp } from '../../utils/zip.js';
import { NEREntityExtractorService } from '../../services/ner-entity-extractor.service.js';
import { EntityComparisonService } from '../../services/entity-comparison.service.js';
import { TransformDataAggregatorService } from '../../services/transform-data-aggregator.service.js';
import { cleanHtml } from '../../lib/common.js';
import {
  parseStaticPartsCsv,
  removeStaticParts,
} from '../../utils/static-parts-filter.js';
import type { ComparisonResult } from '../../services/entity-comparison.service.js';

interface MirrorValidateOptions {
  prepareZip: string;
  transformZip: string;
  output?: string;
  staticParts?: string;
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function extractSourceData(
  prepareDir: string,
  staticSelectors: string[] = []
): Promise<string> {
  const files = await fs.readdir(prepareDir, { withFileTypes: true });
  const fileNames = files.filter((f) => f.isFile()).map((f) => f.name);

  const htmlFile =
    fileNames.find((f) => /\.html?$/i.test(f)) ||
    fileNames.find(
      (f) =>
        /\.json$/i.test(f) &&
        f !== 'address.json' &&
        f !== 'parcel.json' &&
        f !== 'unnormalized_address.json' &&
        f !== 'property_seed.json'
    );

  if (!htmlFile) {
    throw new Error('No source HTML or JSON file found in prepare output');
  }

  const filePath = path.join(prepareDir, htmlFile);
  const rawContent = await fs.readFile(filePath, 'utf-8');

  if (/\.html?$/i.test(htmlFile)) {
    let cleaned = await cleanHtml(rawContent);

    // Remove static parts if selectors provided
    if (staticSelectors.length > 0) {
      cleaned = removeStaticParts(cleaned, staticSelectors);
    }

    return stripHtml(cleaned);
  }

  try {
    const json = JSON.parse(rawContent);
    const aggregator = new TransformDataAggregatorService();
    const parts = aggregator.jsonToText(json);
    return parts.join('. ').replace(/\.\./g, '.').replace(/\s+/g, ' ').trim();
  } catch {
    return stripHtml(rawContent);
  }
}

async function mirrorValidate(options: MirrorValidateOptions): Promise<void> {
  const { prepareZip, transformZip, output, staticParts } = options;

  console.log(chalk.blue('\n=== Mirror Validation ===\n'));

  let prepareTempDir: string | null = null;
  let transformTempDir: string | null = null;

  try {
    // Parse static parts CSV if provided
    let staticSelectors: string[] = [];
    if (staticParts) {
      console.log(chalk.gray('[1/7] Loading static parts selectors...'));
      staticSelectors = await parseStaticPartsCsv(staticParts);
      console.log(
        chalk.green(`    ✓ Loaded ${staticSelectors.length} selectors`)
      );
    }

    const step1 = staticParts ? 2 : 1;
    const step2 = staticParts ? 3 : 2;
    const step3 = staticParts ? 4 : 3;

    console.log(chalk.gray(`[${step1}/6] Extracting prepare output...`));
    const prepareTempRoot = await fs.mkdtemp(
      path.join(tmpdir(), 'elephant-validate-prepare-')
    );
    prepareTempDir = prepareTempRoot;
    await extractZipToTemp(prepareZip, prepareTempRoot);

    console.log(chalk.gray(`[${step2}/6] Extracting transform output...`));
    const transformTempRoot = await fs.mkdtemp(
      path.join(tmpdir(), 'elephant-validate-transform-')
    );
    transformTempDir = transformTempRoot;
    await extractZipToTemp(transformZip, transformTempRoot);

    const transformDataDir = path.join(transformTempRoot, 'data');
    const transformDataDirExists = await fs
      .stat(transformDataDir)
      .then((s) => s.isDirectory())
      .catch(() => false);

    const transformDir = transformDataDirExists
      ? transformDataDir
      : transformTempRoot;

    console.log(
      chalk.gray(`[${step3}/6] Extracting entities from raw data...`)
    );
    if (staticSelectors.length > 0) {
      console.log(
        chalk.gray(
          `    Filtering out ${staticSelectors.length} static DOM parts...`
        )
      );
    }
    const rawText = await extractSourceData(prepareTempRoot, staticSelectors);

    console.log(chalk.gray('    Loading NER models...'));
    const extractor = new NEREntityExtractorService();
    await extractor.initialize();

    console.log(chalk.gray('    Running entity extraction on raw data...'));
    const rawEntities = await extractor.extractEntities(rawText);

    console.log(
      chalk.green(
        `    ✓ Extracted ${rawEntities.QUANTITY.length} quantities, ${rawEntities.DATE.length} dates, ` +
          `${rawEntities.ORGANIZATION.length} orgs, ${rawEntities.LOCATION.length} locations`
      )
    );

    console.log(
      chalk.gray('[4/6] Extracting entities from transformed data...')
    );
    const aggregator = new TransformDataAggregatorService();
    const aggregatedData =
      await aggregator.aggregateTransformOutput(transformDir);
    const transformedText =
      aggregator.convertAggregatedDataToText(aggregatedData);

    console.log(
      chalk.gray('    Running entity extraction on transformed data...')
    );
    const transformedEntities =
      await extractor.extractEntities(transformedText);

    console.log(
      chalk.green(
        `    ✓ Extracted ${transformedEntities.QUANTITY.length} quantities, ${transformedEntities.DATE.length} dates, ` +
          `${transformedEntities.ORGANIZATION.length} orgs, ${transformedEntities.LOCATION.length} locations`
      )
    );

    console.log(chalk.gray('[5/6] Comparing entities...'));
    const comparisonService = new EntityComparisonService();
    const comparison = comparisonService.compareEntities(
      rawEntities,
      transformedEntities
    );

    console.log(chalk.gray('[6/6] Generating report...\n'));
    printComparisonReport(comparison);

    if (output) {
      const report = {
        rawEntities,
        transformedEntities,
        comparison,
        summary: {
          globalCompleteness: comparison.globalCompleteness,
          rawStats: {
            quantity: rawEntities.QUANTITY.length,
            date: rawEntities.DATE.length,
            organization: rawEntities.ORGANIZATION.length,
            location: rawEntities.LOCATION.length,
          },
          transformedStats: {
            quantity: transformedEntities.QUANTITY.length,
            date: transformedEntities.DATE.length,
            organization: transformedEntities.ORGANIZATION.length,
            location: transformedEntities.LOCATION.length,
          },
        },
      };

      await fs.writeFile(output, JSON.stringify(report, null, 2), 'utf-8');
      console.log(chalk.green(`\n✓ Report saved to: ${output}\n`));
    }
  } finally {
    if (prepareTempDir) {
      await fs
        .rm(prepareTempDir, { recursive: true, force: true })
        .catch(() => {});
    }
    if (transformTempDir) {
      await fs
        .rm(transformTempDir, { recursive: true, force: true })
        .catch(() => {});
    }
  }
}

function printComparisonReport(comparison: ComparisonResult): void {
  console.log(chalk.bold('\n📊 COMPLETENESS ANALYSIS\n'));
  console.log('='.repeat(70));

  const categories = [
    { key: 'QUANTITY', label: '💵 Quantity', data: comparison.QUANTITY },
    { key: 'DATE', label: '📅 Date', data: comparison.DATE },
    {
      key: 'ORGANIZATION',
      label: '🏢 Organization',
      data: comparison.ORGANIZATION,
    },
    { key: 'LOCATION', label: '📍 Location', data: comparison.LOCATION },
  ];

  for (const cat of categories) {
    console.log(`\n${chalk.bold(cat.label)}`);
    console.log('-'.repeat(70));

    console.log(
      `  Raw data:         ${cat.data.statsA.count} entities (avg confidence: ${cat.data.statsA.avgConfidence.toFixed(1)}%)`
    );
    console.log(
      `  Transformed data: ${cat.data.statsB.count} entities (avg confidence: ${cat.data.statsB.avgConfidence.toFixed(1)}%)`
    );

    console.log(
      `\n  Cosine Similarity: ${(cat.data.cosineSimilarity * 100).toFixed(1)}%`
    );

    const coverageColor =
      cat.data.coverage >= 0.9
        ? chalk.green
        : cat.data.coverage >= 0.7
          ? chalk.yellow
          : chalk.red;

    console.log(
      `  Coverage:          ${coverageColor((cat.data.coverage * 100).toFixed(1) + '%')}`
    );

    if (cat.data.unmatchedFromA.length > 0) {
      console.log(
        `\n  ⚠️  Unmatched entities (${cat.data.unmatchedFromA.length}):`
      );
      cat.data.unmatchedFromA.slice(0, 5).forEach((entity) => {
        console.log(chalk.yellow(`    • ${entity}`));
      });
      if (cat.data.unmatchedFromA.length > 5) {
        console.log(
          chalk.gray(`    ... and ${cat.data.unmatchedFromA.length - 5} more`)
        );
      }
    }
  }

  console.log('\n' + '='.repeat(70));
  const completenessColor =
    comparison.globalCompleteness >= 0.9
      ? chalk.green
      : comparison.globalCompleteness >= 0.7
        ? chalk.yellow
        : chalk.red;

  console.log(
    chalk.bold('\n🎯 Global Completeness Score: ') +
      completenessColor(`${(comparison.globalCompleteness * 100).toFixed(1)}%`)
  );
  console.log('='.repeat(70) + '\n');
}

export function registerMirrorValidateCommand(program: Command): void {
  program
    .command('mirror-validate')
    .description(
      'Validate entity completeness between raw and transformed data using mirror validation'
    )
    .requiredOption(
      '--prepare-zip <path>',
      'Path to prepare command output zip'
    )
    .requiredOption(
      '--transform-zip <path>',
      'Path to transform command output zip'
    )
    .option(
      '--output <path>',
      'Output JSON file for detailed comparison report'
    )
    .option(
      '--static-parts <path>',
      'Path to CSV file with static DOM selectors to exclude from analysis (generated by identify-static-parts command)'
    )
    .action(async (options) => {
      try {
        await mirrorValidate(options);
      } catch (error) {
        console.error(
          chalk.red('\n❌ Error:'),
          error instanceof Error ? error.message : String(error)
        );
        process.exit(1);
      }
    });
}
