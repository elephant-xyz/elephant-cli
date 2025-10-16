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

  /**
   * Extract output ZIP and return the data directory path
   */
  async function extractOutputZip(
    zipPath: string,
    baseDir: string
  ): Promise<string> {
    const extractDir = path.join(baseDir, 'extracted');
    await fs.mkdir(extractDir);
    const zipFile = new AdmZip(zipPath);
    zipFile.extractAllTo(extractDir, true);
    return path.join(extractDir, 'data');
  }

  /**
   * Find the Seed data group file by parsing all JSON files and checking for label: 'Seed'
   */
  async function findSeedDataGroupFile(
    dataDir: string,
    files: string[]
  ): Promise<{ filename: string; content: any }> {
    for (const file of files) {
      if (!file.endsWith('.json')) continue;

      try {
        const content = await fs.readFile(path.join(dataDir, file), 'utf-8');
        const parsed = JSON.parse(content);

        if (parsed.label === 'Seed') {
          return { filename: file, content: parsed };
        }
      } catch {
        // Skip files that aren't valid JSON or can't be read
        continue;
      }
    }

    throw new Error('Seed data group file not found');
  }

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
    const dataDir = await extractOutputZip(outputZip, tempDir);
    const files = await fs.readdir(dataDir);

    // Check for expected files
    expect(files).toContain('address.json');
    expect(files).toContain('parcel.json');
    expect(files).toContain('address_has_parcel.json');
    expect(files).toContain('unnormalized_address.json'); // backward compat
    expect(files).toContain('property_seed.json'); // backward compat

    // Read address.json
    const addressContent = await fs.readFile(
      path.join(dataDir, 'address.json'),
      'utf-8'
    );
    const address = JSON.parse(addressContent);

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

    expect(parcel).toHaveProperty('parcel_identifier', '01-0200-030-1090');
    expect(parcel).toHaveProperty('source_http_request');
    expect(parcel.source_http_request.multiValueQueryString).toEqual({
      folioNumber: ['01-0200-030-1090'],
    });

    // Check the Seed data group file
    const { filename: seedDataGroupFile, content: seedDataGroup } =
      await findSeedDataGroupFile(dataDir, files);
    expect(seedDataGroupFile).toBeDefined();

    // Verify Seed data group structure with relationships wrapper
    expect(seedDataGroup).toHaveProperty('label', 'Seed');
    expect(seedDataGroup).toHaveProperty('relationships');

    // Check new schema relationship
    expect(seedDataGroup.relationships).toHaveProperty('address_has_parcel');
    expect(seedDataGroup.relationships.address_has_parcel).toHaveProperty(
      '/',
      './address_has_parcel.json'
    );

    // Run validation on the transformed data using CLI command
    const errorsCsv = path.join(tempDir, 'errors.csv');
    const validateCommand = `node dist/index.js validate "${outputZip}" -o "${errorsCsv}"`;

    let validationFailed = false;

    try {
      execSync(validateCommand, {
        cwd: process.cwd(),
        encoding: 'utf-8',
        stdio: 'pipe',
      });
    } catch (error: any) {
      validationFailed = true;
    }

    // Schema has been deployed to production - validation should now pass
    expect(validationFailed).toBe(false);
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
    const dataDir = await extractOutputZip(outputZip, tempDir);
    const files = await fs.readdir(dataDir);

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

    // Verify county_name is capitalized (required by schema enum)
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

    expect(parcel).toHaveProperty('parcel_identifier', '01-0200-030-1090');
    expect(parcel).toHaveProperty('source_http_request');

    // Run validation on the transformed data using CLI command
    const validateCommand = `node dist/index.js validate "${outputZip}"`;

    let validationFailed = false;
    try {
      execSync(validateCommand, {
        cwd: process.cwd(),
        encoding: 'utf-8',
        stdio: 'pipe',
      });
    } catch (error: any) {
      validationFailed = true;
    }

    // Schema has been deployed to production - validation should now pass
    expect(validationFailed).toBe(false);
  });
});
