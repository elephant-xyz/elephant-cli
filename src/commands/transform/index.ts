import { Command } from 'commander';
import chalk from 'chalk';
import { existsSync, promises as fs } from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';
import { tmpdir } from 'os';
import { parse } from 'csv-parse/sync';
import { logger } from '../../utils/logger.js';
import { handleLegacyTransform } from './legacy-agent.js';
import { runScriptsPipeline } from './script-runner.js';
import { extractZipToTemp } from '../../utils/zip.js';
import { createCountyDataGroup } from './county-datagroup.js';
import { fetchSchemaManifest } from '../../utils/schema-fetcher.js';
import { generateHTMLFiles } from '../../utils/fact-sheet.js';
import { SchemaManifestService } from '../../services/schema-manifest.service.js';
import { FactSheetRelationshipService } from '../../services/fact-sheet-relationship.service.js';
import { SchemaCacheService } from '../../services/schema-cache.service.js';
import {
  parseMultiValueQueryString,
  SourceHttpRequest,
} from './sourceHttpRequest.js';

const INPUT_DIR = 'input';
const OUTPUT_DIR = 'data';

export interface TransformCommandOptions {
  outputZip?: string;
  scriptsZip?: string;
  inputsZip?: string;
  legacyMode?: boolean;
  silent?: boolean;
  cwd?: string;
  [key: string]: any;
}

interface SeedRow {
  parcel_id: string;
  address: string;
  method: 'GET' | 'POST';
  url: string;
  multiValueQueryString: string;
  source_identifier: string;
  county: string;
  json?: string;
  body?: string;
  headers?: string;
}

