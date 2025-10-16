import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import AdmZip from 'adm-zip';
import { handleTransform } from '../../../../src/commands/transform/index.js';

// Mock the schema fetcher to avoid network dependencies in tests
vi.mock('../../../../src/utils/schema-fetcher.js', () => ({
  fetchSchemaManifest: vi.fn().mockResolvedValue({
    Seed: {
      ipfsCid: 'bafkreicuufahbh5slf5ia67ii3cxuk7hzjmypcfpezcngff4mcv5bn2bi4',
      description: 'Seed data group schema',
    },
    County: {
      ipfsCid: 'bafkreiexamplecounty',
      description: 'County data group schema',
    },
  }),
}));

describe('Seed Transformation with Coordinates', () => {
  let tempDir: string;
  let inputZip: string;
  let outputZip: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'seed-coords-'));
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

  it('should include longitude and latitude in address.json when provided in seed CSV', async () => {
    const multiValueQueryString = JSON.stringify({
      folioNumber: ['01-0200-030-1090'],
    });

    const seedCsv = [
      'parcel_id,address,method,url,multiValueQueryString,source_identifier,county,longitude,latitude',
      `01-0200-030-1090,"123 Main St Miami FL 33101",GET,https://example.com/property,"${multiValueQueryString.replace(/"/g, '""')}",01-0200-030-1090,miami dade,-80.1918,25.7617`,
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

    // Extract and check address.json
    const extractDir = path.join(tempDir, 'extracted');
    await fs.mkdir(extractDir);
    const outputZipFile = new AdmZip(outputZip);
    outputZipFile.extractAllTo(extractDir, true);

    const addressContent = await fs.readFile(
      path.join(extractDir, 'data', 'address.json'),
      'utf-8'
    );
    const address = JSON.parse(addressContent);

    // Verify required fields
    expect(address).toHaveProperty('unnormalized_address');
    expect(address).toHaveProperty('source_http_request');
    expect(address).toHaveProperty('request_identifier');
    expect(address).toHaveProperty('county_name');

    // Verify optional coordinate fields are included
    expect(address).toHaveProperty('longitude');
    expect(address).toHaveProperty('latitude');
    expect(address.longitude).toBe(-80.1918);
    expect(address.latitude).toBe(25.7617);

    // Check backward compatibility file also has coordinates
    const unnormalizedAddressContent = await fs.readFile(
      path.join(extractDir, 'data', 'unnormalized_address.json'),
      'utf-8'
    );
    const unnormalizedAddress = JSON.parse(unnormalizedAddressContent);

    // Verify backward compatibility file has coordinates
    expect(unnormalizedAddress).toHaveProperty('longitude');
    expect(unnormalizedAddress).toHaveProperty('latitude');
    expect(unnormalizedAddress.longitude).toBe(-80.1918);
    expect(unnormalizedAddress.latitude).toBe(25.7617);

    // Verify it has old schema fields
    expect(unnormalizedAddress).toHaveProperty('full_address');
    expect(unnormalizedAddress).toHaveProperty('county_jurisdiction');
  });

  it('should NOT include longitude and latitude when not provided in seed CSV', async () => {
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

    // Extract and check address.json
    const extractDir = path.join(tempDir, 'extracted');
    await fs.mkdir(extractDir);
    const outputZipFile = new AdmZip(outputZip);
    outputZipFile.extractAllTo(extractDir, true);

    const addressContent = await fs.readFile(
      path.join(extractDir, 'data', 'address.json'),
      'utf-8'
    );
    const address = JSON.parse(addressContent);

    // Verify required fields are present
    expect(address).toHaveProperty('unnormalized_address');
    expect(address).toHaveProperty('source_http_request');
    expect(address).toHaveProperty('request_identifier');
    expect(address).toHaveProperty('county_name');

    // Verify optional coordinate fields are NOT included
    expect(address).not.toHaveProperty('longitude');
    expect(address).not.toHaveProperty('latitude');

    // Check backward compatibility file also doesn't have coordinates
    const unnormalizedAddressContent = await fs.readFile(
      path.join(extractDir, 'data', 'unnormalized_address.json'),
      'utf-8'
    );
    const unnormalizedAddress = JSON.parse(unnormalizedAddressContent);

    // Verify backward compatibility file doesn't have coordinates
    expect(unnormalizedAddress).not.toHaveProperty('longitude');
    expect(unnormalizedAddress).not.toHaveProperty('latitude');

    // But it should still have old schema fields
    expect(unnormalizedAddress).toHaveProperty('full_address');
    expect(unnormalizedAddress).toHaveProperty('county_jurisdiction');
  });
});
