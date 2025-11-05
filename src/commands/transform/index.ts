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
import { createPropertyImprovementDataGroup as createPropertyImprovementDataGroupFromModule } from './property-improvement-datagroup.js';
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
  inputZip?: string;
  scriptsZip?: string;
  legacyMode?: boolean;
  silent?: boolean;
  cwd?: string;
  dataGroup?: string;
  [key: string]: any;
}

interface SeedRow {
  parcel_id: string;
  // Either unnormalized address OR broken down fields
  address?: string;
  street_number?: string;
  street_name?: string;
  street_pre_directional?: string;
  street_post_directional?: string;
  street_suffix?: string;
  unit_identifier?: string;
  city_name?: string;
  state_code?: string;
  postal_code?: string;
  plus_four_postal_code?: string;
  country_code?: string;
  // HTTP request fields
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

interface AddressData {
  source_http_request: SourceHttpRequest;
  request_identifier: string;
  county_name: string;
  unnormalized_address: string;
  longitude: number | null;
  latitude: number | null;
}

interface ParcelData {
  source_http_request: SourceHttpRequest;
  request_identifier: string;
  parcel_identifier: string;
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
      'Input ZIP for scripts mode (must include address.json or unnormalized_address.json, parcel.json or property_seed.json, and an HTML/JSON file)'
    )
    .option('--legacy-mode', 'Use legacy mode for transforming data', false)
    .option(
      '--data-group <string>',
      'Specify data group type to create (e.g., "Property Improvement")',
      undefined
    )
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

