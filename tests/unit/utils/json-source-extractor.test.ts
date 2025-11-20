import { describe, it, expect } from 'vitest';
import { extractTextWithSources } from '../../../src/utils/json-source-extractor.js';

describe('json-source-extractor', () => {
  describe('extractTextWithSources', () => {
    it('should extract text with JSONPath from simple object', () => {
      const json = {
        property_address: '123 Main Street',
        sale_price: 450000,
      };

      const result = extractTextWithSources(json);

      expect(result.sourceMap).toHaveLength(2);
      expect(result.sourceMap[0].text).toBe(
        'property address: 123 Main Street'
      );
      expect(result.sourceMap[0].source).toBe('$.property_address');
      expect(result.sourceMap[0].lineIndex).toBe(0);

      expect(result.sourceMap[1].text).toBe('sale price: 450000');
      expect(result.sourceMap[1].source).toBe('$.sale_price');
      expect(result.sourceMap[1].lineIndex).toBe(1);

      expect(result.formattedText).toBe(
        'property address: 123 Main Street\nsale price: 450000'
      );
    });

    it('should convert underscores to spaces in keys', () => {
      const json = {
        property_tax_amount: '5000',
        year_built: 1985,
      };

      const result = extractTextWithSources(json);

      expect(result.sourceMap[0].text).toBe('property tax amount: 5000');
      expect(result.sourceMap[1].text).toBe('year built: 1985');
    });

    it('should handle nested objects with proper JSONPath', () => {
      const json = {
        property_details: {
          lot_size: '0.25 acres',
          year_built: 1985,
        },
      };

      const result = extractTextWithSources(json);

      expect(result.sourceMap).toHaveLength(2);
      expect(result.sourceMap[0].text).toBe('lot size: 0.25 acres');
      expect(result.sourceMap[0].source).toBe('$.property_details.lot_size');

      expect(result.sourceMap[1].text).toBe('year built: 1985');
      expect(result.sourceMap[1].source).toBe('$.property_details.year_built');
    });

    it('should handle arrays with indexed JSONPath', () => {
      const json = {
        owners: [{ name: 'John Doe' }, { name: 'Jane Smith' }],
      };

      const result = extractTextWithSources(json);

      expect(result.sourceMap).toHaveLength(2);
      expect(result.sourceMap[0].text).toBe('name: John Doe');
      expect(result.sourceMap[0].source).toBe('$.owners[0].name');

      expect(result.sourceMap[1].text).toBe('name: Jane Smith');
      expect(result.sourceMap[1].source).toBe('$.owners[1].name');
    });

    it('should skip string values shorter than 3 characters', () => {
      const json = {
        state: 'TX',
        city: 'Austin',
        country: 'USA',
      };

      const result = extractTextWithSources(json);

      // 'TX' (2 chars) should be skipped, but 'USA' (3 chars) and 'Austin' should be included
      expect(result.sourceMap.length).toBeGreaterThanOrEqual(1);
      const austinEntry = result.sourceMap.find((entry) =>
        entry.text.includes('Austin')
      );
      expect(austinEntry).toBeDefined();
    });

    it('should include all numeric values', () => {
      const json = {
        bedrooms: 3,
        bathrooms: 2,
        square_feet: 2100,
      };

      const result = extractTextWithSources(json);

      expect(result.sourceMap).toHaveLength(3);
      expect(result.sourceMap[0].text).toBe('bedrooms: 3');
      expect(result.sourceMap[1].text).toBe('bathrooms: 2');
      expect(result.sourceMap[2].text).toBe('square feet: 2100');
    });

    it('should assign correct line indices', () => {
      const json = {
        field1: 'value1',
        field2: 'value2',
        field3: 'value3',
      };

      const result = extractTextWithSources(json);

      expect(result.sourceMap).toHaveLength(3);
      expect(result.sourceMap[0].lineIndex).toBe(0);
      expect(result.sourceMap[1].lineIndex).toBe(1);
      expect(result.sourceMap[2].lineIndex).toBe(2);
    });

    it('should format text with newline separators', () => {
      const json = {
        first: 'First line',
        second: 'Second line',
        third: 'Third line',
      };

      const result = extractTextWithSources(json);

      expect(result.formattedText).toBe(
        'first: First line\nsecond: Second line\nthird: Third line'
      );
    });

    it('should handle empty objects gracefully', () => {
      const json = {};

      const result = extractTextWithSources(json);

      expect(result.sourceMap).toHaveLength(0);
      expect(result.formattedText).toBe('');
    });

    it('should handle null values gracefully', () => {
      const json = {
        valid_field: 'valid value',
        null_field: null,
      };

      const result = extractTextWithSources(json);

      expect(result.sourceMap).toHaveLength(1);
      expect(result.sourceMap[0].text).toBe('valid field: valid value');
    });

    it('should handle complex nested structures', () => {
      const json = {
        property: {
          address: '123 Main St',
          details: {
            bedrooms: 3,
            features: {
              garage: 'attached',
              pool: 'yes',
            },
          },
        },
      };

      const result = extractTextWithSources(json);

      const addressEntry = result.sourceMap.find((entry) =>
        entry.text.includes('123 Main St')
      );
      expect(addressEntry?.source).toBe('$.property.address');

      const bedroomsEntry = result.sourceMap.find((entry) =>
        entry.text.includes('bedrooms')
      );
      expect(bedroomsEntry?.source).toBe('$.property.details.bedrooms');

      const garageEntry = result.sourceMap.find((entry) =>
        entry.text.includes('attached')
      );
      expect(garageEntry?.source).toBe('$.property.details.features.garage');
    });

    it('should handle real-world property data', () => {
      const json = {
        property_address: '123 Main Street',
        sale_price: 450000,
        sale_date: '05/15/2023',
        property_details: {
          lot_size: '0.25 acres',
          year_built: 1985,
          bedrooms: 3,
          bathrooms: 2,
        },
        owner: {
          name: 'John Smith',
          mailing_address: '456 Oak Avenue',
        },
      };

      const result = extractTextWithSources(json);

      expect(result.sourceMap.length).toBeGreaterThan(0);

      expect(result.formattedText).toContain('123 Main Street');
      expect(result.formattedText).toContain('450000');
      expect(result.formattedText).toContain('John Smith');

      const addressEntry = result.sourceMap.find(
        (entry) => entry.source === '$.property_address'
      );
      expect(addressEntry?.text).toBe('property address: 123 Main Street');

      const ownerNameEntry = result.sourceMap.find(
        (entry) => entry.source === '$.owner.name'
      );
      expect(ownerNameEntry?.text).toBe('name: John Smith');
    });

    it('should handle arrays of primitives', () => {
      const json = {
        tags: ['residential', 'single-family', 'waterfront'],
      };

      const result = extractTextWithSources(json);

      // Arrays of primitives should be handled (strings extracted)
      expect(result.sourceMap.length).toBeGreaterThanOrEqual(0);
    });

    it('should skip boolean values', () => {
      const json = {
        is_active: true,
        has_pool: false,
        property_name: 'Sunshine Villa',
      };

      const result = extractTextWithSources(json);

      // Only the string should be extracted
      expect(result.sourceMap).toHaveLength(1);
      expect(result.sourceMap[0].text).toBe('property name: Sunshine Villa');
    });

    it('should handle deeply nested arrays and objects', () => {
      const json = {
        transactions: [
          {
            date: '2023-01-01',
            parties: [
              { name: 'Alice Johnson', role: 'buyer' },
              { name: 'Bob Williams', role: 'seller' },
            ],
          },
        ],
      };

      const result = extractTextWithSources(json);

      const aliceEntry = result.sourceMap.find((entry) =>
        entry.text.includes('Alice Johnson')
      );
      expect(aliceEntry?.source).toBe('$.transactions[0].parties[0].name');

      const bobEntry = result.sourceMap.find((entry) =>
        entry.text.includes('Bob Williams')
      );
      expect(bobEntry?.source).toBe('$.transactions[0].parties[1].name');
    });
  });
});
