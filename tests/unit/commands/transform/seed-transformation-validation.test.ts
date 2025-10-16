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

    // New schema: address.json with unnormalized format (oneOf Option 1)
    // Now requires: source_http_request, request_identifier, county_name, unnormalized_address
    expect(address).toHaveProperty('unnormalized_address');
    expect(address).toHaveProperty('source_http_request');
    expect(address).toHaveProperty('request_identifier');
    expect(address).toHaveProperty('county_name');
    
    // Verify values
    expect(address.source_http_request).toHaveProperty('method', 'GET');
    expect(address.source_http_request.multiValueQueryString).toEqual({
      folioNumber: ['01-0200-030-1090'],
    });

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

    // Schema has been deployed to production - validation should now pass
    expect(validationFailed).toBe(false);
    console.log('\n✓ Confirmed: Validation passed successfully');

    console.log('\n✅ All seed transformation files validated successfully!');
    console.log('📊 Summary:');
    console.log('  - Seed data group with address_has_parcel relationship');
    console.log('  - address.json (oneOf Option 1: unnormalized format with 4 fields)');
    console.log('  - parcel.json (without formatted_parcel_identifier)');
    console.log('  - address_has_parcel.json (relationship file)');
    console.log('  - unnormalized_address.json (backward compat)');
    console.log('  - property_seed.json (backward compat)');
  });

  it('should transform seed CSV with structured address fields (oneOf Option 2)', async () => {
    // Create seed CSV with broken-down address fields
    // This tests the structured address format (oneOf Option 2)
    const multiValueQueryString = JSON.stringify({
      folioNumber: ['01-0200-030-1090'],
    });

    const seedCsv = [
      'parcel_id,street_number,street_name,city_name,state_code,postal_code,method,url,multiValueQueryString,source_identifier,county',
      `01-0200-030-1090,123,"Main St",MIAMI,FL,33101,GET,https://example.com/property,"${multiValueQueryString.replace(/"/g, '""')}",01-0200-030-1090,miami dade`,
    ].join('\n');

    console.log('Creating seed CSV with structured fields:', seedCsv);

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

    // Read address.json - should still have unnormalized format
    // (even with structured input, we construct unnormalized_address)
    const addressContent = await fs.readFile(
      path.join(dataDir, 'address.json'),
      'utf-8'
    );
    const address = JSON.parse(addressContent);
    console.log('Generated address.json:', JSON.stringify(address, null, 2));

    // address.json should follow oneOf Option 1 (unnormalized format)
    // with all 4 required fields
    expect(address).toHaveProperty('unnormalized_address');
    expect(address).toHaveProperty('source_http_request');
    expect(address).toHaveProperty('request_identifier');
    expect(address).toHaveProperty('county_name');

    // Verify the unnormalized_address was constructed from structured fields
    expect(address.unnormalized_address).toContain('123');
    expect(address.unnormalized_address).toContain('Main St');
    expect(address.unnormalized_address).toContain('MIAMI');
    expect(address.unnormalized_address).toContain('FL');
    expect(address.unnormalized_address).toContain('33101');

    // Verify county_name is capitalized properly
    expect(address.county_name).toBe('Miami Dade');

    // Verify values
    expect(address.source_http_request).toHaveProperty('method', 'GET');
    expect(address.source_http_request).toHaveProperty(
      'url',
      'https://example.com/property'
    );
    expect(address.request_identifier).toBe('01-0200-030-1090');

    // Read and check parcel.json
    const parcelContent = await fs.readFile(
      path.join(dataDir, 'parcel.json'),
      'utf-8'
    );
    const parcel = JSON.parse(parcelContent);
    console.log('Generated parcel.json:', JSON.stringify(parcel, null, 2));

    expect(parcel).toHaveProperty('parcel_identifier', '01-0200-030-1090');
    expect(parcel).toHaveProperty('source_http_request');

    console.log('\n✅ Seed transformation with structured input completed!');
    console.log(
      '📝 Verified that structured input fields are converted to unnormalized_address'
    );

    // Run validation on the transformed data using CLI command
    console.log(
      '\n--- Running CLI validation command on transformed output ---\n'
    );

    const validateCommand = `node dist/index.js validate "${outputZip}"`;
    console.log(`Executing: ${validateCommand}\n`);

    let validationFailed = false;
    try {
      const output = execSync(validateCommand, {
        cwd: process.cwd(),
        encoding: 'utf-8',
        stdio: 'pipe',
      });
      console.log('Validation output:');
      console.log(output);
      console.log('\n✅ Validation passed unexpectedly!');
    } catch (error: any) {
      validationFailed = true;
      console.log('❌ Validation command failed (as expected)');
      console.log('\nValidation stdout:');
      console.log(error.stdout || '(no stdout)');
      if (error.stderr) {
        console.log('\nValidation stderr:');
        console.log(error.stderr);
      }
    }

    // Schema has been deployed to production - validation should now pass
    expect(validationFailed).toBe(false);
    console.log('\n✓ Confirmed: Validation passed successfully');
    console.log(
      '✅ Seed with structured address fields validated successfully!'
    );
  });
});