function capitalizeWords(str: string) {
  return str
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

export function registerTransformCommand(program: Command) {
  program
    .command('transform')
    .description(
      'Transform property data to Lexicon schema-valid format and generate HTML, or run generated scripts'
    )
    .allowUnknownOption()
    .option(
      '--output-zip <path>',
      'Output ZIP file path',
      'transformed-data.zip'
    )
    .option(
      '--scripts-zip <path>',
      'Run transformation using generated scripts ZIP'
    )
    .option(
      '--input-zip <path>',
      'Input ZIP for scripts mode (must include unnormalized_address.json, property_seed.json, and an HTML/JSON file)'
    )
    .option('--legacy-mode', 'Use legacy mode for transforming data', false)
    .action(async (options: TransformCommandOptions) => {
      await handleTransform(options);
    });
}

export async function handleTransform(options: TransformCommandOptions) {
  if (!options.silent) {
    console.log(chalk.bold.blue('🐘 Elephant Network CLI - Transform'));
    console.log();
  }

  if (options.legacyMode) {
    await handleLegacyTransform(options);
  } else {
    await handleScriptsMode(options);
  }
}

async function handleScriptsMode(options: TransformCommandOptions) {
  const workingDir = options.cwd || process.cwd();
  const outputZip = options.outputZip || 'transformed-data.zip';
  const resolvedOutputZip = path.resolve(workingDir, outputZip);
  const resolvedInputZip = options.inputZip
    ? path.resolve(workingDir, options.inputZip)
    : undefined;
  const resolvedScriptsZip = options.scriptsZip
    ? path.resolve(workingDir, options.scriptsZip)
    : undefined;

  if (!resolvedInputZip) {
    const error = 'In scripts mode, --input-zip is required';
    if (!options.silent) {
      console.error(chalk.red(error));
    }
    if (options.silent) {
      throw new Error(error);
    } else {
      process.exit(1);
    }
  }
  if (!existsSync(resolvedInputZip)) {
    const error = `input-zip not found: ${resolvedInputZip}`;
    logger.error(error);
    if (options.silent) {
      throw new Error(error);
    } else {
      process.exit(1);
    }
  }

  const tempRoot = await fs.mkdtemp(path.join(tmpdir(), 'elephant-transform-'));
  const cleanup: Array<() => Promise<void>> = [
    async () => {
      try {
        await fs.rm(tempRoot, { recursive: true, force: true });
      } catch {
        logger.warn(`Unable to remove ${tempRoot}`);
      }
    },
  ];

  try {
    logger.info('Extracting inputs to tempdir...');
    const inputsDir = await extractZipToTemp(
      resolvedInputZip,
      tempRoot,
      INPUT_DIR
    );
    await normalizeInputsForScripts(inputsDir, tempRoot);

    if (resolvedScriptsZip) {
      logger.info('Extracting scripts to tempdir...');
      const scriptsDir = await extractZipToTemp(
        resolvedScriptsZip,
        tempRoot,
        'scripts'
      );
      const extractorOnly = await hasOnlyExtractor(scriptsDir);
      await handleCountyTransform(scriptsDir, tempRoot, extractorOnly);
    } else {
      logger.info('Processing seed data group...');
      await handleSeedTransform(tempRoot);
    }

    await generateFactSheet(tempRoot);
    const zip = new AdmZip();
    for (const rel of await fs.readdir(path.join(tempRoot, OUTPUT_DIR))) {
      zip.addLocalFile(path.join(tempRoot, OUTPUT_DIR, rel), 'data');
    }
    zip.writeZip(resolvedOutputZip);

    logger.success(
      `Scripts execution complete. Output saved to: ${resolvedOutputZip}`
    );
    if (!options.silent) {
      console.log(chalk.green('✅ Transform (scripts mode) finished'));
      console.log(chalk.bold('📊 Output:'));
      console.log(`  JSON bundle for hash: ${chalk.cyan(resolvedOutputZip)}`);
    }
  } catch (e) {
    const errorMsg = `Error during transform (scripts mode): ${e}`;
    if (!options.silent) {
      console.error(chalk.red(errorMsg));
    }
    if (e instanceof Error) {
      logger.error(e.stack);
    }
    if (options.silent) {
      throw e instanceof Error ? e : new Error(errorMsg);
    } else {
      process.exit(1);
    }
  } finally {
    for (const fn of cleanup) await fn();
  }
}

async function generateFactSheet(tempRoot: string) {
  const outputPath = path.join(tempRoot, OUTPUT_DIR);
  const htmlOutputDir = path.join(tmpdir(), 'generated-htmls');
  await generateHTMLFiles(tempRoot, htmlOutputDir);
  const htmlEntries = await fs.readdir(htmlOutputDir, {
    withFileTypes: true,
  });
  const propertySubDirs = htmlEntries.filter((entry) => entry.isDirectory());
  const htmlPropertyDir = path.join(htmlOutputDir, propertySubDirs[0].name);
  const htmlPropertyEntries = await fs.readdir(htmlPropertyDir, {
    withFileTypes: true,
  });
  for (const entry of htmlPropertyEntries) {
    const srcPath = path.join(htmlPropertyDir, entry.name);
    const destPath = path.join(outputPath, entry.name);

    if (entry.isFile()) {
      await fs.rename(srcPath, destPath);
      logger.debug(`Copied ${entry.name} to property directory`);
    } else if (entry.isDirectory()) {
      await moveDirectory(srcPath, destPath);
      logger.debug(`Copied directory ${entry.name} to property directory`);
    }
  }
  const schemaManifestService = new SchemaManifestService();
  const schemaCacheService = new SchemaCacheService();
  const factSheetRelationshipService = new FactSheetRelationshipService(
    schemaManifestService,
    schemaCacheService
  );

  await factSheetRelationshipService.generateFactSheetRelationships(outputPath);

  logger.success('Successfully generated fact_sheet relationships');
}

async function moveDirectory(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await moveDirectory(srcPath, destPath);
    } else {
      await fs.rename(srcPath, destPath);
    }
  }
}
async function handleSeedTransform(tempRoot: string) {
  const seedCsv = await fs.readFile(
    path.join(tempRoot, INPUT_DIR, 'seed.csv'),
    'utf-8'
  );
  const parsed = parse(seedCsv, {
    columns: true,
    skip_empty_lines: true,
  });
  const seedRow = parsed[0] as SeedRow;
  const seedJson = JSON.stringify({
    label: 'Seed',
    relationships: {
      property_seed: {
        '/': './relationship_property_to_address.json',
      },
    },
  });
  const relJson = JSON.stringify({
    from: {
      '/': './property_seed.json',
    },
    to: {
      '/': './unnormalized_address.json',
    },
  });
  const sourceHttpRequest: SourceHttpRequest = {
    url: seedRow.url,
    method: seedRow.method,
    multiValueQueryString: seedRow.multiValueQueryString?.trim()
      ? parseMultiValueQueryString(seedRow.multiValueQueryString)
      : {},
  };
  if (seedRow.headers) {
    sourceHttpRequest.headers = JSON.parse(seedRow.headers);
  }
  if (seedRow.json && seedRow.body) {
    throw new Error(
      'Both json and body fields are present in seed.csv. Only one of these fields can be processed at a time.'
    );
  }
  if (seedRow.json) {
    sourceHttpRequest.json = JSON.parse(seedRow.json);
    if (!sourceHttpRequest.headers) {
      sourceHttpRequest.headers = { 'content-type': 'application/json' };
    } else {
      sourceHttpRequest.headers['content-type'] = 'application/json';
    }
  }
  if (seedRow.body) {
    sourceHttpRequest.body = seedRow.body;
  }
  const propSeedJson = JSON.stringify({
    parcel_id: seedRow.parcel_id,
    source_http_request: sourceHttpRequest,
    request_identifier: seedRow.source_identifier,
  });
  const addressJson = JSON.stringify({
    source_http_request: sourceHttpRequest,
    request_identifier: seedRow.source_identifier,
    full_address: seedRow.address,
    county_jurisdiction: capitalizeWords(seedRow.county),
  });
  await fs.mkdir(path.join(tempRoot, OUTPUT_DIR), { recursive: true });
  const schemaManifest = await fetchSchemaManifest();
  const seedDataGroupCid = schemaManifest['Seed']!.ipfsCid;
  const fileNameContent: { name: string; content: string }[] = [
    { name: `${seedDataGroupCid}.json`, content: seedJson },
    { name: 'relationship_property_to_address.json', content: relJson },
    { name: 'property_seed.json', content: propSeedJson },
    { name: 'unnormalized_address.json', content: addressJson },
  ];
  await Promise.all(
    fileNameContent.map(async (file) => {
      const absPath = path.join(tempRoot, OUTPUT_DIR, file.name);
      await fs.writeFile(absPath, file.content, 'utf-8');
    })
  );
}

