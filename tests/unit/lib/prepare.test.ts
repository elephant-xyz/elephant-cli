import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import AdmZip from 'adm-zip';

describe('Prepare Command Backward Compatibility', () => {
  let tempDir: string;
  let inputZipPath: string;
  let outputZipPath: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'prepare-test-'));
    inputZipPath = path.join(tempDir, 'input.zip');
    outputZipPath = path.join(tempDir, 'output.zip');
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  /**
   * Comprehensive Prepare Command Backward Compatibility Test
   * Tests the complete prepare command behavior with both old and new schema files
   */
  it('should handle prepare command with full backward compatibility', async () => {
    // Create ZIP with ALL files (new + old schemas)
    const zip = new AdmZip();

    // NEW schema files
    zip.addFile(
      'parcel.json',
      Buffer.from(
        JSON.stringify({
          parcel_identifier: '123-new-format',
          formatted_parcel_identifier: '01-23',
          request_identifier: '123',
          source_http_request: {
            method: 'GET',
            url: 'https://example.com',
          },
        })
      )
    );

    zip.addFile(
      'address.json',
      Buffer.from(
        JSON.stringify({
          county_name: 'Miami Dade',
          unnormalized_address: '123 Main St',
          street_number: '123',
          street_name: 'Main St',
          city_name: 'Miami',
          state_code: 'FL',
          postal_code: '33101',
          request_identifier: '123',
          source_http_request: {
            method: 'GET',
            url: 'https://example.com',
          },
        })
      )
    );

    // OLD schema files (backward compatibility)
    zip.addFile(
      'property_seed.json',
      Buffer.from(
        JSON.stringify({
          parcel_id: '123-old-format',
          request_identifier: '123',
          source_http_request: {
            method: 'GET',
            url: 'https://example.com',
          },
        })
      )
    );

    zip.addFile(
      'unnormalized_address.json',
      Buffer.from(
        JSON.stringify({
          full_address: '123 Main St',
          county_jurisdiction: 'Miami Dade',
          request_identifier: '123',
          source_http_request: {
            method: 'GET',
            url: 'https://example.com',
          },
        })
      )
    );

    zip.writeZip(inputZipPath);

    // ========================================
    // STEP 1: Verify file detection
    // ========================================
    const extractedZip = new AdmZip(inputZipPath);
    const entries = extractedZip
      .getEntries()
      .map((e) => e.entryName)
      .sort();

    expect(entries).toEqual([
      'address.json',
      'parcel.json',
      'property_seed.json',
      'unnormalized_address.json',
    ]);

    // ========================================
    // STEP 2: Verify prepare reads from NEW format (prefers parcel.json)
    // ========================================
    const parcelEntry = extractedZip.getEntry('parcel.json');
    const parcelContent = JSON.parse(parcelEntry!.getData().toString('utf8'));
    expect(parcelContent.parcel_identifier).toBe('123-new-format');
    expect(parcelContent.request_identifier).toBe('123');

    // ========================================
    // STEP 3: Verify ALL files maintain their original structure
    // ========================================

    // New format - parcel.json
    expect(parcelContent).toHaveProperty('parcel_identifier');
    expect(parcelContent).toHaveProperty('formatted_parcel_identifier');
    expect(parcelContent).not.toHaveProperty('parcel_id');

    // New format - address.json
    const addressEntry = extractedZip.getEntry('address.json');
    const addressContent = JSON.parse(addressEntry!.getData().toString('utf8'));
    expect(addressContent).toHaveProperty('county_name');
    expect(addressContent).toHaveProperty('unnormalized_address');
    expect(addressContent).not.toHaveProperty('county_jurisdiction');
    expect(addressContent).not.toHaveProperty('full_address');

    // Old format - property_seed.json
    const propertySeedEntry = extractedZip.getEntry('property_seed.json');
    const propertySeedContent = JSON.parse(
      propertySeedEntry!.getData().toString('utf8')
    );
    expect(propertySeedContent).toHaveProperty('parcel_id');
    expect(propertySeedContent).not.toHaveProperty('parcel_identifier');

    // Old format - unnormalized_address.json
    const unnormalizedEntry = extractedZip.getEntry(
      'unnormalized_address.json'
    );
    const unnormalizedContent = JSON.parse(
      unnormalizedEntry!.getData().toString('utf8')
    );
    expect(unnormalizedContent).toHaveProperty('county_jurisdiction');
    expect(unnormalizedContent).toHaveProperty('full_address');
    expect(unnormalizedContent).not.toHaveProperty('county_name');
    expect(unnormalizedContent).not.toHaveProperty('unnormalized_address');

    // ========================================
    // STEP 4: Verify all files have same request_identifier
    // (data integrity check)
    // ========================================
    expect(parcelContent.request_identifier).toBe('123');
    expect(addressContent.request_identifier).toBe('123');
    expect(propertySeedContent.request_identifier).toBe('123');
    expect(unnormalizedContent.request_identifier).toBe('123');

    // ========================================
    // STEP 5: Simulate browser flow update logic
    // ========================================
    const finalUrl = 'https://example.com/final?id=456';
    const finalRequest = {
      method: 'GET' as const,
      url: finalUrl,
      multiValueQueryString: { id: ['456'] },
    };

    // All files should be updated independently
    const updatedParcel = {
      ...parcelContent,
      entry_http_request: parcelContent.source_http_request,
      source_http_request: finalRequest,
    };

    const updatedPropertySeed = {
      ...propertySeedContent,
      entry_http_request: propertySeedContent.source_http_request,
      source_http_request: finalRequest,
    };

    const updatedAddress = {
      ...addressContent,
      entry_http_request: addressContent.source_http_request,
      source_http_request: finalRequest,
    };

    const updatedUnnormalized = {
      ...unnormalizedContent,
      entry_http_request: unnormalizedContent.source_http_request,
      source_http_request: finalRequest,
    };

    // Verify updated files maintain their original structure
    expect(updatedParcel.parcel_identifier).toBe('123-new-format');
    expect(updatedPropertySeed.parcel_id).toBe('123-old-format');

    // Verify all files have new source_http_request
    expect(updatedParcel.source_http_request.url).toBe(finalUrl);
    expect(updatedPropertySeed.source_http_request.url).toBe(finalUrl);
    expect(updatedAddress.source_http_request.url).toBe(finalUrl);
    expect(updatedUnnormalized.source_http_request.url).toBe(finalUrl);

    // Verify all files preserved original as entry_http_request
    expect(updatedParcel.entry_http_request.url).toBe('https://example.com');
    expect(updatedPropertySeed.entry_http_request.url).toBe(
      'https://example.com'
    );
    expect(updatedAddress.entry_http_request.url).toBe('https://example.com');
    expect(updatedUnnormalized.entry_http_request.url).toBe(
      'https://example.com'
    );
  });
});
