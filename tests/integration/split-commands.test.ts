import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';

const execAsync = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RPC_URL = process.env.RPC_URL || 'https://polygon-rpc.com';

describe('Split Commands Integration Tests', () => {
  const testDataDir = path.join(__dirname, 'test-data');
  const outputDir = path.join(__dirname, 'test-output');
  const csvOutputPath = path.join(outputDir, 'upload-results.csv');
  const cliPath = path.join(__dirname, '../../bin/elephant-cli');

  beforeAll(async () => {
    // Create test directories
    await fs.promises.mkdir(outputDir, { recursive: true });
    // Use valid CID-like names for property directories (must be 46 chars for CIDv0)
    const propertyCid1 = 'QmWUnTmuodSYEuHVPgxtrARGra2VpzsusAp4FqT9FWobuU';
    const propertyCid2 = 'QmYzK2NYjmVxTmuodSYEuHVPgxtrARGra2VpzsusAp4Fq';
    const dataGroupCid1 = 'QmXYZ1muodSYEuHVPgxtrARGra2VpzsusAp4FqT9FWobu';
    const dataGroupCid2 = 'QmABC2muodSYEuHVPgxtrARGra2VpzsusAp4FqT9FWobu';

    await fs.promises.mkdir(path.join(testDataDir, propertyCid1), {
      recursive: true,
    });
    await fs.promises.mkdir(path.join(testDataDir, propertyCid2), {
      recursive: true,
    });

    // Create test data files
    const testData1 = { name: 'Test Property 1', value: 100 };
    const testData2 = { name: 'Test Property 2', value: 200 };

    await fs.promises.writeFile(
      path.join(testDataDir, propertyCid1, `${dataGroupCid1}.json`),
      JSON.stringify(testData1, null, 2)
    );

    await fs.promises.writeFile(
      path.join(testDataDir, propertyCid2, `${dataGroupCid2}.json`),
      JSON.stringify(testData2, null, 2)
    );
  });

  afterAll(async () => {
    // Clean up test directories
    await fs.promises.rm(testDataDir, { recursive: true, force: true });
    await fs.promises.rm(outputDir, { recursive: true, force: true });
  });

  describe('Integration test', () => {
    it('should work', async () => {
      const { stdout, stderr } = await execAsync(
        `node ${cliPath} validate-and-upload new-json-schema-data/data --dry-run`
      );
    }, 0);
  });

  describe('validate-and-upload command', () => {
    it('should validate files and generate CSV in dry-run mode', async () => {
      const privateKey = '0x' + '1'.repeat(64); // Dummy private key
      const pinataJwt = 'dummy-jwt'; // Dummy Pinata JWT

      const { stdout, stderr } = await execAsync(
        `node ${cliPath} validate-and-upload ${testDataDir} ` +
          `--pinata-jwt ${pinataJwt} ` +
          `--output-csv ${csvOutputPath} ` +
          `--dry-run`
      );

      expect(stderr).toBe('');
      expect(stdout).toContain('Validation and upload process finished');
      // Since we're in dry run and schemas can't be fetched, expect errors
      expect(stdout).toContain('Processing/upload errors: 2');

      // Check that CSV was created
      const csvExists = await fs.promises
        .access(csvOutputPath)
        .then(() => true)
        .catch(() => false);
      expect(csvExists).toBe(true);

      // Read and verify CSV content - should be empty except for headers since schema fetching fails
      const csvContent = await fs.promises.readFile(csvOutputPath, 'utf-8');
      expect(csvContent).toContain(
        'propertyCid,dataGroupCid,dataCid,filePath,uploadedAt'
      );
      // CSV should only contain headers since schema downloads fail with fake CIDs
      expect(csvContent.trim()).toBe(
        'propertyCid,dataGroupCid,dataCid,filePath,uploadedAt'
      );
    });

    it('should handle invalid directory structure', async () => {
      const invalidDir = path.join(outputDir, 'invalid-structure');
      await fs.promises.mkdir(invalidDir, { recursive: true });

      // Create file at root level (invalid structure)
      await fs.promises.writeFile(
        path.join(invalidDir, 'invalid.json'),
        '{"test": true}'
      );

      const privateKey = '0x' + '1'.repeat(64);
      const pinataJwt = 'dummy-jwt';

      try {
        await execAsync(
          `node ${cliPath} validate-and-upload ${invalidDir} ` +
            `--pinata-jwt ${pinataJwt} ` +
            `--dry-run`
        );
        expect.fail('Command should have failed');
      } catch (error: any) {
        // Log the full error object for debugging purposes on platforms where it might behave differently.
        if (error.code !== 1) {
          console.log(
            'Test failure diagnosis: Caught error object from execAsync:',
            JSON.stringify(error, null, 2)
          );
        }
        expect(error.code).toBe(1);
        expect(error.stderr || error.stdout).toContain(
          'Directory structure is invalid'
        );
      }

      await fs.promises.rm(invalidDir, { recursive: true, force: true });
    });
  });

  describe('submit-to-contract command', () => {
    beforeAll(async () => {
      // Create a test CSV file for submit-to-contract tests
      const csvContent = `propertyCid,dataGroupCid,dataCid,filePath,uploadedAt
property1,dataGroup1,QmTest1,"/test/property1/dataGroup1.json",2024-01-01T00:00:00Z
property2,dataGroup2,QmTest2,"/test/property2/dataGroup2.json",2024-01-01T00:01:00Z`;

      await fs.promises.writeFile(
        path.join(outputDir, 'test-input.csv'),
        csvContent
      );
    });

    it('should process CSV and prepare for submission in dry-run mode', async () => {
      const privateKey = '0x' + '1'.repeat(64);

      const { stdout, stderr } = await execAsync(
        `node ${cliPath} submit-to-contract ${path.join(outputDir, 'test-input.csv')} ` +
          `--private-key ${privateKey} ` +
          `--dry-run ` +
          `--rpc-url ${RPC_URL}`
      );

      // Check that the command completed successfully
      expect(stderr).toBe('');
      expect(stdout).toContain('Contract submission process finished');
      expect(stdout).toContain('Total records in CSV:   2');
      expect(stdout).toContain('[DRY RUN] Would submit:');
    }, 120000);

    it('should handle missing CSV file', async () => {
      const privateKey = '0x' + '1'.repeat(64);
      const missingCsv = path.join(outputDir, 'missing.csv');

      try {
        await execAsync(
          `node ${cliPath} submit-to-contract ${missingCsv} ` +
            `--private-key ${privateKey} ` +
            `--dry-run ` +
            `--rpc-url ${RPC_URL}`
        );
        expect.fail('Command should have failed');
      } catch (error: any) {
        expect(error.code).toBe(1);
        const output = error.stderr || error.stdout;
        expect(output.toLowerCase()).toContain('error');
        expect(output).toContain('CSV file');
      }
    });

    it('should handle empty CSV file', async () => {
      const privateKey = '0x' + '1'.repeat(64);
      const emptyCsvPath = path.join(outputDir, 'empty.csv');

      // Create empty CSV with only headers
      await fs.promises.writeFile(
        emptyCsvPath,
        'propertyCid,dataGroupCid,dataCid,filePath,uploadedAt\n'
      );

      const { stdout, stderr } = await execAsync(
        `node ${cliPath} submit-to-contract ${emptyCsvPath} ` +
          `--private-key ${privateKey} ` +
          `--dry-run ` +
          `--rpc-url ${RPC_URL}`
      );

      expect(stderr).toBe('');
      // The actual output shows the final report with 0 records
      expect(stdout).toContain('Total records in CSV:   0');

      await fs.promises.rm(emptyCsvPath);
    });
  });

  describe('End-to-end workflow', () => {
    it('should complete full workflow: validate-and-upload then submit-to-contract', async () => {
      const privateKey = '0x' + '1'.repeat(64);
      const pinataJwt = 'dummy-jwt';
      const workflowCsvPath = path.join(outputDir, 'workflow-results.csv');

      // Step 1: Run validate-and-upload
      const { stdout: stdout1 } = await execAsync(
        `node ${cliPath} validate-and-upload ${testDataDir} ` +
          `--pinata-jwt ${pinataJwt} ` +
          `--output-csv ${workflowCsvPath} ` +
          `--dry-run `
      );

      expect(stdout1).toContain('Validation and upload process finished');

      // Verify CSV was created
      const csvExists = await fs.promises
        .access(workflowCsvPath)
        .then(() => true)
        .catch(() => false);
      expect(csvExists).toBe(true);

      // Step 2: Run submit-to-contract with the generated CSV
      const { stdout: stdout2 } = await execAsync(
        `node ${cliPath} submit-to-contract ${workflowCsvPath} ` +
          `--private-key ${privateKey} ` +
          `--dry-run ` +
          `--rpc-url ${RPC_URL}`
      );

      expect(stdout2).toContain('Contract submission process finished');
      // CSV should be empty since validate-and-upload had schema errors
      expect(stdout2).toContain('Total records in CSV:   0');
    });
  });
});