async function handleCountyTransform(
  scriptsDir: string,
  tempRoot: string,
  extractorOnly = false
) {
  logger.info('Running generated scripts pipeline...');
  await runScriptsPipeline(scriptsDir, tempRoot, { extractorOnly });

  const newJsonRelPaths = await fs.readdir(path.join(tempRoot, OUTPUT_DIR));
  if (newJsonRelPaths.length === 0) {
    logger.warn('No new JSON files detected from scripts execution');
  }

  const propertySeed = await fs.readFile(
    path.join(tempRoot, 'property_seed.json'),
    'utf-8'
  );
  const propertySeedJson = JSON.parse(propertySeed);
  const sourceHttpRequest = propertySeedJson.source_http_request;
  const requestIdentifier = propertySeedJson.request_identifier;
  const relationshipFiles: string[] = [];
  await Promise.all(
    newJsonRelPaths.map(async (rel) => {
      if ((await fs.stat(path.join(tempRoot, OUTPUT_DIR, rel))).isDirectory()) {
        return;
      }
      if (!rel.endsWith('.json')) {
        return;
      }
      if (rel.startsWith('relationship')) {
        return;
      }
      if (rel.endsWith('data.json')) {
        return;
      }
      const json = await fs.readFile(
        path.join(tempRoot, OUTPUT_DIR, rel),
        'utf-8'
      );
      const jsonObj = JSON.parse(json);
      jsonObj.source_http_request = sourceHttpRequest;
      jsonObj.request_identifier = requestIdentifier;
      await fs.writeFile(
        path.join(tempRoot, OUTPUT_DIR, rel),
        JSON.stringify(jsonObj),
        'utf-8'
      );

      if (rel.endsWith('property.json')) {
        return;
      }
      if (rel.startsWith('person') || rel.startsWith('company')) {
        const relData = {
          from: { '/': `./${rel}` },
          to: { '/': `./property.json` },
        };
        const relFileName = `relationship_${rel.replace('.json', '')}_property.json`;
        relationshipFiles.push(relFileName);
        await fs.writeFile(
          path.join(tempRoot, OUTPUT_DIR, relFileName),
          JSON.stringify(relData),
          'utf-8'
        );
        return;
      }
      const relFileName = `relationship_property_${rel}`;
      const relData = {
        from: { '/': `./property.json` },
        to: { '/': `./${rel}` },
      };
      relationshipFiles.push(relFileName);
      await fs.writeFile(
        path.join(tempRoot, OUTPUT_DIR, relFileName),
        JSON.stringify(relData),
        'utf-8'
      );
    })
  );

  if (!extractorOnly) {
    const countyDataGroup = createCountyDataGroup(relationshipFiles);
    const schemaManifest = await fetchSchemaManifest();
    const countySchema = schemaManifest['County']!.ipfsCid;
    await fs.writeFile(
      path.join(tempRoot, OUTPUT_DIR, `${countySchema}.json`),
      JSON.stringify(countyDataGroup),
      'utf-8'
    );
  }
}

