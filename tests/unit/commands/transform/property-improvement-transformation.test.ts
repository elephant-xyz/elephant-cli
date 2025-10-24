import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import AdmZip from 'adm-zip';
import { handleTransform } from '../../../../src/commands/transform/index.js';
import { execSync } from 'child_process';

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
    'Property Improvement': {
      ipfsCid: 'bafkreiap5ideb5xntzfzobhbe7ysjgqqplrcuktzebcr3gabyc4vkwzctq',
      description: 'Property Improvement data group schema',
    },
  }),
}));

describe('Property Improvement Data Group Transformation', () => {
  let tempDir: string;
  let inputZip: string;
  let outputZip: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'property-improvement-'));
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
   * Find the Property Improvement data group file by parsing all JSON files and checking for label: 'Property Improvement'
   */
  async function findPropertyImprovementDataGroupFile(
    dataDir: string,
    files: string[]
  ): Promise<{ filename: string; content: any }> {
    for (const file of files) {
      if (!file.endsWith('.json')) continue;

      try {
        const content = await fs.readFile(path.join(dataDir, file), 'utf-8');
        const parsed = JSON.parse(content);

        if (parsed.label === 'Property Improvement') {
          return { filename: file, content: parsed };
        }
      } catch {
        // Skip files that aren't valid JSON or can't be read
        continue;
      }
    }

    throw new Error('Property Improvement data group file not found');
  }

  it('should create Property Improvement data group with proper relationships', async () => {
    // Create seed CSV with property improvement data
    const multiValueQueryString = JSON.stringify({
      folioNumber: ['01-0200-030-1090'],
    });

    const seedCsv = [
      'parcel_id,address,method,url,multiValueQueryString,source_identifier,county',
      `01-0200-030-1090,"123 Main St Miami FL 33101",GET,https://example.com/property,"${multiValueQueryString.replace(/"/g, '""')}",01-0200-030-1090,Miami Dade`,
    ].join('\n');

    // Create sample property improvement data
    const propertyImprovementData = {
      source_http_request: {
        method: 'GET',
        url: 'https://example.com/property',
        multiValueQueryString: {
          folioNumber: ['01-0200-030-1090'],
        },
      },
      request_identifier: '01-0200-030-1090',
      improvement_type: 'Kitchen Renovation',
      improvement_date: '2023-06-15',
      improvement_value: 25000,
      contractor_name: 'ABC Construction',
      permit_number: 'PER-2023-001',
      description: 'Complete kitchen renovation with new appliances',
    };

    // Create ZIP with seed.csv and property improvement data
    const zip = new AdmZip();
    zip.addFile('seed.csv', Buffer.from(seedCsv));
    zip.addFile(
      'property_improvement.json',
      Buffer.from(JSON.stringify(propertyImprovementData))
    );
    zip.writeZip(inputZip);

    // Transform
    await handleTransform({
      inputZip,
      outputZip,
      silent: true,
      propertyImprovement: true,
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
    expect(files).toContain('property_improvement.json');

    // Read property_improvement.json
    const propertyImprovementContent = await fs.readFile(
      path.join(dataDir, 'property_improvement.json'),
      'utf-8'
    );
    const propertyImprovement = JSON.parse(propertyImprovementContent);

    // Verify property improvement data structure
    expect(propertyImprovement).toHaveProperty('source_http_request');
    expect(propertyImprovement).toHaveProperty('request_identifier');
    expect(propertyImprovement).toHaveProperty('improvement_type');
    expect(propertyImprovement).toHaveProperty('improvement_date');
    expect(propertyImprovement).toHaveProperty('improvement_value');
    expect(propertyImprovement).toHaveProperty('contractor_name');
    expect(propertyImprovement).toHaveProperty('permit_number');
    expect(propertyImprovement).toHaveProperty('description');

    // Verify values
    expect(propertyImprovement.source_http_request).toHaveProperty(
      'method',
      'GET'
    );
    expect(
      propertyImprovement.source_http_request.multiValueQueryString
    ).toEqual({
      folioNumber: ['01-0200-030-1090'],
    });
    expect(propertyImprovement.request_identifier).toBe('01-0200-030-1090');
    expect(propertyImprovement.improvement_type).toBe('Kitchen Renovation');
    expect(propertyImprovement.improvement_date).toBe('2023-06-15');
    expect(propertyImprovement.improvement_value).toBe(25000);
    expect(propertyImprovement.contractor_name).toBe('ABC Construction');
    expect(propertyImprovement.permit_number).toBe('PER-2023-001');
    expect(propertyImprovement.description).toBe(
      'Complete kitchen renovation with new appliances'
    );

    // Check for Property Improvement data group file
    const {
      filename: propertyImprovementDataGroupFile,
      content: propertyImprovementDataGroup,
    } = await findPropertyImprovementDataGroupFile(dataDir, files);
    expect(propertyImprovementDataGroupFile).toBeDefined();

    // Verify Property Improvement data group structure with relationships
    expect(propertyImprovementDataGroup).toHaveProperty(
      'label',
      'Property Improvement'
    );
    expect(propertyImprovementDataGroup).toHaveProperty('relationships');

    // Check for expected relationships based on the schema
    const relationships = propertyImprovementDataGroup.relationships;

    // These relationships should be present based on the files we created
    expect(relationships).toHaveProperty('parcel_has_property_improvement');
    expect(relationships).toHaveProperty('property_has_property_improvement');
    expect(relationships).toHaveProperty('property_improvement_has_contractor');

    // Verify relationship structure (IPLD links)
    expect(relationships.parcel_has_property_improvement).toHaveProperty(
      '/',
      './parcel_has_property_improvement.json'
    );
    expect(Array.isArray(relationships.property_has_property_improvement)).toBe(
      true
    );
    expect(relationships.property_has_property_improvement![0]).toHaveProperty(
      '/',
      './property_has_property_improvement.json'
    );
    expect(
      Array.isArray(relationships.property_improvement_has_contractor)
    ).toBe(true);
    expect(
      relationships.property_improvement_has_contractor![0]
    ).toHaveProperty('/', './property_improvement_has_contractor.json');

    // Run validation on the transformed data using CLI command
    let validationFailed = false;

    try {
      execSync(`node dist/index.js validate "${outputZip}"`, {
        cwd: process.cwd(),
        encoding: 'utf-8',
        stdio: 'pipe',
      });
    } catch {
      validationFailed = true;
    }

    // Validation should pass
    expect(validationFailed).toBe(false);
  });

  it('should handle Property Improvement with multiple improvements', async () => {
    // Create seed CSV
    const multiValueQueryString = JSON.stringify({
      folioNumber: ['01-0200-030-1090'],
    });

    const seedCsv = [
      'parcel_id,address,method,url,multiValueQueryString,source_identifier,county',
      `01-0200-030-1090,"123 Main St Miami FL 33101",GET,https://example.com/property,"${multiValueQueryString.replace(/"/g, '""')}",01-0200-030-1090,Miami Dade`,
    ].join('\n');

    // Create multiple property improvements
    const multiplePropertyImprovements = [
      {
        source_http_request: {
          method: 'GET',
          url: 'https://example.com/property',
          multiValueQueryString: {
            folioNumber: ['01-0200-030-1090'],
          },
        },
        request_identifier: '01-0200-030-1090',
        improvement_type: 'Kitchen Renovation',
        improvement_date: '2023-06-15',
        improvement_value: 25000,
        contractor_name: 'ABC Construction',
        permit_number: 'PER-2023-001',
        description: 'Complete kitchen renovation with new appliances',
      },
      {
        source_http_request: {
          method: 'GET',
          url: 'https://example.com/property',
          multiValueQueryString: {
            folioNumber: ['01-0200-030-1090'],
          },
        },
        request_identifier: '01-0200-030-1090',
        improvement_type: 'Bathroom Remodel',
        improvement_date: '2023-08-20',
        improvement_value: 15000,
        contractor_name: 'XYZ Renovations',
        permit_number: 'PER-2023-002',
        description: 'Master bathroom remodel with new fixtures',
      },
    ];

    // Create ZIP with seed.csv and multiple property improvements
    const zip = new AdmZip();
    zip.addFile('seed.csv', Buffer.from(seedCsv));
    zip.addFile(
      'property_improvement.json',
      Buffer.from(JSON.stringify(multiplePropertyImprovements))
    );
    zip.writeZip(inputZip);

    // Transform
    await handleTransform({
      inputZip,
      outputZip,
      silent: true,
      propertyImprovement: true,
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
    expect(files).toContain('property_improvement.json');

    // Read property_improvement.json
    const propertyImprovementContent = await fs.readFile(
      path.join(dataDir, 'property_improvement.json'),
      'utf-8'
    );
    const parsedPropertyImprovements = JSON.parse(propertyImprovementContent);

    // Verify it's an array with multiple improvements
    expect(Array.isArray(parsedPropertyImprovements)).toBe(true);
    expect(parsedPropertyImprovements).toHaveLength(2);

    // Verify first improvement
    expect(parsedPropertyImprovements[0]).toHaveProperty(
      'improvement_type',
      'Kitchen Renovation'
    );
    expect(parsedPropertyImprovements[0]).toHaveProperty(
      'improvement_value',
      25000
    );
    expect(parsedPropertyImprovements[0]).toHaveProperty(
      'contractor_name',
      'ABC Construction'
    );

    // Verify second improvement
    expect(parsedPropertyImprovements[1]).toHaveProperty(
      'improvement_type',
      'Bathroom Remodel'
    );
    expect(parsedPropertyImprovements[1]).toHaveProperty(
      'improvement_value',
      15000
    );
    expect(parsedPropertyImprovements[1]).toHaveProperty(
      'contractor_name',
      'XYZ Renovations'
    );

    // Check for Property Improvement data group file
    const {
      filename: propertyImprovementDataGroupFile,
      content: propertyImprovementDataGroup,
    } = await findPropertyImprovementDataGroupFile(dataDir, files);
    expect(propertyImprovementDataGroupFile).toBeDefined();

    // Verify Property Improvement data group structure
    expect(propertyImprovementDataGroup).toHaveProperty(
      'label',
      'Property Improvement'
    );
    expect(propertyImprovementDataGroup).toHaveProperty('relationships');

    // Run validation
    let validationFailed = false;

    try {
      execSync(`node dist/index.js validate "${outputZip}"`, {
        cwd: process.cwd(),
        encoding: 'utf-8',
        stdio: 'pipe',
      });
    } catch {
      validationFailed = true;
    }

    // Validation should pass
    expect(validationFailed).toBe(false);
  });

  it('should NOT create Property Improvement data group when flag is not provided', async () => {
    // Create seed CSV with property improvement data
    const multiValueQueryString = JSON.stringify({
      folioNumber: ['01-0200-030-1090'],
    });

    const seedCsv = [
      'parcel_id,address,method,url,multiValueQueryString,source_identifier,county',
      `01-0200-030-1090,"123 Main St Miami FL 33101",GET,https://example.com/property,"${multiValueQueryString.replace(/"/g, '""')}",01-0200-030-1090,Miami Dade`,
    ].join('\n');

    // Create sample property improvement data
    const propertyImprovementData = {
      source_http_request: {
        method: 'GET',
        url: 'https://example.com/property',
        multiValueQueryString: {
          folioNumber: ['01-0200-030-1090'],
        },
      },
      request_identifier: '01-0200-030-1090',
      improvement_type: 'Kitchen Renovation',
      improvement_date: '2023-06-15',
      improvement_value: 25000,
      contractor_name: 'ABC Construction',
      permit_number: 'PER-2023-001',
      description: 'Complete kitchen renovation with new appliances',
    };

    // Create ZIP with seed.csv and property improvement data
    const zip = new AdmZip();
    zip.addFile('seed.csv', Buffer.from(seedCsv));
    zip.addFile(
      'property_improvement.json',
      Buffer.from(JSON.stringify(propertyImprovementData))
    );
    zip.writeZip(inputZip);

    // Transform WITHOUT property improvement flag
    await handleTransform({
      inputZip,
      outputZip,
      silent: true,
      // propertyImprovement flag is NOT provided
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
    expect(files).toContain('property_improvement.json'); // Property improvement file should still be copied

    // But Property Improvement data group should NOT be created
    const propertyImprovementDataGroupFiles = files.filter((file) =>
      file.includes(
        'bafkreiap5ideb5xntzfzobhbe7ysjgqqplrcuktzebcr3gabyc4vkwzctq'
      )
    );
    expect(propertyImprovementDataGroupFiles).toHaveLength(0);

    // Relationship files should NOT be created
    expect(files).not.toContain('parcel_has_property_improvement.json');
    expect(files).not.toContain('property_has_property_improvement.json');
    expect(files).not.toContain('property_improvement_has_contractor.json');
  });
});
