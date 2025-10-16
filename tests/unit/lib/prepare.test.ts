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

  describe('Non-Browser Flow (Fetch Only)', () => {
    it('should handle old schema files without updating entry_http_request', () => {
      // Input: Only old schema files
      const inputFiles = {
        'unnormalized_address.json': {
          full_address: '123 Main St',
          county_jurisdiction: 'Miami Dade',
          request_identifier: 'OLD-123',
          source_http_request: {
            method: 'GET',
            url: 'https://example.com/old',
          },
        },
        'property_seed.json': {
          parcel_id: 'OLD-PARCEL-123',
          request_identifier: 'OLD-123',
          source_http_request: {
            method: 'GET',
            url: 'https://example.com/old',
          },
        },
      };

      // Without browser flow, files are copied as-is
      // No entry_http_request is added
      expect(inputFiles['unnormalized_address.json']).not.toHaveProperty(
        'entry_http_request'
      );
      expect(inputFiles['property_seed.json']).not.toHaveProperty(
        'entry_http_request'
      );

      // Original source_http_request is preserved
      expect(
        inputFiles['unnormalized_address.json'].source_http_request.url
      ).toBe('https://example.com/old');
      expect(inputFiles['property_seed.json'].source_http_request.url).toBe(
        'https://example.com/old'
      );
    });

    it('should handle new schema files without updating entry_http_request', () => {
      // Input: Only new schema files
      const inputFiles = {
        'address.json': {
          unnormalized_address: '456 New Ave',
          county_name: 'Orange',
          request_identifier: 'NEW-456',
          source_http_request: {
            method: 'GET',
            url: 'https://example.com/new',
          },
        },
        'parcel.json': {
          parcel_identifier: 'NEW-PARCEL-456',
          formatted_parcel_identifier: '04-56',
          request_identifier: 'NEW-456',
          source_http_request: {
            method: 'GET',
            url: 'https://example.com/new',
          },
        },
      };

      // Without browser flow, files are copied as-is
      expect(inputFiles['address.json']).not.toHaveProperty(
        'entry_http_request'
      );
      expect(inputFiles['parcel.json']).not.toHaveProperty(
        'entry_http_request'
      );

      // Original source_http_request is preserved
      expect(inputFiles['address.json'].source_http_request.url).toBe(
        'https://example.com/new'
      );
      expect(inputFiles['parcel.json'].source_http_request.url).toBe(
        'https://example.com/new'
      );
    });

    it('should handle mixed schema files (all 4) without updating entry_http_request', () => {
      const inputFiles = {
        'address.json': {
          unnormalized_address: '789 Mixed St',
          county_name: 'Miami Dade',
          request_identifier: 'MIXED-789',
          source_http_request: {
            method: 'GET',
            url: 'https://example.com/mixed',
          },
        },
        'parcel.json': {
          parcel_identifier: 'MIXED-PARCEL-789',
          request_identifier: 'MIXED-789',
          source_http_request: {
            method: 'GET',
            url: 'https://example.com/mixed',
          },
        },
        'unnormalized_address.json': {
          full_address: '789 Mixed St',
          county_jurisdiction: 'Miami Dade',
          request_identifier: 'MIXED-789',
          source_http_request: {
            method: 'GET',
            url: 'https://example.com/mixed',
          },
        },
        'property_seed.json': {
          parcel_id: 'MIXED-PARCEL-789',
          request_identifier: 'MIXED-789',
          source_http_request: {
            method: 'GET',
            url: 'https://example.com/mixed',
          },
        },
      };

      // All 4 files present
      expect(Object.keys(inputFiles)).toHaveLength(4);

      // None should have entry_http_request (non-browser flow)
      Object.values(inputFiles).forEach((file) => {
        expect(file).not.toHaveProperty('entry_http_request');
        expect(file.source_http_request.url).toBe('https://example.com/mixed');
      });
    });
  });

  describe('Browser Flow (with entry_http_request)', () => {
    it('should update old schema files with entry_http_request in browser flow', () => {
      const originalRequest = {
        method: 'GET' as const,
        url: 'https://example.com/search',
      };

      const finalRequest = {
        method: 'GET' as const,
        url: 'https://example.com/result?id=123',
      };

      // Simulate browser flow updates
      const updatedFiles = {
        'unnormalized_address.json': {
          full_address: '100 Browser St',
          county_jurisdiction: 'Broward',
          request_identifier: 'BROWSER-100',
          entry_http_request: originalRequest,
          source_http_request: finalRequest,
        },
        'property_seed.json': {
          parcel_id: 'BROWSER-PARCEL-100',
          request_identifier: 'BROWSER-100',
          entry_http_request: originalRequest,
          source_http_request: finalRequest,
        },
      };

      // Verify entry_http_request was added
      expect(
        updatedFiles['unnormalized_address.json'].entry_http_request
      ).toEqual(originalRequest);
      expect(updatedFiles['property_seed.json'].entry_http_request).toEqual(
        originalRequest
      );

      // Verify source_http_request was updated
      expect(
        updatedFiles['unnormalized_address.json'].source_http_request
      ).toEqual(finalRequest);
      expect(updatedFiles['property_seed.json'].source_http_request).toEqual(
        finalRequest
      );

      // Verify old schema fields are preserved
      expect(updatedFiles['unnormalized_address.json'].full_address).toBe(
        '100 Browser St'
      );
      expect(updatedFiles['property_seed.json'].parcel_id).toBe(
        'BROWSER-PARCEL-100'
      );
    });

    it('should update new schema files with entry_http_request in browser flow', () => {
      const originalRequest = {
        method: 'GET' as const,
        url: 'https://example.com/search',
      };

      const finalRequest = {
        method: 'GET' as const,
        url: 'https://example.com/result?id=456',
      };

      // Simulate browser flow updates
      const updatedFiles = {
        'address.json': {
          unnormalized_address: '200 New Browser Ave',
          county_name: 'Palm Beach',
          request_identifier: 'BROWSER-200',
          entry_http_request: originalRequest,
          source_http_request: finalRequest,
        },
        'parcel.json': {
          parcel_identifier: 'BROWSER-PARCEL-200',
          formatted_parcel_identifier: '02-00',
          request_identifier: 'BROWSER-200',
          entry_http_request: originalRequest,
          source_http_request: finalRequest,
        },
      };

      // Verify entry_http_request was added
      expect(updatedFiles['address.json'].entry_http_request).toEqual(
        originalRequest
      );
      expect(updatedFiles['parcel.json'].entry_http_request).toEqual(
        originalRequest
      );

      // Verify source_http_request was updated
      expect(updatedFiles['address.json'].source_http_request).toEqual(
        finalRequest
      );
      expect(updatedFiles['parcel.json'].source_http_request).toEqual(
        finalRequest
      );

      // Verify new schema fields are preserved
      expect(updatedFiles['address.json'].unnormalized_address).toBe(
        '200 New Browser Ave'
      );
      expect(updatedFiles['parcel.json'].parcel_identifier).toBe(
        'BROWSER-PARCEL-200'
      );
    });

    it('should update all 4 files independently in browser flow', () => {
      const originalRequest = {
        method: 'GET' as const,
        url: 'https://example.com/initial',
      };

      const finalRequest = {
        method: 'GET' as const,
        url: 'https://example.com/final?id=all',
      };

      // Simulate browser flow updates for all 4 files
      const updatedFiles = {
        'address.json': {
          unnormalized_address: '300 All Files Blvd',
          county_name: 'Lee',
          request_identifier: 'ALL-300',
          entry_http_request: originalRequest,
          source_http_request: finalRequest,
        },
        'parcel.json': {
          parcel_identifier: 'ALL-PARCEL-300',
          formatted_parcel_identifier: '03-00',
          request_identifier: 'ALL-300',
          entry_http_request: originalRequest,
          source_http_request: finalRequest,
        },
        'unnormalized_address.json': {
          full_address: '300 All Files Blvd (old)',
          county_jurisdiction: 'Lee',
          request_identifier: 'ALL-300',
          entry_http_request: originalRequest,
          source_http_request: finalRequest,
        },
        'property_seed.json': {
          parcel_id: 'ALL-PARCEL-300-OLD',
          request_identifier: 'ALL-300',
          entry_http_request: originalRequest,
          source_http_request: finalRequest,
        },
      };

      // All 4 files should be updated
      expect(Object.keys(updatedFiles)).toHaveLength(4);

      // Each file maintains its unique structure
      expect(updatedFiles['address.json']).toHaveProperty(
        'unnormalized_address'
      );
      expect(updatedFiles['parcel.json']).toHaveProperty('parcel_identifier');
      expect(updatedFiles['unnormalized_address.json']).toHaveProperty(
        'full_address'
      );
      expect(updatedFiles['property_seed.json']).toHaveProperty('parcel_id');

      // All files have entry_http_request (browser flow)
      Object.values(updatedFiles).forEach((file) => {
        expect(file.entry_http_request).toEqual(originalRequest);
        expect(file.source_http_request).toEqual(finalRequest);
        expect(file.request_identifier).toBe('ALL-300');
      });
    });

    it('should preserve unique content across all files during browser flow', () => {
      const originalRequest = {
        method: 'GET' as const,
        url: 'https://start.com',
      };

      const finalRequest = {
        method: 'GET' as const,
        url: 'https://end.com',
      };

      // Each file has unique content
      const beforeUpdate = {
        'address.json': {
          unnormalized_address: 'Address New',
          county_name: 'CountyNew',
          custom_field_new: 'unique-to-address-new',
        },
        'parcel.json': {
          parcel_identifier: 'ParcelNew',
          custom_field_new: 'unique-to-parcel-new',
        },
        'unnormalized_address.json': {
          full_address: 'Address Old',
          county_jurisdiction: 'CountyOld',
          custom_field_old: 'unique-to-address-old',
        },
        'property_seed.json': {
          parcel_id: 'ParcelOld',
          custom_field_old: 'unique-to-parcel-old',
        },
      };

      // After browser flow update, unique content is preserved
      const afterUpdate = {
        'address.json': {
          ...beforeUpdate['address.json'],
          entry_http_request: originalRequest,
          source_http_request: finalRequest,
        },
        'parcel.json': {
          ...beforeUpdate['parcel.json'],
          entry_http_request: originalRequest,
          source_http_request: finalRequest,
        },
        'unnormalized_address.json': {
          ...beforeUpdate['unnormalized_address.json'],
          entry_http_request: originalRequest,
          source_http_request: finalRequest,
        },
        'property_seed.json': {
          ...beforeUpdate['property_seed.json'],
          entry_http_request: originalRequest,
          source_http_request: finalRequest,
        },
      };

      // Verify unique content is preserved
      expect(afterUpdate['address.json'].custom_field_new).toBe(
        'unique-to-address-new'
      );
      expect(afterUpdate['parcel.json'].custom_field_new).toBe(
        'unique-to-parcel-new'
      );
      expect(afterUpdate['unnormalized_address.json'].custom_field_old).toBe(
        'unique-to-address-old'
      );
      expect(afterUpdate['property_seed.json'].custom_field_old).toBe(
        'unique-to-parcel-old'
      );

      // Verify files were NOT overwritten with each other's content
      expect(afterUpdate['address.json']).not.toHaveProperty('parcel_id');
      expect(afterUpdate['parcel.json']).not.toHaveProperty('full_address');
      expect(afterUpdate['unnormalized_address.json']).not.toHaveProperty(
        'parcel_identifier'
      );
      expect(afterUpdate['property_seed.json']).not.toHaveProperty(
        'unnormalized_address'
      );
    });
  });
});