async function hasOnlyExtractor(scriptsDir: string): Promise<boolean> {
  const required = ['ownerMapping.js', 'structureMapping.js', 'layoutMapping.js', 'utilityMapping.js'];
  for (const name of required) {
    const found = await findFileRecursiveLocal(scriptsDir, name);
    if (found) return false;
  }
  return true;
}

async function findFileRecursiveLocal(root: string, fileName: string): Promise<string | null> {
  const stack: string[] = [root];
  while (stack.length) {
    const dir = stack.pop()!;
    const items = await fs.readdir(dir, { withFileTypes: true });
    for (const it of items) {
      const abs = path.join(dir, it.name);
      if (it.isDirectory()) stack.push(abs);
      else if (it.isFile() && it.name === fileName) return abs;
    }
  }
  return null;
}

async function normalizeInputsForScripts(
  inputsDir: string,
  tempRoot: string
): Promise<void> {
  const copyIfExists = async (name: string) => {
    const src = path.join(inputsDir, name);
    try {
      const st = await fs.stat(src);
      if (st.isFile()) await fs.copyFile(src, path.join(tempRoot, name));
    } catch {
      logger.warn(`Unable to copy ${src} to ${tempRoot}`);
    }
  };
  await copyIfExists('unnormalized_address.json');
  await copyIfExists('property_seed.json');

  const entries = await fs.readdir(inputsDir, { withFileTypes: true });
  const files = entries.filter((e) => e.isFile()).map((e) => e.name);
  const htmlOrJson =
    files.find((f) => /\.html?$/i.test(f)) ||
    files.find(
      (f) =>
        /\.json$/i.test(f) &&
        f !== 'unnormalized_address.json' &&
        f !== 'property_seed.json'
    );
  if (htmlOrJson) {
    const destName = /\.html?$/i.test(htmlOrJson) ? 'input.html' : 'input.json';
    await fs.copyFile(
      path.join(inputsDir, htmlOrJson),
      path.join(tempRoot, destName)
    );
  }
}
