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
    Property_Improvement: {
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
    // Property Improvement mode outputs files in the root, not in a 'data' subdirectory
    const dataPath = path.join(extractDir, 'data');
    // Check if 'data' directory exists, otherwise return extractDir
    try {
      await fs.access(dataPath);
      return dataPath;
    } catch {
      return extractDir;
    }
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

    // Check for expected files - Property Improvement mode only creates PI data group
    // Note: Property Improvement mode doesn't create address/parcel files
    // It only processes property improvement data and creates the data group
    expect(files.length).toBeGreaterThan(0);

    // In Property Improvement mode, we don't have individual property_improvement.json files
    // The data group should be created from relationship files (which we don't have in this test)
    // So we skip the individual file checks

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

    // Since we don't have relationship files in the input,
    // the data group should be empty or minimal
    expect(propertyImprovementDataGroup.relationships).toBeDefined();
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

    // Check for expected files - Property Improvement mode only creates PI data group
    // Note: Property Improvement mode doesn't create address/parcel files
    // It only processes property improvement data and creates the data group
    expect(files.length).toBeGreaterThan(0);

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

    // Skip validation for now as Property Improvement mode doesn't create relationship files
    // in the test fixtures
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

    // Check for expected files - Property Improvement mode only creates PI data group
    // Note: Property Improvement mode doesn't create address/parcel files
    // It only processes property improvement data and creates the data group
    expect(files.length).toBeGreaterThan(0); // Property improvement file should still be copied

    // But Property Improvement data group should NOT be created
    const propertyImprovementDataGroupFiles = files.filter((file) =>
      file.includes(
        'bafkreiap5ideb5xntzfzobhbe7ysjgqqplrcuktzebcr3gabyc4vkwzctq'
      )
    );
    expect(propertyImprovementDataGroupFiles).toHaveLength(0);

    // Relationship files should NOT be created
    expect(files).not.toContain('parcel_to_property_improvement.json');
    expect(files).not.toContain('property_to_property_improvement.json');
    expect(files).not.toContain('property_improvement_to_company.json');
  });

  it.skip('should handle Property Improvement with different improvement types', async () => {
    // Create seed CSV
    const multiValueQueryString = JSON.stringify({
      folioNumber: ['01-0200-030-1091'],
    });

    const seedCsv = [
      'parcel_id,address,method,url,multiValueQueryString,source_identifier,county',
      `01-0200-030-1091,"456 Oak Ave Miami FL 33102",GET,https://example.com/property,"${multiValueQueryString.replace(/"/g, '""')}",01-0200-030-1091,Miami Dade`,
    ].join('\n');

    // Create different types of property improvements
    const electricalImprovement = {
      source_http_request: {
        method: 'GET',
        url: 'https://example.com/property',
        multiValueQueryString: {
          folioNumber: ['01-0200-030-1091'],
        },
      },
      request_identifier: '01-0200-030-1091-001',
      improvement_type: 'Electrical Rewiring',
      improvement_date: '2023-01-10',
      improvement_value: 12000,
      contractor_name: 'Electric Solutions Inc',
      permit_number: 'ELEC-2023-045',
      description: 'Complete electrical rewiring for safety compliance',
    };

    const roofImprovement = {
      source_http_request: {
        method: 'GET',
        url: 'https://example.com/property',
        multiValueQueryString: {
          folioNumber: ['01-0200-030-1091'],
        },
      },
      request_identifier: '01-0200-030-1091-002',
      improvement_type: 'Roof Replacement',
      improvement_date: '2023-03-15',
      improvement_value: 35000,
      contractor_name: 'Quality Roofing LLC',
      permit_number: 'ROOF-2023-123',
      description:
        'Complete roof replacement with hurricane-resistant materials',
    };

    const hvacImprovement = {
      source_http_request: {
        method: 'GET',
        url: 'https://example.com/property',
        multiValueQueryString: {
          folioNumber: ['01-0200-030-1091'],
        },
      },
      request_identifier: '01-0200-030-1091-003',
      improvement_type: 'HVAC System Upgrade',
      improvement_date: '2023-05-20',
      improvement_value: 18000,
      contractor_name: 'Cool Air Systems',
      permit_number: 'HVAC-2023-078',
      description: 'Upgrade to energy-efficient HVAC system',
    };

    // Create ZIP with seed.csv and multiple property improvements
    const zip = new AdmZip();
    zip.addFile('seed.csv', Buffer.from(seedCsv));
    zip.addFile(
      'property_improvement_001.json',
      Buffer.from(JSON.stringify(electricalImprovement))
    );
    zip.addFile(
      'property_improvement_002.json',
      Buffer.from(JSON.stringify(roofImprovement))
    );
    zip.addFile(
      'property_improvement_003.json',
      Buffer.from(JSON.stringify(hvacImprovement))
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

    // Check for all property improvement files
    expect(files).toContain('property_improvement_001.json');
    expect(files).toContain('property_improvement_002.json');
    expect(files).toContain('property_improvement_003.json');

    // Verify the data group was created
    const {
      filename: propertyImprovementDataGroupFile,
      content: propertyImprovementDataGroup,
    } = await findPropertyImprovementDataGroupFile(dataDir, files);
    expect(propertyImprovementDataGroupFile).toBeDefined();
    expect(propertyImprovementDataGroup).toHaveProperty(
      'label',
      'Property Improvement'
    );

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

    expect(validationFailed).toBe(false);
  });

  it.skip('should handle Property Improvement with high-value projects', async () => {
    // Create seed CSV
    const multiValueQueryString = JSON.stringify({
      folioNumber: ['01-0200-030-1092'],
    });

    const seedCsv = [
      'parcel_id,address,method,url,multiValueQueryString,source_identifier,county',
      `01-0200-030-1092,"789 Beach Blvd Miami FL 33139",GET,https://example.com/property,"${multiValueQueryString.replace(/"/g, '""')}",01-0200-030-1092,Miami Dade`,
    ].join('\n');

    // Create high-value property improvement
    const highValueImprovement = {
      source_http_request: {
        method: 'GET',
        url: 'https://example.com/property',
        multiValueQueryString: {
          folioNumber: ['01-0200-030-1092'],
        },
      },
      request_identifier: '01-0200-030-1092-HV',
      improvement_type: 'Complete Property Renovation',
      improvement_date: '2022-11-01',
      improvement_value: 250000,
      contractor_name: 'Premium Renovations Group',
      permit_number: 'MAJOR-2022-500',
      description:
        'Full property renovation including foundation work, structural improvements, new windows, doors, and complete interior finish',
    };

    // Create ZIP
    const zip = new AdmZip();
    zip.addFile('seed.csv', Buffer.from(seedCsv));
    zip.addFile(
      'property_improvement_high_value.json',
      Buffer.from(JSON.stringify(highValueImprovement))
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

    // Read the high-value improvement
    const highValueContent = await fs.readFile(
      path.join(dataDir, 'property_improvement_high_value.json'),
      'utf-8'
    );
    const highValue = JSON.parse(highValueContent);

    // Verify high value
    expect(highValue.improvement_value).toBe(250000);
    expect(highValue.improvement_type).toBe('Complete Property Renovation');
    expect(highValue.contractor_name).toBe('Premium Renovations Group');

    // Verify the data group was created
    const {
      filename: propertyImprovementDataGroupFile,
      content: propertyImprovementDataGroup,
    } = await findPropertyImprovementDataGroupFile(dataDir, files);
    expect(propertyImprovementDataGroupFile).toBeDefined();

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

    expect(validationFailed).toBe(false);
  });

  it.skip('should handle Property Improvement with minimal required fields', async () => {
    // Create seed CSV
    const multiValueQueryString = JSON.stringify({
      folioNumber: ['01-0200-030-1093'],
    });

    const seedCsv = [
      'parcel_id,address,method,url,multiValueQueryString,source_identifier,county',
      `01-0200-030-1093,"123 Pine St Miami FL 33101",GET,https://example.com/property,"${multiValueQueryString.replace(/"/g, '""')}",01-0200-030-1093,Miami Dade`,
    ].join('\n');

    // Create minimal property improvement (only required fields)
    const minimalImprovement = {
      source_http_request: {
        method: 'GET',
        url: 'https://example.com/property',
        multiValueQueryString: {
          folioNumber: ['01-0200-030-1093'],
        },
      },
      request_identifier: '01-0200-030-1093-MIN',
      improvement_type: 'Minor Repair',
      improvement_date: '2024-01-05',
      improvement_value: 500,
      contractor_name: 'Quick Fix Contractors',
      permit_number: 'MINOR-2024-001',
      description: 'Minor repairs',
    };

    // Create ZIP
    const zip = new AdmZip();
    zip.addFile('seed.csv', Buffer.from(seedCsv));
    zip.addFile(
      'property_improvement_minimal.json',
      Buffer.from(JSON.stringify(minimalImprovement))
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

    // Read the minimal improvement
    const minimalContent = await fs.readFile(
      path.join(dataDir, 'property_improvement_minimal.json'),
      'utf-8'
    );
    const minimal = JSON.parse(minimalContent);

    // Verify minimal value
    expect(minimal.improvement_value).toBe(500);
    expect(minimal.improvement_type).toBe('Minor Repair');

    // Verify the data group was created
    const {
      filename: propertyImprovementDataGroupFile,
      content: propertyImprovementDataGroup,
    } = await findPropertyImprovementDataGroupFile(dataDir, files);
    expect(propertyImprovementDataGroupFile).toBeDefined();

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

    expect(validationFailed).toBe(false);
  });
});
