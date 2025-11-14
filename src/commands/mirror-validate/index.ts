import { Command } from 'commander';
import { promises as fs } from 'fs';
import path from 'path';
import { tmpdir } from 'os';
import chalk from 'chalk';
import { extractZipToTemp } from '../../utils/zip.js';
import {
  NEREntityExtractorService,
  type EntityResult,
} from '../../services/ner-entity-extractor.service.js';
import { EntityComparisonService } from '../../services/entity-comparison.service.js';
import { TransformDataAggregatorService } from '../../services/transform-data-aggregator.service.js';
import { cleanHtml } from '../../lib/common.js';
import {
  parseStaticPartsCsv,
  removeStaticParts,
} from '../../utils/static-parts-filter.js';
import type { ComparisonResult } from '../../services/entity-comparison.service.js';
import * as htmlSourceExtractor from '../../utils/html-source-extractor.js';
import * as jsonSourceExtractor from '../../utils/json-source-extractor.js';
import { mapEntitiesToSources } from '../../services/entity-source-mapper.service.js';
import type { TextWithSource } from '../../utils/html-source-extractor.js';

interface MirrorValidateOptions {
  prepareZip: string;
  transformZip: string;
  output?: string;
  staticParts?: string;
}

function addSourcesToUnmatched(
  comparison: ComparisonResult,
  rawData: { formattedText: string; sourceMap: TextWithSource[] },
  rawEntities: import('../../services/ner-entity-extractor.service.js').ExtractedEntities
): ComparisonResult {
  const categories = ['QUANTITY', 'DATE', 'ORGANIZATION', 'LOCATION'] as const;

  for (const category of categories) {
    const categoryComparison = comparison[category];
    const categoryEntities = rawEntities[category];

    if (
      Array.isArray(categoryComparison.unmatchedFromA) &&
      categoryComparison.unmatchedFromA.length > 0
    ) {
      const unmatchedWithSources = categoryComparison.unmatchedFromA.map(
        (value) => {
          // Handle both string and EntityWithSource
          const valueStr = typeof value === 'string' ? value : value.value;

          // Find the entity with this value
          const entity = categoryEntities.find((e) => e.value === valueStr);

          if (!entity) {
            return { value: valueStr, source: 'unknown' };
          }

          const entityWithSource = mapEntitiesToSources(
            [entity],
            rawData.sourceMap,
            rawData.formattedText
          )[0];

          return entityWithSource || { value: valueStr, source: 'unknown' };
        }
      );

      categoryComparison.unmatchedFromA = unmatchedWithSources;
    }
  }

  return comparison;
}

async function extractSourceData(
  prepareDir: string,
  staticSelectors: string[] = []
): Promise<{ formattedText: string; sourceMap: TextWithSource[] }> {
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

    return htmlSourceExtractor.extractTextWithSources(cleaned);
  }

  try {
    const json = JSON.parse(rawContent);
    return jsonSourceExtractor.extractTextWithSources(json);
  } catch {
    // Fallback: treat as plain text with unknown source
    const text = rawContent
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return {
      formattedText: text,
      sourceMap: [{ text, source: 'unknown', lineIndex: 0 }],
    };
  }
}

async function mirrorValidate(options: MirrorValidateOptions): Promise<void> {
  const { prepareZip, transformZip, output, staticParts } = options;

  let prepareTempDir: string | null = null;
  let transformTempDir: string | null = null;

  try {
    // Parse static parts CSV if provided
    let staticSelectors: string[] = [];
    if (staticParts) {
      staticSelectors = await parseStaticPartsCsv(staticParts);
    }

    const prepareTempRoot = await fs.mkdtemp(
      path.join(tmpdir(), 'elephant-validate-prepare-')
    );
    prepareTempDir = prepareTempRoot;
    await extractZipToTemp(prepareZip, prepareTempRoot);
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

    const rawData = await extractSourceData(prepareTempRoot, staticSelectors);

    const extractor = new NEREntityExtractorService();
    await extractor.initialize();

    const rawEntities = await extractor.extractEntities(rawData.formattedText);

    const aggregator = new TransformDataAggregatorService();
    const aggregatedData =
      await aggregator.aggregateTransformOutput(transformDir);
    const transformedText =
      aggregator.convertAggregatedDataToText(aggregatedData);

    const transformedEntities =
      await extractor.extractEntities(transformedText);

    const comparisonService = new EntityComparisonService();
    let comparison = comparisonService.compareEntities(
      rawEntities,
      transformedEntities
    );

    comparison = addSourcesToUnmatched(comparison, rawData, rawEntities);

    printComparisonReport(comparison);

    if (output) {
      // Strip start/end fields from entities for the report
      const stripPositions = (entities: EntityResult[]) =>
        entities.map(({ value, confidence }) => ({ value, confidence }));

      const report = {
        rawEntities: {
          QUANTITY: stripPositions(rawEntities.QUANTITY),
          DATE: stripPositions(rawEntities.DATE),
          ORGANIZATION: stripPositions(rawEntities.ORGANIZATION),
          LOCATION: stripPositions(rawEntities.LOCATION),
        },
        transformedEntities: {
          QUANTITY: stripPositions(transformedEntities.QUANTITY),
          DATE: stripPositions(transformedEntities.DATE),
          ORGANIZATION: stripPositions(transformedEntities.ORGANIZATION),
          LOCATION: stripPositions(transformedEntities.LOCATION),
        },
        comparison,
        summary: {
          globalCompleteness: comparison.globalCompleteness,
          globalCosineSimilarity: comparison.globalCosineSimilarity,
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
  const completenessColor =
    comparison.globalCompleteness >= 0.9
      ? chalk.green
      : comparison.globalCompleteness >= 0.7
        ? chalk.yellow
        : chalk.red;

  const similarityColor =
    comparison.globalCosineSimilarity >= 0.9
      ? chalk.green
      : comparison.globalCosineSimilarity >= 0.7
        ? chalk.yellow
        : chalk.red;

  console.log(
    chalk.bold('\n🎯 Global Completeness Score: ') +
      completenessColor(`${(comparison.globalCompleteness * 100).toFixed(1)}%`)
  );
  console.log(
    chalk.bold('📊 Global Cosine Similarity: ') +
      similarityColor(
        `${(comparison.globalCosineSimilarity * 100).toFixed(1)}%`
      )
  );
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
