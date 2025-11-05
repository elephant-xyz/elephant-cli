import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import { tmpdir } from 'os';
import { TransformDataAggregatorService } from '../../src/services/transform-data-aggregator.service.js';

describe('TransformDataAggregatorService', () => {
  let service: TransformDataAggregatorService;
  let tempDir: string;

  beforeEach(async () => {
    service = new TransformDataAggregatorService();
    tempDir = await fs.mkdtemp(path.join(tmpdir(), 'test-aggregator-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('jsonToText', () => {
    it('should convert simple JSON to text', () => {
      const json = {
        name: 'John Doe',
        age: 30,
      };

      const result = service.jsonToText(json);

      expect(result).toContain('name: John Doe');
      expect(result).toContain('age: 30');
    });

    it('should handle nested objects', () => {
      const json = {
        person: {
          name: 'John Doe',
          address: {
            city: 'Seattle',
          },
        },
      };

      const result = service.jsonToText(json);

      expect(result).toContain('name: John Doe');
      expect(result).toContain('city: Seattle');
    });

    it('should handle arrays', () => {
      const json = [{ name: 'Alice' }, { name: 'Bob' }];

      const result = service.jsonToText(json);

      expect(result).toContain('name: Alice');
      expect(result).toContain('name: Bob');
    });

    it('should skip short strings', () => {
      const json = {
        valid: 'long enough string',
        short: 'ab',
        empty: '',
      };

      const result = service.jsonToText(json);

      expect(result).toContain('valid: long enough string');
      expect(result.filter((s) => s.includes('short'))).toHaveLength(0);
      expect(result.filter((s) => s.includes('empty'))).toHaveLength(0);
    });

    it('should convert keys with underscores to spaces', () => {
      const json = {
        first_name: 'John',
        last_name: 'Doe',
      };

      const result = service.jsonToText(json);

      expect(result).toContain('first name: John');
      expect(result).toContain('last name: Doe');
    });

    it('should handle non-object input', () => {
      expect(service.jsonToText(null)).toEqual([]);
      expect(service.jsonToText(undefined)).toEqual([]);
      expect(service.jsonToText('string')).toEqual([]);
      expect(service.jsonToText(123)).toEqual([]);
    });
  });

  describe('convertAggregatedDataToText', () => {
    it('should convert aggregated data to single text', () => {
      const aggregated = {
        property: [{ address: 'Main St', value: '100000' }],
        owner: [{ name: 'John Doe' }],
      };

      const result = service.convertAggregatedDataToText(aggregated);

      expect(result).toContain('Main St');
      expect(result).toContain('100000');
      expect(result).toContain('John Doe');
    });

    it('should join sentences with periods', () => {
      const aggregated = {
        data: [{ field1: 'value1', field2: 'value2' }],
      };

      const result = service.convertAggregatedDataToText(aggregated);

      expect(result).toContain('.');
    });

    it('should normalize multiple periods', () => {
      const aggregated = {
        data: [{ field: 'value.' }],
      };

      const result = service.convertAggregatedDataToText(aggregated);

      expect(result).not.toContain('..');
    });

    it('should normalize whitespace', () => {
      const aggregated = {
        data: [{ field: 'value  with   spaces' }],
      };

      const result = service.convertAggregatedDataToText(aggregated);

      expect(result).not.toMatch(/\s{2,}/);
    });
  });

  describe('aggregateTransformOutput', () => {
    it('should aggregate relationship files', async () => {
      await fs.writeFile(
        path.join(tempDir, 'property.json'),
        JSON.stringify({ address: '123 Main St', value: 100000 })
      );

      await fs.writeFile(
        path.join(tempDir, 'owner.json'),
        JSON.stringify({ name: 'John Doe' })
      );

      await fs.writeFile(
        path.join(tempDir, 'relationship_property_has_owner.json'),
        JSON.stringify({
          from: { '/': './property.json' },
          to: { '/': './owner.json' },
        })
      );

      const result = await service.aggregateTransformOutput(tempDir);

      expect(result.property).toBeDefined();
      expect(result.owner).toBeDefined();
      expect(result.property).toHaveLength(1);
      expect(result.owner).toHaveLength(1);
    });

    it('should parse relationship labels correctly', async () => {
      await fs.writeFile(
        path.join(tempDir, 'from.json'),
        JSON.stringify({ data: 'from-data' })
      );

      await fs.writeFile(
        path.join(tempDir, 'to.json'),
        JSON.stringify({ data: 'to-data' })
      );

      await fs.writeFile(
        path.join(tempDir, 'relationship_property_has_address.json'),
        JSON.stringify({
          from: { '/': './from.json' },
          to: { '/': './to.json' },
        })
      );

      const result = await service.aggregateTransformOutput(tempDir);

      expect(result.property).toBeDefined();
      expect(result.address).toBeDefined();
    });

    it('should handle "of" relationships', async () => {
      await fs.writeFile(
        path.join(tempDir, 'from.json'),
        JSON.stringify({ data: 'from-data' })
      );

      await fs.writeFile(
        path.join(tempDir, 'to.json'),
        JSON.stringify({ data: 'to-data' })
      );

      await fs.writeFile(
        path.join(tempDir, 'relationship_owner_of_property.json'),
        JSON.stringify({
          from: { '/': './from.json' },
          to: { '/': './to.json' },
        })
      );

      const result = await service.aggregateTransformOutput(tempDir);

      expect(result.property).toBeDefined();
      expect(result.owner).toBeDefined();
    });

    it('should clean objects by removing internal fields', async () => {
      await fs.writeFile(
        path.join(tempDir, 'data.json'),
        JSON.stringify({
          name: 'John',
          source_http_request: 'should-be-removed',
          request_identifier: 'should-be-removed',
        })
      );

      await fs.writeFile(
        path.join(tempDir, 'other.json'),
        JSON.stringify({ data: 'other' })
      );

      await fs.writeFile(
        path.join(tempDir, 'relationship_person_has_data.json'),
        JSON.stringify({
          from: { '/': './data.json' },
          to: { '/': './other.json' },
        })
      );

      const result = await service.aggregateTransformOutput(tempDir);

      const personData = result.person?.[0];
      expect(personData).toBeDefined();
      expect(personData).not.toHaveProperty('source_http_request');
      expect(personData).not.toHaveProperty('request_identifier');
    });

    it('should exclude fact sheet relationships', async () => {
      await fs.writeFile(
        path.join(tempDir, 'data.json'),
        JSON.stringify({ data: 'test' })
      );

      await fs.writeFile(
        path.join(tempDir, 'fact.json'),
        JSON.stringify({ fact: 'test' })
      );

      await fs.writeFile(
        path.join(tempDir, 'relationship_data_has_fact_sheet.json'),
        JSON.stringify({
          from: { '/': './data.json' },
          to: { '/': './fact.json' },
        })
      );

      const result = await service.aggregateTransformOutput(tempDir);

      expect(Object.keys(result)).toHaveLength(0);
    });

    it('should handle array of relationships', async () => {
      await fs.writeFile(
        path.join(tempDir, 'property1.json'),
        JSON.stringify({ address: 'Address 1' })
      );

      await fs.writeFile(
        path.join(tempDir, 'property2.json'),
        JSON.stringify({ address: 'Address 2' })
      );

      await fs.writeFile(
        path.join(tempDir, 'owner.json'),
        JSON.stringify({ name: 'Owner' })
      );

      await fs.writeFile(
        path.join(tempDir, 'relationship_owner_has_property.json'),
        JSON.stringify([
          {
            from: { '/': './owner.json' },
            to: { '/': './property1.json' },
          },
          {
            from: { '/': './owner.json' },
            to: { '/': './property2.json' },
          },
        ])
      );

      const result = await service.aggregateTransformOutput(tempDir);

      expect(result.property).toHaveLength(2);
    });

    it('should handle swap direction option', async () => {
      await fs.writeFile(
        path.join(tempDir, 'from.json'),
        JSON.stringify({ data: 'from-data' })
      );

      await fs.writeFile(
        path.join(tempDir, 'to.json'),
        JSON.stringify({ data: 'to-data' })
      );

      await fs.writeFile(
        path.join(tempDir, 'relationship_property_has_owner.json'),
        JSON.stringify({
          from: { '/': './from.json' },
          to: { '/': './to.json' },
        })
      );

      const normalResult = await service.aggregateTransformOutput(
        tempDir,
        false
      );
      const swappedResult = await service.aggregateTransformOutput(
        tempDir,
        true
      );

      expect(normalResult.property).toBeDefined();
      expect(normalResult.owner).toBeDefined();
      expect(swappedResult.property).toBeDefined();
      expect(swappedResult.owner).toBeDefined();
    });

    it('should avoid duplicate objects', async () => {
      await fs.writeFile(
        path.join(tempDir, 'property.json'),
        JSON.stringify({ address: 'Main St' })
      );

      await fs.writeFile(
        path.join(tempDir, 'owner1.json'),
        JSON.stringify({ name: 'Owner 1' })
      );

      await fs.writeFile(
        path.join(tempDir, 'owner2.json'),
        JSON.stringify({ name: 'Owner 2' })
      );

      await fs.writeFile(
        path.join(tempDir, 'relationship_property_has_owner.json'),
        JSON.stringify([
          {
            from: { '/': './property.json' },
            to: { '/': './owner1.json' },
          },
          {
            from: { '/': './property.json' },
            to: { '/': './owner2.json' },
          },
        ])
      );

      const result = await service.aggregateTransformOutput(tempDir);

      expect(result.property).toHaveLength(1);
      expect(result.owner).toHaveLength(2);
    });

    it('should handle missing files gracefully', async () => {
      await fs.writeFile(
        path.join(tempDir, 'relationship_property_has_owner.json'),
        JSON.stringify({
          from: { '/': './missing1.json' },
          to: { '/': './missing2.json' },
        })
      );

      const result = await service.aggregateTransformOutput(tempDir);

      // Should create entries but with empty objects
      expect(result.property).toBeDefined();
      expect(result.owner).toBeDefined();
      expect(result.property[0]).toEqual({});
      expect(result.owner[0]).toEqual({});
    });

    it('should handle invalid JSON gracefully', async () => {
      await fs.writeFile(
        path.join(tempDir, 'relationship_invalid.json'),
        'invalid json content'
      );

      const result = await service.aggregateTransformOutput(tempDir);

      expect(Object.keys(result)).toHaveLength(0);
    });

    it('should skip non-json files', async () => {
      await fs.writeFile(
        path.join(tempDir, 'readme.txt'),
        'This is a text file'
      );

      const result = await service.aggregateTransformOutput(tempDir);

      expect(Object.keys(result)).toHaveLength(0);
    });
  });
});
