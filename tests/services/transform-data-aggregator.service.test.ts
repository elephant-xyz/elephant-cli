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
        County: {
          property: [{ address: 'Main St', value: '100000' }],
          owner: [{ name: 'John Doe' }],
        },
      };

      const result = service.convertAggregatedDataToText(aggregated);

      expect(result).toContain('Main St');
      expect(result).toContain('100000');
      expect(result).toContain('John Doe');
    });

    it('should join sentences with periods', () => {
      const aggregated = {
        County: {
          data: [{ field1: 'value1', field2: 'value2' }],
        },
      };

      const result = service.convertAggregatedDataToText(aggregated);

      expect(result).toContain('.');
    });

    it('should normalize multiple periods', () => {
      const aggregated = {
        County: {
          data: [{ field: 'value.' }],
        },
      };

      const result = service.convertAggregatedDataToText(aggregated);

      expect(result).not.toContain('..');
    });

    it('should normalize whitespace', () => {
      const aggregated = {
        County: {
          data: [{ field: 'value  with   spaces' }],
        },
      };

      const result = service.convertAggregatedDataToText(aggregated);

      expect(result).not.toMatch(/\s{2,}/);
    });

    it('should handle multiple datagroups', () => {
      const aggregated = {
        County: {
          property: [{ address: 'Main St' }],
        },
        City: {
          building: [{ name: 'Tower' }],
        },
      };

      const result = service.convertAggregatedDataToText(aggregated);

      expect(result).toContain('Main St');
      expect(result).toContain('Tower');
    });
  });

  describe('aggregateTransformOutput', () => {
    it('should aggregate relationship files from datagroup root', async () => {
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

      await fs.writeFile(
        path.join(tempDir, 'bafkreitest123.json'),
        JSON.stringify({
          label: 'County',
          relationships: {
            property_has_owner: {
              '/': './relationship_property_has_owner.json',
            },
          },
        })
      );

      const result = await service.aggregateTransformOutput(tempDir);

      expect(result.County).toBeDefined();
      expect(result.County.property).toBeDefined();
      expect(result.County.owner).toBeDefined();
      expect(result.County.property).toHaveLength(1);
      expect(result.County.owner).toHaveLength(1);
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

      await fs.writeFile(
        path.join(tempDir, 'bafkreitest456.json'),
        JSON.stringify({
          label: 'County',
          relationships: {
            property_has_address: {
              '/': './relationship_property_has_address.json',
            },
          },
        })
      );

      const result = await service.aggregateTransformOutput(tempDir);

      expect(result.County).toBeDefined();
      expect(result.County.property).toBeDefined();
      expect(result.County.address).toBeDefined();
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

      await fs.writeFile(
        path.join(tempDir, 'bafkreitest789.json'),
        JSON.stringify({
          label: 'County',
          relationships: {
            owner_of_property: {
              '/': './relationship_owner_of_property.json',
            },
          },
        })
      );

      const result = await service.aggregateTransformOutput(tempDir);

      expect(result.County).toBeDefined();
      expect(result.County.property).toBeDefined();
      expect(result.County.owner).toBeDefined();
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

      await fs.writeFile(
        path.join(tempDir, 'bafkreiclean.json'),
        JSON.stringify({
          label: 'County',
          relationships: {
            person_has_data: {
              '/': './relationship_person_has_data.json',
            },
          },
        })
      );

      const result = await service.aggregateTransformOutput(tempDir);

      const personData = result.County?.person?.[0];
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

      await fs.writeFile(
        path.join(tempDir, 'bafkreifact.json'),
        JSON.stringify({
          label: 'County',
          relationships: {
            data_has_fact_sheet: {
              '/': './relationship_data_has_fact_sheet.json',
            },
          },
        })
      );

      const result = await service.aggregateTransformOutput(tempDir);

      expect(result.County).toBeDefined();
      expect(Object.keys(result.County)).toHaveLength(0);
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

      await fs.writeFile(
        path.join(tempDir, 'bafkreiarray.json'),
        JSON.stringify({
          label: 'County',
          relationships: {
            owner_has_property: {
              '/': './relationship_owner_has_property.json',
            },
          },
        })
      );

      const result = await service.aggregateTransformOutput(tempDir);

      expect(result.County).toBeDefined();
      expect(result.County.property).toHaveLength(2);
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

      await fs.writeFile(
        path.join(tempDir, 'bafkreiswap.json'),
        JSON.stringify({
          label: 'County',
          relationships: {
            property_has_owner: {
              '/': './relationship_property_has_owner.json',
            },
          },
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

      expect(normalResult.County).toBeDefined();
      expect(normalResult.County.property).toBeDefined();
      expect(normalResult.County.owner).toBeDefined();
      expect(swappedResult.County).toBeDefined();
      expect(swappedResult.County.property).toBeDefined();
      expect(swappedResult.County.owner).toBeDefined();
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

      await fs.writeFile(
        path.join(tempDir, 'bafkreidup.json'),
        JSON.stringify({
          label: 'County',
          relationships: {
            property_has_owner: {
              '/': './relationship_property_has_owner.json',
            },
          },
        })
      );

      const result = await service.aggregateTransformOutput(tempDir);

      expect(result.County).toBeDefined();
      expect(result.County.property).toHaveLength(1);
      expect(result.County.owner).toHaveLength(2);
    });

    it('should handle missing files gracefully', async () => {
      await fs.writeFile(
        path.join(tempDir, 'relationship_property_has_owner.json'),
        JSON.stringify({
          from: { '/': './missing1.json' },
          to: { '/': './missing2.json' },
        })
      );

      await fs.writeFile(
        path.join(tempDir, 'bafkreimissing.json'),
        JSON.stringify({
          label: 'County',
          relationships: {
            property_has_owner: {
              '/': './relationship_property_has_owner.json',
            },
          },
        })
      );

      const result = await service.aggregateTransformOutput(tempDir);

      expect(result.County).toBeDefined();
      expect(result.County.property).toBeDefined();
      expect(result.County.owner).toBeDefined();
      expect(result.County.property[0]).toEqual({});
      expect(result.County.owner[0]).toEqual({});
    });

    it('should handle invalid JSON gracefully', async () => {
      await fs.writeFile(
        path.join(tempDir, 'relationship_invalid.json'),
        'invalid json content'
      );

      await fs.writeFile(
        path.join(tempDir, 'bafkreiinvalid.json'),
        JSON.stringify({
          label: 'County',
          relationships: {
            data_has_other: {
              '/': './relationship_invalid.json',
            },
          },
        })
      );

      const result = await service.aggregateTransformOutput(tempDir);

      expect(result.County).toBeDefined();
      expect(Object.keys(result.County)).toHaveLength(0);
    });

    it('should skip non-json files', async () => {
      await fs.writeFile(
        path.join(tempDir, 'readme.txt'),
        'This is a text file'
      );

      const result = await service.aggregateTransformOutput(tempDir);

      expect(Object.keys(result)).toHaveLength(0);
    });

    it('should handle multiple datagroups', async () => {
      await fs.writeFile(
        path.join(tempDir, 'property1.json'),
        JSON.stringify({ address: 'County Address' })
      );

      await fs.writeFile(
        path.join(tempDir, 'property2.json'),
        JSON.stringify({ address: 'City Address' })
      );

      await fs.writeFile(
        path.join(tempDir, 'owner1.json'),
        JSON.stringify({ name: 'County Owner' })
      );

      await fs.writeFile(
        path.join(tempDir, 'owner2.json'),
        JSON.stringify({ name: 'City Owner' })
      );

      await fs.writeFile(
        path.join(tempDir, 'relationship_property_has_owner_1.json'),
        JSON.stringify({
          from: { '/': './property1.json' },
          to: { '/': './owner1.json' },
        })
      );

      await fs.writeFile(
        path.join(tempDir, 'relationship_property_has_owner_2.json'),
        JSON.stringify({
          from: { '/': './property2.json' },
          to: { '/': './owner2.json' },
        })
      );

      await fs.writeFile(
        path.join(tempDir, 'bafkreicounty.json'),
        JSON.stringify({
          label: 'County',
          relationships: {
            property_has_owner: {
              '/': './relationship_property_has_owner_1.json',
            },
          },
        })
      );

      await fs.writeFile(
        path.join(tempDir, 'bafkreicity.json'),
        JSON.stringify({
          label: 'City',
          relationships: {
            property_has_owner: {
              '/': './relationship_property_has_owner_2.json',
            },
          },
        })
      );

      const result = await service.aggregateTransformOutput(tempDir);

      expect(result.County).toBeDefined();
      expect(result.City).toBeDefined();
      expect(result.County.property).toHaveLength(1);
      expect(result.County.owner).toHaveLength(1);
      expect(result.City.property).toHaveLength(1);
      expect(result.City.owner).toHaveLength(1);
      expect(result.County.property[0].address).toBe('County Address');
      expect(result.City.property[0].address).toBe('City Address');
    });

    it('should only process files starting with bafkrei', async () => {
      await fs.writeFile(
        path.join(tempDir, 'property.json'),
        JSON.stringify({ address: 'Main St' })
      );

      await fs.writeFile(
        path.join(tempDir, 'owner.json'),
        JSON.stringify({ name: 'Owner' })
      );

      await fs.writeFile(
        path.join(tempDir, 'relationship_property_has_owner.json'),
        JSON.stringify({
          from: { '/': './property.json' },
          to: { '/': './owner.json' },
        })
      );

      await fs.writeFile(
        path.join(tempDir, 'not_a_datagroup.json'),
        JSON.stringify({
          label: 'County',
          relationships: {
            property_has_owner: {
              '/': './relationship_property_has_owner.json',
            },
          },
        })
      );

      const result = await service.aggregateTransformOutput(tempDir);

      expect(Object.keys(result)).toHaveLength(0);
    });
  });
});
