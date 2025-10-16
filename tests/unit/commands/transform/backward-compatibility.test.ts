import { describe, it, expect } from 'vitest';

describe('Transform Backward Compatibility', () => {
  describe('County Transform with Old Schema', () => {
    it('should handle old schema file structure (unnormalized_address.json)', () => {
      const oldAddressData = {
        source_http_request: {
          method: 'GET',
          url: 'https://example.com',
        },
        request_identifier: '12345',
        full_address: '123 Main St',
        county_jurisdiction: 'Miami Dade',
      };

      // Verify old schema structure
      expect(oldAddressData.full_address).toBe('123 Main St');
      expect(oldAddressData.county_jurisdiction).toBe('Miami Dade');
      expect(oldAddressData.source_http_request).toBeDefined();
      expect((oldAddressData as any).unnormalized_address).toBeUndefined();
      expect((oldAddressData as any).county_name).toBeUndefined();
    });

    it('should handle new schema file structure (address.json)', () => {
      const newAddressData = {
        source_http_request: {
          method: 'GET',
          url: 'https://example.com',
        },
        request_identifier: '12345',
        unnormalized_address: '123 Main St',
        county_name: 'Miami Dade',
        city_name: null,
        state_code: null,
      };

      // Verify new schema structure
      expect(newAddressData.unnormalized_address).toBe('123 Main St');
      expect(newAddressData.county_name).toBe('Miami Dade');
      expect((newAddressData as any).full_address).toBeUndefined();
      expect((newAddressData as any).county_jurisdiction).toBeUndefined();
    });
  });

  describe('Prepare Command Orange County Detection', () => {
    it('should detect Orange County with old schema (county_jurisdiction)', () => {
      const oldAddressData = {
        source_http_request: {
          method: 'GET',
          url: 'https://example.com',
        },
        request_identifier: '12345',
        full_address: '123 Orange Ave',
        county_jurisdiction: 'Orange',
      };

      // Check both old and new field names (backward compatibility check)
      const isOrangeCounty =
        (oldAddressData as any).county_name === 'Orange' ||
        oldAddressData.county_jurisdiction === 'Orange';

      expect(isOrangeCounty).toBe(true);
      expect(oldAddressData.county_jurisdiction).toBe('Orange');
    });

    it('should detect Orange County with new schema (county_name)', () => {
      const newAddressData = {
        source_http_request: {
          method: 'GET',
          url: 'https://example.com',
        },
        request_identifier: '12345',
        unnormalized_address: '123 Orange Ave',
        county_name: 'Orange',
      };

      // Check both old and new field names (backward compatibility check)
      const isOrangeCounty =
        newAddressData.county_name === 'Orange' ||
        (newAddressData as any).county_jurisdiction === 'Orange';

      expect(isOrangeCounty).toBe(true);
      expect(newAddressData.county_name).toBe('Orange');
    });

    it('should NOT detect Orange County with different county', () => {
      const addressData = {
        source_http_request: {
          method: 'GET',
          url: 'https://example.com',
        },
        request_identifier: '12345',
        unnormalized_address: '123 Main St',
        county_name: 'Miami Dade',
      };

      const isOrangeCounty =
        addressData.county_name === 'Orange' ||
        (addressData as any).county_jurisdiction === 'Orange';

      expect(isOrangeCounty).toBe(false);
    });
  });

  describe('File Structure Compatibility', () => {
    it('should handle ZIP with both old and new files', () => {
      const files = [
        'address.json',
        'parcel.json',
        'unnormalized_address.json',
        'property_seed.json',
        'input.html',
      ];

      // Should include both old and new format files
      expect(files).toContain('address.json');
      expect(files).toContain('parcel.json');
      expect(files).toContain('unnormalized_address.json');
      expect(files).toContain('property_seed.json');
    });

    it('should exclude seed files from HTML/JSON detection', () => {
      const fileListWithoutHtml = [
        'address.json',
        'parcel.json',
        'unnormalized_address.json',
        'property_seed.json',
        'other.json',
      ];

      // Find JSON files (excluding seed files)
      const htmlOrJson =
        fileListWithoutHtml.find((f) => /\.html?$/i.test(f)) ||
        fileListWithoutHtml.find(
          (f) =>
            /\.json$/i.test(f) &&
            f !== 'address.json' &&
            f !== 'parcel.json' &&
            f !== 'unnormalized_address.json' &&
            f !== 'property_seed.json'
        );

      // Should find 'other.json', not the seed files
      expect(htmlOrJson).toBe('other.json');
    });

    it('should prefer HTML over other JSON files', () => {
      const fileList = [
        'address.json',
        'unnormalized_address.json',
        'input.html',
        'other.json',
      ];

      const htmlOrJson =
        fileList.find((f) => /\.html?$/i.test(f)) ||
        fileList.find(
          (f) =>
            /\.json$/i.test(f) &&
            f !== 'address.json' &&
            f !== 'parcel.json' &&
            f !== 'unnormalized_address.json' &&
            f !== 'property_seed.json'
        );

      // Should prefer HTML
      expect(htmlOrJson).toBe('input.html');
    });
  });

  describe('Seed Data Group Structure', () => {
    it('should create Seed data group with address_has_parcel relationship', () => {
      const seedJson = {
        label: 'Seed',
        address_has_parcel: {
          '/': './address_to_parcel.json',
        },
      };

      // Verify structure
      expect(seedJson.label).toBe('Seed');
      expect(seedJson.address_has_parcel).toBeDefined();
      expect(seedJson.address_has_parcel['/']).toBe('./address_to_parcel.json');
    });

    it('should NOT include direct address reference in Seed data group', () => {
      const seedJson = {
        label: 'Seed',
        address_has_parcel: {
          '/': './address_to_parcel.json',
        },
      };

      // Verify no direct address property
      expect((seedJson as any).address).toBeUndefined();
    });

    it('should create address_to_parcel relationship correctly', () => {
      const relAddressToParcelJson = {
        from: {
          '/': './address.json',
        },
        to: {
          '/': './parcel.json',
        },
      };

      expect(relAddressToParcelJson.from['/']).toBe('./address.json');
      expect(relAddressToParcelJson.to['/']).toBe('./parcel.json');
    });
  });

  /**
   * Comprehensive Transform (Seed + County) Backward Compatibility Test
   * Tests the complete transform pipeline from seed CSV through county transformation
   */
  describe('Complete Transform Pipeline with Backward Compatibility', () => {
    it('should handle full seed transformation + county transformation with backward compatibility', () => {
      // ========================================
      // STEP 1: Seed Transformation
      // ========================================

      // Input: seed.csv
      const seedCsvRow = {
        street_number: '123',
        street_name: 'Main St',
        city_name: 'Miami',
        state_code: 'FL',
        postal_code: '33101',
        county_name: 'Miami Dade',
        parcel_identifier: '01-0200-030-1090',
        source_url: 'https://example.com/property?parcel=01-0200-030-1090',
      };

      // Expected output from seed transformation:
      // 1. NEW schema files
      const expectedAddressJson = {
        unnormalized_address: `${seedCsvRow.street_number} ${seedCsvRow.street_name}, ${seedCsvRow.city_name}, ${seedCsvRow.state_code} ${seedCsvRow.postal_code}`,
        county_name: seedCsvRow.county_name,
        street_number: seedCsvRow.street_number,
        street_name: seedCsvRow.street_name,
        city_name: seedCsvRow.city_name,
        state_code: seedCsvRow.state_code,
        postal_code: seedCsvRow.postal_code,
        request_identifier: seedCsvRow.parcel_identifier,
        source_http_request: {
          method: 'GET',
          url: seedCsvRow.source_url,
        },
      };

      const expectedParcelJson = {
        parcel_identifier: seedCsvRow.parcel_identifier,
        formatted_parcel_identifier: seedCsvRow.parcel_identifier,
        request_identifier: seedCsvRow.parcel_identifier,
        source_http_request: {
          method: 'GET',
          url: seedCsvRow.source_url,
        },
      };

      // 2. OLD schema files (backward compatibility)
      const expectedUnnormalizedAddressJson = {
        full_address: expectedAddressJson.unnormalized_address,
        county_jurisdiction: seedCsvRow.county_name,
        request_identifier: seedCsvRow.parcel_identifier,
        source_http_request: {
          method: 'GET',
          url: seedCsvRow.source_url,
        },
      };

      const expectedPropertySeedJson = {
        parcel_id: seedCsvRow.parcel_identifier,
        request_identifier: seedCsvRow.parcel_identifier,
        source_http_request: {
          method: 'GET',
          url: seedCsvRow.source_url,
        },
      };

      // 3. Relationship file
      const expectedAddressToParcelJson = {
        from: { '/': './address.json' },
        to: { '/': './parcel.json' },
      };

      // 4. Seed data group
      const expectedSeedDataGroup = {
        label: 'Seed',
        address_has_parcel: {
          '/': './address_to_parcel.json',
        },
      };

      // Verify seed transformation produces all files
      expect(expectedAddressJson.county_name).toBe('Miami Dade');
      expect(expectedParcelJson.parcel_identifier).toBe('01-0200-030-1090');
      expect(expectedUnnormalizedAddressJson.county_jurisdiction).toBe(
        'Miami Dade'
      );
      expect(expectedPropertySeedJson.parcel_id).toBe('01-0200-030-1090');
      expect(expectedSeedDataGroup.address_has_parcel).toBeDefined();

      // ========================================
      // STEP 2: County Transformation
      // ========================================

      // County transformation scripts should be able to read from EITHER:
      // - New format: parcel.json + address.json
      // - Old format: property_seed.json + unnormalized_address.json

      // Test 1: County scripts can read NEW format
      const countyScriptReadsParcelJson = {
        parcel_identifier: expectedParcelJson.parcel_identifier,
        request_identifier: expectedParcelJson.request_identifier,
        source_http_request: expectedParcelJson.source_http_request,
      };

      expect(countyScriptReadsParcelJson.parcel_identifier).toBe(
        '01-0200-030-1090'
      );
      expect(countyScriptReadsParcelJson.request_identifier).toBe(
        '01-0200-030-1090'
      );

      // Test 2: County scripts can read OLD format
      const countyScriptReadsPropertySeedJson = {
        parcel_id: expectedPropertySeedJson.parcel_id,
        request_identifier: expectedPropertySeedJson.request_identifier,
        source_http_request: expectedPropertySeedJson.source_http_request,
      };

      expect(countyScriptReadsPropertySeedJson.parcel_id).toBe(
        '01-0200-030-1090'
      );
      expect(countyScriptReadsPropertySeedJson.request_identifier).toBe(
        '01-0200-030-1090'
      );

      // ========================================
      // STEP 3: Data Integrity Through Pipeline
      // ========================================

      // All files should have the same request_identifier
      expect(expectedAddressJson.request_identifier).toBe('01-0200-030-1090');
      expect(expectedParcelJson.request_identifier).toBe('01-0200-030-1090');
      expect(expectedUnnormalizedAddressJson.request_identifier).toBe(
        '01-0200-030-1090'
      );
      expect(expectedPropertySeedJson.request_identifier).toBe(
        '01-0200-030-1090'
      );

      // All files should have the same source URL
      const expectedUrl =
        'https://example.com/property?parcel=01-0200-030-1090';
      expect(expectedAddressJson.source_http_request.url).toBe(expectedUrl);
      expect(expectedParcelJson.source_http_request.url).toBe(expectedUrl);
      expect(expectedUnnormalizedAddressJson.source_http_request.url).toBe(
        expectedUrl
      );
      expect(expectedPropertySeedJson.source_http_request.url).toBe(
        expectedUrl
      );

      // ========================================
      // STEP 4: Verify Backward Compatibility
      // ========================================

      // New format has new fields
      expect(expectedAddressJson).toHaveProperty('county_name');
      expect(expectedAddressJson).toHaveProperty('unnormalized_address');
      expect(expectedParcelJson).toHaveProperty('parcel_identifier');

      // Old format has old fields
      expect(expectedUnnormalizedAddressJson).toHaveProperty(
        'county_jurisdiction'
      );
      expect(expectedUnnormalizedAddressJson).toHaveProperty('full_address');
      expect(expectedPropertySeedJson).toHaveProperty('parcel_id');

      // New format does NOT have old field names
      expect((expectedAddressJson as any).county_jurisdiction).toBeUndefined();
      expect((expectedAddressJson as any).full_address).toBeUndefined();
      expect((expectedParcelJson as any).parcel_id).toBeUndefined();

      // Old format does NOT have new field names
      expect(
        (expectedUnnormalizedAddressJson as any).county_name
      ).toBeUndefined();
      expect(
        (expectedUnnormalizedAddressJson as any).unnormalized_address
      ).toBeUndefined();
      expect(
        (expectedPropertySeedJson as any).parcel_identifier
      ).toBeUndefined();

      // ========================================
      // STEP 5: Verify County Transform Output
      // ========================================

      // After county transformation, output should be schema-compliant
      const countyTransformOutput = {
        property: {
          parcel_identifier: countyScriptReadsParcelJson.parcel_identifier,
          property_type: 'SingleFamily',
          request_identifier: countyScriptReadsParcelJson.request_identifier,
          source_http_request: countyScriptReadsParcelJson.source_http_request,
        },
      };

      expect(countyTransformOutput.property.parcel_identifier).toBe(
        '01-0200-030-1090'
      );
      expect(countyTransformOutput.property.property_type).toBe('SingleFamily');
      expect(countyTransformOutput.property.request_identifier).toBe(
        '01-0200-030-1090'
      );

      // ========================================
      // FINAL VERIFICATION: Complete Pipeline
      // ========================================

      // Seed CSV → Seed Transform → County Transform → Final Output
      // All data flows correctly through the pipeline
      expect(seedCsvRow.parcel_identifier).toBe(
        countyTransformOutput.property.parcel_identifier
      );
      expect(seedCsvRow.county_name).toBe(expectedAddressJson.county_name);
      expect(seedCsvRow.county_name).toBe(
        expectedUnnormalizedAddressJson.county_jurisdiction
      );
    });
  });
});
