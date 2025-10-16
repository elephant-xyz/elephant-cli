import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import AdmZip from 'adm-zip';
import { handleTransform } from '../../../../src/commands/transform/index.js';
import { execSync } from 'child_process';

describe('Seed Transformation and Validation', () => {
  let tempDir: string;
  let inputZip: string;
  let outputZip: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'seed-simple-'));
    inputZip = path.join(tempDir, 'input.zip');
    outputZip = path.join(tempDir, 'output.zip');
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('should transform seed CSV to valid JSON files', async () => {
    // Create seed CSV with proper JSON format for multiValueQueryString
    // multiValueQueryString must be JSON: {"key":["value"]}
    const multiValueQueryString = JSON.stringify({
      folioNumber: ['01-0200-030-1090'],
    });

    const seedCsv = [
      'parcel_id,address,method,url,multiValueQueryString,source_identifier,county',
      `01-0200-030-1090,"123 Main St Miami FL 33101",GET,https://example.com/property,"${multiValueQueryString.replace(/"/g, '""')}",01-0200-030-1090,miami dade`,
    ].join('\n');

    console.log('Creating seed CSV:', seedCsv);

    // Create ZIP with seed.csv
    const zip = new AdmZip();
    zip.addFile('seed.csv', Buffer.from(seedCsv));
    zip.writeZip(inputZip);

    // Transform
    await handleTransform({
      inputZip,
      outputZip,
      silent: true,
    });

    // Verify output exists
    expect(await fs.stat(outputZip)).toBeDefined();

    // Extract and check contents
    const extractDir = path.join(tempDir, 'extracted');
    await fs.mkdir(extractDir);
    const outputZipFile = new AdmZip(outputZip);
    outputZipFile.extractAllTo(extractDir, true);

    const dataDir = path.join(extractDir, 'data');
    const files = await fs.readdir(dataDir);

    console.log('Generated files:', files);

    // Check for expected files
    expect(files).toContain('address.json');
    expect(files).toContain('parcel.json');
    expect(files).toContain('address_has_parcel.json');
    expect(files).toContain('unnormalized_address.json'); // backward compat
    expect(files).toContain('property_seed.json'); // backward compat

    // Read and log address.json (NEW SCHEMA: oneOf - only unnormalized_address)
    const addressContent = await fs.readFile(
      path.join(dataDir, 'address.json'),
      'utf-8'
    );
    const address = JSON.parse(addressContent);
    console.log('Generated address.json:', JSON.stringify(address, null, 2));

    // New schema: address.json should ONLY have unnormalized_address (oneOf Option 1)
    expect(address).toHaveProperty('unnormalized_address');
    expect(address.unnormalized_address).toBe('123 Main St Miami FL 33101');
    // Should NOT have other structured fields in new schema
    expect(address).not.toHaveProperty('county_name');
    expect(address).not.toHaveProperty('source_http_request');

    // Read and check parcel.json
    const parcelContent = await fs.readFile(
      path.join(dataDir, 'parcel.json'),
      'utf-8'
    );
    const parcel = JSON.parse(parcelContent);
    console.log('Generated parcel.json:', JSON.stringify(parcel, null, 2));

    expect(parcel).toHaveProperty('parcel_identifier', '01-0200-030-1090');
    expect(parcel).toHaveProperty('source_http_request');
    expect(parcel.source_http_request.multiValueQueryString).toEqual({
      folioNumber: ['01-0200-030-1090'],
    });

    // Check the Seed data group file
    const seedDataGroupFile = files.find(
      (f) => f.startsWith('bafkrei') && f.endsWith('.json')
    );
    expect(seedDataGroupFile).toBeDefined();

    const seedDataGroupContent = await fs.readFile(
      path.join(dataDir, seedDataGroupFile!),
      'utf-8'
    );
    const seedDataGroup = JSON.parse(seedDataGroupContent);
    console.log(
      'Generated Seed data group:',
      JSON.stringify(seedDataGroup, null, 2)
    );

    // Verify Seed data group structure with relationships wrapper
    expect(seedDataGroup).toHaveProperty('label', 'Seed');
    expect(seedDataGroup).toHaveProperty('relationships');

    // Check new schema relationship
    expect(seedDataGroup.relationships).toHaveProperty('address_has_parcel');
    expect(seedDataGroup.relationships.address_has_parcel).toHaveProperty(
      '/',
      './address_has_parcel.json'
    );

    console.log('\n✅ Seed transformation completed successfully!');
    console.log('📝 Generated files:', files.join(', '));

    // Run validation on the transformed data using CLI command
    console.log(
      '\n--- Running CLI validation command on transformed output ---\n'
    );

    const errorsCsv = path.join(tempDir, 'errors.csv');
    const validateCommand = `node dist/index.js validate "${outputZip}" -o "${errorsCsv}"`;

    console.log(`Executing: ${validateCommand}\n`);

    let validationFailed = false;
    let validationOutput = '';

    try {
      const output = execSync(validateCommand, {
        cwd: process.cwd(),
        encoding: 'utf-8',
        stdio: 'pipe',
      });

      validationOutput = output;
      console.log('Validation output:');
      console.log(output);
      console.log('\n✅ Validation passed unexpectedly!');
    } catch (error: any) {
      validationFailed = true;
      validationOutput = error.stdout || '';

      console.log('❌ Validation command failed (as expected)');
      console.log('\nValidation stdout:');
      console.log(error.stdout || '(no stdout)');
      if (error.stderr) {
        console.log('\nValidation stderr:');
        console.log(error.stderr);
      }
    }

    // Expect validation to pass now that schemas are correct
    expect(validationFailed).toBe(false);
    console.log('\n✓ Confirmed: Validation passed successfully');

    // Validation should have succeeded
    console.log('\n✅ All seed transformation files validated successfully!');
    console.log('📊 Summary:');
    console.log('  - Seed data group with address_has_parcel relationship');
    console.log('  - address.json (oneOf: only unnormalized_address)');
    console.log('  - parcel.json (without formatted_parcel_identifier)');
    console.log('  - address_has_parcel.json (relationship file)');
    console.log('  - unnormalized_address.json (backward compat)');
    console.log('  - property_seed.json (backward compat)');
  });
});