  // Property Improvement always requires scripts
  if (
    options.dataGroup &&
    (options.dataGroup.toLowerCase() === 'property improvement' ||
      options.dataGroup.toLowerCase() === 'property_improvement')
  ) {
    if (!resolvedScriptsZip) {
      const error = 'Property Improvement data group requires --scripts-zip';
      if (!options.silent) {
        console.error(chalk.red(error));
      }
      if (options.silent) {
        throw new Error(error);
      } else {
        process.exit(1);
      }
    }
  }
  if (!existsSync(resolvedInputZip)) {
    const error = `input-zip not found: ${resolvedInputZip}`;
    console.error(chalk.red(error));
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
    await extractZipToTemp(resolvedInputZip, tempRoot, INPUT_DIR);
    await normalizeInputsForScripts(path.join(tempRoot, INPUT_DIR), tempRoot);

    let isSeedMode = false;
    if (resolvedScriptsZip) {
      logger.info('Extracting scripts to tempdir...');
      const scriptsDir = await extractZipToTemp(
        resolvedScriptsZip,
        tempRoot,
        'scripts'
      );

      // Determine data group type and creation function
      let dataGroupType = 'County';
      let createDataGroupFunction = createCountyDataGroup;

      if (options.dataGroup) {
        const dataGroupLower = options.dataGroup.toLowerCase();
        if (
          dataGroupLower === 'property improvement' ||
          dataGroupLower === 'property_improvement'
        ) {
          dataGroupType = 'Property Improvement';
          // Create a wrapper function that matches the expected signature
          createDataGroupFunction = (_relationshipFiles: readonly string[]) => {
            // For Property Improvement, we'll handle this differently in handleDataGroupTransform
            return { label: 'County', relationships: {} };
          };

          // For Property Improvement, run the extraction script first
          logger.info('Running Property Improvement extraction script...');
          await runScriptsPipeline(scriptsDir, tempRoot, [
            'property-improvement-extractor.js',
          ]);

          // After script runs, copy extracted files from data/ to input/ so they can be processed
          const dataDir = path.join(tempRoot, OUTPUT_DIR);
          const inputDir = path.join(tempRoot, INPUT_DIR);

          try {
            const dataFiles = await fs.readdir(dataDir);
            logger.info(
              `Found ${dataFiles.length} files in data directory: ${dataFiles.join(', ')}`
            );
            for (const file of dataFiles) {
              if (file.endsWith('.json')) {
                await fs.copyFile(
                  path.join(dataDir, file),
                  path.join(inputDir, file)
                );
                logger.info(`Copied ${file} from data/ to input/`);
              }
            }
          } catch (error) {
            logger.error(`Could not copy files from data to input: ${error}`);
          }
        }
      }

      await handleDataGroupTransform(
        scriptsDir,
        tempRoot,
        dataGroupType,
        createDataGroupFunction
      );
    } else {
      logger.info('Processing seed data group...');
      await handleSeedTransform(tempRoot);
      isSeedMode = true;
    }

    if (!isSeedMode) {
      // Only generate fact sheets for County data groups, not Property Improvement
      if (
        !options.dataGroup ||
        options.dataGroup.toLowerCase() !== 'property improvement'
      ) {
        await generateFactSheet(tempRoot);
      }
    }
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

  // New schema relationship: address_has_parcel (address -> parcel)
  const relAddressHasParcel = {
    from: {
      '/': './address.json',
    },
    to: {
      '/': './parcel.json',
    },
  };
  const relAddressHasParcelJson = JSON.stringify(relAddressHasParcel);

  // Seed data group with only address_has_parcel relationship
  // Relationships use IPLD link objects pointing to relationship files
  const seedJson = JSON.stringify({
    label: 'Seed',
    relationships: {
      address_has_parcel: {
        '/': './address_has_parcel.json',
      },
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

  // Validate required fields
  if (!seedRow.county || !seedRow.county.trim()) {
    throw new Error('County field is required in seed.csv and cannot be empty');
  }

  // Construct unnormalized_address from either direct field or broken down fields
  let unnormalizedAddress = '';

  if (seedRow.address) {
    // Use direct address field if provided
    unnormalizedAddress = seedRow.address;
  } else {
    // Construct from broken down fields
    const parts: string[] = [];

    // Street address: [pre-directional] street_number street_name [suffix] [post-directional] [unit]
    if (seedRow.street_pre_directional)
      parts.push(seedRow.street_pre_directional);
    if (seedRow.street_number) parts.push(seedRow.street_number);
    if (seedRow.street_name) parts.push(seedRow.street_name);
    if (seedRow.street_suffix) parts.push(seedRow.street_suffix);
    if (seedRow.street_post_directional)
      parts.push(seedRow.street_post_directional);
    if (seedRow.unit_identifier) parts.push(seedRow.unit_identifier);

    const streetAddress = parts.join(' ');

    // City, State ZIP (format: "City, State ZIP")
    const cityStateZipParts: string[] = [];
    if (seedRow.city_name) cityStateZipParts.push(seedRow.city_name);

    // Combine State and ZIP without comma between them
    const stateZipParts: string[] = [];
    if (seedRow.state_code) stateZipParts.push(seedRow.state_code);
    const zip = seedRow.postal_code
      ? seedRow.plus_four_postal_code
        ? `${seedRow.postal_code}-${seedRow.plus_four_postal_code}`
        : seedRow.postal_code
      : undefined;
    if (zip) stateZipParts.push(zip);

    if (stateZipParts.length > 0) {
      cityStateZipParts.push(stateZipParts.join(' '));
    }

    const cityStateZip = cityStateZipParts.join(', ');

    // Combine street and city/state/zip
    unnormalizedAddress =
      streetAddress && cityStateZip
        ? `${streetAddress}, ${cityStateZip}`
        : streetAddress || cityStateZip || '';
  }

  // New schema: address.json with unnormalized format (oneOf Option 1)
  // Requires: source_http_request, request_identifier, county_name, unnormalized_address, longitude, latitude
  const addressData: AddressData = {
    source_http_request: sourceHttpRequest,
    request_identifier: seedRow.source_identifier,
    county_name: seedRow.county,
    unnormalized_address: unnormalizedAddress,
    longitude:
      seedRow.longitude && seedRow.latitude
        ? parseFloat(seedRow.longitude)
        : null,
    latitude:
      seedRow.longitude && seedRow.latitude
        ? parseFloat(seedRow.latitude)
        : null,
  };

  // New schema: parcel.json with required fields
  const parcelData: ParcelData = {
    source_http_request: sourceHttpRequest,
    request_identifier: seedRow.source_identifier,
    parcel_identifier: seedRow.parcel_id,
  };

  const addressJson = JSON.stringify(addressData);
  const parcelJson = JSON.stringify(parcelData);

  // Create unnormalized_address.json for backward compatibility
  const unnormalizedAddressData: Record<string, unknown> = {
    source_http_request: sourceHttpRequest,
    request_identifier: seedRow.source_identifier,
    full_address: unnormalizedAddress,
    county_jurisdiction: seedRow.county,
  };
  if (seedRow.longitude && seedRow.latitude) {
    unnormalizedAddressData.longitude = parseFloat(seedRow.longitude);
    unnormalizedAddressData.latitude = parseFloat(seedRow.latitude);
  }
  const unnormalizedAddressJson = JSON.stringify(unnormalizedAddressData);

  // Create property_seed.json for backward compatibility
  const propertySeedData: Record<string, unknown> = {
    source_http_request: sourceHttpRequest,
    request_identifier: seedRow.source_identifier,
    parcel_id: seedRow.parcel_id,
  };
  const propertySeedJson = JSON.stringify(propertySeedData);

  await fs.mkdir(path.join(tempRoot, OUTPUT_DIR), { recursive: true });
  const schemaManifest = await fetchSchemaManifest();
  const seedDataGroupCid = schemaManifest['Seed']!.ipfsCid;

  // Check for Property Improvement files in input
  let propertyImprovementFiles: string[] = [];
  try {
    const inputFiles = await fs.readdir(path.join(tempRoot, INPUT_DIR));
    propertyImprovementFiles = inputFiles.filter(
      (file) =>
        file.toLowerCase().includes('property_improvement') &&
        file.endsWith('.json')
    );
  } catch {
    // Input directory might not exist or be accessible
  }

  const fileNameContent: { name: string; content: string }[] = [
    { name: `${seedDataGroupCid}.json`, content: seedJson },
    // New schema files
    { name: 'address_has_parcel.json', content: relAddressHasParcelJson },
    { name: 'address.json', content: addressJson },
    { name: 'parcel.json', content: parcelJson },
    // Backward compatibility files
    { name: 'unnormalized_address.json', content: unnormalizedAddressJson },
    { name: 'property_seed.json', content: propertySeedJson },
  ];

  // Add Property Improvement files if they exist
  for (const file of propertyImprovementFiles) {
    try {
      const content = await fs.readFile(
        path.join(tempRoot, INPUT_DIR, file),
        'utf-8'
      );
      const jsonObj = JSON.parse(content);

      // Add source_http_request and request_identifier if not present
      if (!jsonObj.source_http_request) {
        jsonObj.source_http_request = sourceHttpRequest;
      }
      jsonObj.request_identifier = seedRow.source_identifier;

      fileNameContent.push({
        name: file,
        content: JSON.stringify(jsonObj),
      });
    } catch (error) {
      logger.warn(
        `Failed to process Property Improvement file ${file}: ${error}`
      );
    }
  }
  await Promise.all(
    fileNameContent.map(async (file) => {
      const absPath = path.join(tempRoot, OUTPUT_DIR, file.name);
      await fs.writeFile(absPath, file.content, 'utf-8');
    })
  );
}

async function handleDataGroupTransform(
  scriptsDir: string,
  tempRoot: string,
  dataGroupType: string,
  createDataGroupFunction: (relationshipFiles: readonly string[]) => any
) {
  if (dataGroupType === 'Property Improvement') {
    // For Property Improvement, we already ran the extraction script
    // Just create the data group from existing files
    logger.info(
      'Creating Property Improvement data group from extracted files...'
    );

    // Call the actual Property Improvement data group creation function
    const inputDir = path.join(tempRoot, INPUT_DIR);
    const files = await fs.readdir(inputDir);
    const relationshipFiles = files.filter(
      (file) => file.includes('_has_') && file.endsWith('.json')
    );

    const dataGroup =
      createPropertyImprovementDataGroupFromModule(relationshipFiles);
    const schemaManifestService = new SchemaManifestService();
    await schemaManifestService.loadSchemaManifest();
    const schemaCid =
      schemaManifestService.getDataGroupCidByLabel(dataGroupType);

    if (!schemaCid) {
      throw new Error(`Schema not found for data group type: ${dataGroupType}`);
    }

    // Ensure output directory exists
    const outputDir = path.join(tempRoot, OUTPUT_DIR);
    await fs.mkdir(outputDir, { recursive: true });

    // Copy individual property improvement files to output directory
    const inputFiles = await fs.readdir(inputDir);
    for (const file of inputFiles) {
      if (file.endsWith('.json') && !file.includes('_has_')) {
        await fs.copyFile(
          path.join(inputDir, file),
          path.join(outputDir, file)
        );
      }
    }

    await fs.writeFile(
      path.join(outputDir, `${schemaCid}.json`),
      JSON.stringify(dataGroup),
      'utf-8'
    );

    logger.info('Property Improvement data group created successfully');
    return;
  }

  // For County and other data groups, run the normal scripts pipeline
  logger.info('Running generated scripts pipeline...');
  await runScriptsPipeline(scriptsDir, tempRoot);

  const newJsonRelPaths = await fs.readdir(path.join(tempRoot, OUTPUT_DIR));
  if (newJsonRelPaths.length === 0) {
    logger.warn('No new JSON files detected from scripts execution');
  }

  // Read source_http_request and request_identifier from address file
  // Try address.json first, fallback to unnormalized_address.json for backward compatibility
  let addressFile: string;
  try {
    addressFile = await fs.readFile(
      path.join(tempRoot, 'address.json'),
      'utf-8'
    );
  } catch {
    addressFile = await fs.readFile(
      path.join(tempRoot, 'unnormalized_address.json'),
      'utf-8'
    );
  }
  const addressJson = JSON.parse(addressFile);
  const sourceHttpRequest = addressJson.source_http_request;
  const requestIdentifier = addressJson.request_identifier;

  // Check for seed files - support both new and old formats
  let hasAddressJson = false;
  let hasParcelJson = false;
  let hasUnnormalizedAddressJson = false;
  let hasPropertySeedJson = false;

  try {
    await fs.access(path.join(tempRoot, 'address.json'));
    hasAddressJson = true;
  } catch {
    logger.debug('address.json not found in tempRoot, skipping');
  }

  try {
    await fs.access(path.join(tempRoot, 'parcel.json'));
    hasParcelJson = true;
  } catch {
    logger.debug('parcel.json not found in tempRoot, skipping');
  }

  try {
    await fs.access(path.join(tempRoot, 'unnormalized_address.json'));
    hasUnnormalizedAddressJson = true;
  } catch {
    logger.debug('unnormalized_address.json not found in tempRoot, skipping');
  }

  try {
    await fs.access(path.join(tempRoot, 'property_seed.json'));
    hasPropertySeedJson = true;
  } catch {
    logger.debug('property_seed.json not found in tempRoot, skipping');
  }

  // Copy seed files to output directory so they get processed through the normal loop
  // Only copy address.json if scripts didn't create one
  if (hasAddressJson) {
    const scriptCreatedAddressPath = path.join(
      tempRoot,
      OUTPUT_DIR,
      'address.json'
    );
    if (existsSync(scriptCreatedAddressPath)) {
      logger.debug('Scripts created address.json, skipping copy');
    } else {
      await fs.copyFile(
        path.join(tempRoot, 'address.json'),
        scriptCreatedAddressPath
      );
      logger.debug('Copied address.json to output directory for processing');
    }
  }

  if (hasParcelJson) {
    await fs.copyFile(
      path.join(tempRoot, 'parcel.json'),
      path.join(tempRoot, OUTPUT_DIR, 'parcel.json')
    );
    logger.debug('Copied parcel.json to output directory for processing');
  }

  if (hasUnnormalizedAddressJson) {
    await fs.copyFile(
      path.join(tempRoot, 'unnormalized_address.json'),
      path.join(tempRoot, OUTPUT_DIR, 'unnormalized_address.json')
    );
    logger.debug(
      'Copied unnormalized_address.json to output directory for processing'
    );
  }

  if (hasPropertySeedJson) {
    await fs.copyFile(
      path.join(tempRoot, 'property_seed.json'),
      path.join(tempRoot, OUTPUT_DIR, 'property_seed.json')
    );
    logger.debug(
      'Copied property_seed.json to output directory for processing'
    );
  }

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

      // Only set source_http_request from seed if not present or empty
      if (
        !jsonObj.source_http_request ||
        jsonObj.source_http_request === null ||
        (typeof jsonObj.source_http_request === 'object' &&
          Object.keys(jsonObj.source_http_request).length === 0)
      ) {
        jsonObj.source_http_request = sourceHttpRequest;
      }

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
        // Skip creating person/company to property relationships
        return;
      }
      if (rel.startsWith('structure') || rel.startsWith('utility')) {
        // Skip creating property to structure/utility relationships
        return;
      }
      if (rel.startsWith('mailing_address')) {
        // Skip creating property to mailing_address relationships
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

  // Collect all relationship files created by transformation scripts
  const allOutputFiles = await fs.readdir(path.join(tempRoot, OUTPUT_DIR));
  for (const file of allOutputFiles) {
    if (file.startsWith('relationship_') && file.endsWith('.json')) {
      if (!relationshipFiles.includes(file)) {
        relationshipFiles.push(file);
      }
    }
  }

  const dataGroup = createDataGroupFunction(relationshipFiles);
  const schemaManifestService = new SchemaManifestService();
  await schemaManifestService.loadSchemaManifest();
  const schemaCid = schemaManifestService.getDataGroupCidByLabel(dataGroupType);

  if (!schemaCid) {
    throw new Error(`Schema not found for data group type: ${dataGroupType}`);
  }

  await fs.writeFile(
    path.join(tempRoot, OUTPUT_DIR, `${schemaCid}.json`),
    JSON.stringify(dataGroup),
    'utf-8'
  );
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
  await copyIfExists('address.json');
  await copyIfExists('parcel.json');
  await copyIfExists('unnormalized_address.json');
  await copyIfExists('property_seed.json');

  const entries = await fs.readdir(inputsDir, { withFileTypes: true });
  const files = entries.filter((e) => e.isFile()).map((e) => e.name);
  const htmlOrJson =
    files.find((f) => /\.html?$/i.test(f)) ||
    files.find(
      (f) =>
        /\.json$/i.test(f) &&
        f !== 'address.json' &&
        f !== 'parcel.json' &&
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

  // Copy CSV files to tempRoot so scripts can access them
  const csvFiles = files.filter((f) => /\.csv$/i.test(f));
  for (const csvFile of csvFiles) {
    await fs.copyFile(
      path.join(inputsDir, csvFile),
      path.join(tempRoot, csvFile)
    );
    logger.debug(`Copied CSV file ${csvFile} to tempRoot for script access`);
  }
}
