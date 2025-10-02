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
import { createPropertyImprovementDataGroup } from './property-improvement-datagroup.js';
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
  longitude?: string;
  latitude?: string;
  json?: string;
  body?: string;
  headers?: string;
}

function capitalizeWords(str: string) {
  if (!str) return '';
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

  let isSeedMode = false;
  let isPropertyImprovementMode = false;
    if (resolvedScriptsZip) {
      logger.info('Extracting scripts to tempdir...');
      const scriptsDir = await extractZipToTemp(
        resolvedScriptsZip,
        tempRoot,
        'scripts'
      );
      console.log(`Scripts extracted to: ${scriptsDir}`);
      isPropertyImprovementMode = await handleCountyTransform(scriptsDir, tempRoot);
      console.log(`Property improvement mode: ${isPropertyImprovementMode}`);
    } else {
      logger.info('Processing seed data group...');
      await handleSeedTransform(tempRoot);
      isSeedMode = true;
    }

    // Skip fact sheet generation per user instruction
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
  const addressData: any = {
    source_http_request: sourceHttpRequest,
    request_identifier: seedRow.source_identifier,
    full_address: seedRow.address,
    county_jurisdiction: capitalizeWords(seedRow.county),
  };

  if (seedRow.longitude && seedRow.latitude) {
    addressData.longitude = parseFloat(seedRow.longitude);
    addressData.latitude = parseFloat(seedRow.latitude);
  }

  const addressJson = JSON.stringify(addressData);
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

async function handleCountyTransform(scriptsDir: string, tempRoot: string): Promise<boolean> {
  logger.info('Running generated scripts pipeline...');
  await runScriptsPipeline(scriptsDir, tempRoot);

  const newJsonRelPaths = await fs.readdir(path.join(tempRoot, OUTPUT_DIR));
  if (newJsonRelPaths.length === 0) {
    logger.warn('No new JSON files detected from scripts execution');
  }

  let sourceHttpRequest: any | undefined;
  let requestIdentifier: string | undefined;
  try {
    const propertySeed = await fs.readFile(
      path.join(tempRoot, 'property_seed.json'),
      'utf-8'
    );
    const propertySeedJson = JSON.parse(propertySeed);
    sourceHttpRequest = propertySeedJson.source_http_request;
    requestIdentifier = propertySeedJson.request_identifier;
  } catch {
    logger.warn('property_seed.json not found; skipping source_http_request enrichment');
  }
  // Check if this is property improvement data by looking for property improvement files
  let hasPropertyImprovementData = newJsonRelPaths.some(rel =>
    rel.includes('property_improvement_data') && rel.endsWith('.json')
  );

  const relationshipFiles: string[] = [];
  let hasPropertyDataFile = false;
  const improvementFiles: string[] = [];
  await Promise.all(
    newJsonRelPaths.map(async (rel) => {
      const abs = path.join(tempRoot, OUTPUT_DIR, rel);
      if ((await fs.stat(abs)).isDirectory()) {
        return;
      }
      if (!rel.endsWith('.json')) {
        return;
      }
      if (rel.startsWith('relationship')) {
        return;
      }
      // If script emitted explicit property->improvement relationship files, include them
      if (/^(property_improvement_to_property_|property_to_property_improvement_)\d+\.json$/i.test(rel)) {
        relationshipFiles.push(rel);
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
      
      // Don't override source_http_request for property improvement data files
      // as they have their own specific URLs
      if (!rel.includes('property_improvement_data')) {
        if (sourceHttpRequest) jsonObj.source_http_request = sourceHttpRequest;
        if (requestIdentifier) jsonObj.request_identifier = requestIdentifier;
      }
      
      await fs.writeFile(
        path.join(tempRoot, OUTPUT_DIR, rel),
        JSON.stringify(jsonObj),
        'utf-8'
      );

      if (rel.endsWith('property.json')) {
        return;
      }
      
      // Handle property improvement relationships
      if (rel.includes('property_improvement_data')) {
        improvementFiles.push(rel);
        return;
      }

      if (rel === 'property_data.json') {
        hasPropertyDataFile = true;
        return;
      }
      
      // For Property Improvement mode, skip creating relationships for other files
      if (hasPropertyImprovementData) {
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

  // If we have a property file and improvement files but no explicit relationships, create them now
  if (hasPropertyDataFile && improvementFiles.length > 0) {
    for (const file of improvementFiles) {
      const idx = file.match(/(\d+)/)?.[1] || '1';
      const relFileName = `property_improvement_to_property_${idx}.json`;
      const relData = {
        from: { '/': './property_data.json' },
        to: { '/': `./${file}` },
      };
      relationshipFiles.push(relFileName);
      await fs.writeFile(
        path.join(tempRoot, OUTPUT_DIR, relFileName),
        JSON.stringify(relData),
        'utf-8'
      );
    }
  }

  // If no explicit property improvement relationships were emitted, optionally create relationships
  // 1) property -> improvement (when property_data.json and improvement files exist)
  if (hasPropertyDataFile && improvementFiles.length > 0) {
    for (const file of improvementFiles) {
      const idx = file.match(/(\d+)/)?.[1] || '1';
      const relFileName = `property_improvement_to_property_${idx}.json`;
      const relData = {
        from: { '/': './property_data.json' },
        to: { '/': `./${file}` },
      };
      relationshipFiles.push(relFileName);
      await fs.writeFile(
        path.join(tempRoot, OUTPUT_DIR, relFileName),
        JSON.stringify(relData),
        'utf-8'
      );
    }
    hasPropertyImprovementData = true;
  }

  // 2) contractor/company/communication from CSV-sourced CID when PI objects not present
  if (!hasPropertyImprovementData) {
    // Look for permit CSV in inputs dir
    const csvCandidates = ['permit_record.csv', 'permit.csv'];
    let improvementCid: string | null = null;
    for (const name of csvCandidates) {
      try {
        const csvPath = path.join(tempRoot, INPUT_DIR, name);
        const raw = await fs.readFile(csvPath, 'utf-8');
        const isTsv = raw.split('\n', 1)[0]?.includes('\t');
        const rows = parse(raw, { columns: true, skip_empty_lines: true, delimiter: isTsv ? '\t' : ',' });
        const r = rows[0] as Record<string, string> | undefined;
        const id = r?.id?.toString().trim();
        if (id) {
          improvementCid = id;
          break;
        }
      } catch {}
    }
    if (improvementCid) {
      // Create property_improvement_to_company (contractor) if company.json exists
      const companyPath = path.join(tempRoot, OUTPUT_DIR, 'company.json');
      try {
        await fs.access(companyPath);
        const relContractorName = 'property_improvement_to_company.json';
        const relContractor = { from: { '/': improvementCid }, to: { '/': './company.json' } };
        relationshipFiles.push(relContractorName);
        await fs.writeFile(
          path.join(tempRoot, OUTPUT_DIR, relContractorName),
          JSON.stringify(relContractor),
          'utf-8'
        );
        hasPropertyImprovementData = true;
      } catch {}

      // Create company_to_communication if both exist
      try {
        await fs.access(path.join(tempRoot, OUTPUT_DIR, 'company.json'));
        await fs.access(path.join(tempRoot, OUTPUT_DIR, 'communication.json'));
        const relCCName = 'company_to_communication.json';
        const relCC = { from: { '/': './company.json' }, to: { '/': './communication.json' } };
        relationshipFiles.push(relCCName);
        await fs.writeFile(
          path.join(tempRoot, OUTPUT_DIR, relCCName),
          JSON.stringify(relCC),
          'utf-8'
        );
        hasPropertyImprovementData = true;
      } catch {}
    }
  }

  // As a secondary signal, treat presence of contractor relationships as property improvement mode
  if (!hasPropertyImprovementData) {
    hasPropertyImprovementData = relationshipFiles.some(rel =>
      rel === 'property_improvement_to_company.json' || rel === 'company_to_communication.json'
    );
  }

  if (hasPropertyImprovementData) {
    // For Property Improvement, only create the required relationships
    // Filter relationshipFiles to required PI relationships
    const propertyImprovementRelationships = relationshipFiles.filter(rel => 
      rel.startsWith('property_improvement_to_property') ||
      rel === 'property_improvement_to_company.json' ||
      rel === 'company_to_communication.json'
    );
    
    // Create property improvement data group with only required relationships
    const propertyImprovementDataGroup = createPropertyImprovementDataGroup(propertyImprovementRelationships);
    // Note: Do not add source_http_request or request_identifier to data group
    // as the validation tool expects exactly 2 keys: "label" and "relationships"
    
    const schemaManifest = await fetchSchemaManifest();
    // Handle the mismatch between manifest key and validation enum
    const propertyImprovementSchema = schemaManifest['Property_Improvement']!.ipfsCid;
    await fs.writeFile(
      path.join(tempRoot, OUTPUT_DIR, `${propertyImprovementSchema}.json`),
      JSON.stringify(propertyImprovementDataGroup),
      'utf-8'
    );
    logger.info('Created Property Improvement data group');

    // Cleanup: remove property_data.json and unwanted relationships
    // Cleanup: remove unwanted relationships and any auto-created property_improvement_to_property_*.json
    const files = await fs.readdir(path.join(tempRoot, OUTPUT_DIR));
    await Promise.all([
      fs.rm(path.join(tempRoot, OUTPUT_DIR, 'relationship_company_property.json')).catch(() => {}),
      fs.rm(path.join(tempRoot, OUTPUT_DIR, 'relationship_property_communication.json')).catch(() => {}),
    ]);
  } else {
    // Create county data group
    const countyDataGroup = createCountyDataGroup(relationshipFiles);
    const schemaManifest = await fetchSchemaManifest();
    const countySchema = schemaManifest['County']!.ipfsCid;
    await fs.writeFile(
      path.join(tempRoot, OUTPUT_DIR, `${countySchema}.json`),
      JSON.stringify(countyDataGroup),
      'utf-8'
    );
    logger.info('Created County data group');
  }
  
  return hasPropertyImprovementData;
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
  // Also surface any CSVs to CWD so scripts can read them
  try {
    const entries = await fs.readdir(inputsDir, { withFileTypes: true });
    for (const e of entries) {
      if (e.isFile() && /\.csv$/i.test(e.name)) {
        await fs.copyFile(path.join(inputsDir, e.name), path.join(tempRoot, e.name));
      }
    }
  } catch {}

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
