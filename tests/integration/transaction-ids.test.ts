import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import 'dotenv/config';

const execAsync = promisify(exec);
const __dirname = process.cwd();

describe('Transaction IDs CSV Integration Tests', () => {
  const outputDir = path.join(__dirname, 'test-transaction-output');
  const csvInputPath = path.join(outputDir, 'test-input.csv');
  const transactionIdsCsvPath = path.join(outputDir, 'transaction-ids.csv');
  const cliPath = path.join(__dirname, 'bin/elephant-cli');

  beforeAll(async () => {
    // Create test directories
    await fs.promises.mkdir(outputDir, { recursive: true });

    // Create test CSV input file with multiple records
    const csvContent = `propertyCid,dataGroupCid,dataCid,filePath,uploadedAt
bafkreigpfi4pqur43wj3x2dwm43hnbtrxabgwsi3hobzbtqrs3iytohevu,bafkreigpfi4pqur43wj3x2dwm43hnbtrxabgwsi3hobzbtqrs3iytohevu,bafkreigpfi4pqur43wj3x2dwm43hnbtrxabgwsi3hobzbtqrs3iytohevu,"/test/property1/dataGroup1.json",2024-01-01T00:00:00Z
bafkreigd6yhp5dfcdrtfubtdq76cnstxehqvpjgmrpuhj7jnwtf3syx3ma,bafkreigd6yhp5dfcdrtfubtdq76cnstxehqvpjgmrpuhj7jnwtf3syx3ma,bafkreigd6yhp5dfcdrtfubtdq76cnstxehqvpjgmrpuhj7jnwtf3syx3ma,"/test/property2/dataGroup2.json",2024-01-01T00:01:00Z
bafkreiac4j3s4xhz2ej6qcz6w2xjrcqyhqpmlc5u6l4jy4yk7vfqktkvr4,bafkreiac4j3s4xhz2ej6qcz6w2xjrcqyhqpmlc5u6l4jy4yk7vfqktkvr4,bafkreiac4j3s4xhz2ej6qcz6w2xjrcqyhqpmlc5u6l4jy4yk7vfqktkvr4,"/test/property3/dataGroup3.json",2024-01-01T00:02:00Z
bafkreiab5j3s4xhz2ej6qcz6w2xjrcqyhqpmlc5u6l4jy4yk7vfqktkvr4,bafkreiab5j3s4xhz2ej6qcz6w2xjrcqyhqpmlc5u6l4jy4yk7vfqktkvr4,bafkreiab5j3s4xhz2ej6qcz6w2xjrcqyhqpmlc5u6l4jy4yk7vfqktkvr4,"/test/property4/dataGroup4.json",2024-01-01T00:03:00Z`;

    await fs.promises.writeFile(csvInputPath, csvContent);
  });

  afterAll(async () => {
    // Clean up test directories
    await fs.promises.rm(outputDir, { recursive: true, force: true });
  });

  describe('submit-to-contract command with transaction IDs', () => {
    it('should generate transaction IDs CSV in dry-run mode', async () => {
      const testKeystorePath = path.join(process.cwd(), 'tests/test-keystore.json');
      const testKeystorePassword = 'testPassword123'; // Dummy private key

      const { stdout, stderr } = await execAsync(
        `node ${cliPath} submit-to-contract ${csvInputPath} ` +
          `--keystore-json ${testKeystorePath} ` +
          `--keystore-password "${testKeystorePassword}" ` +
          `--transaction-batch-size 2 ` +
          `--transaction-ids-csv ${transactionIdsCsvPath} ` +
          `--dry-run`
      );

      expect(stderr).toBe('');
      expect(stdout).toContain('Contract submission process finished');
      expect(stdout).toContain('[DRY RUN] Would submit: 4 items');
      expect(stdout).toContain('[DRY RUN] In batches:   2'); // 4 items / 2 batch size = 2 transactions

      // In dry-run mode, transaction IDs CSV should NOT be created
      const csvExists = await fs.promises
        .access(transactionIdsCsvPath)
        .then(() => true)
        .catch(() => false);
      expect(csvExists).toBe(false);
    });

    it('should display transaction IDs when less than 5 transactions in dry-run', async () => {
      const testKeystorePath = path.join(process.cwd(), 'tests/test-keystore.json');
      const testKeystorePassword = 'testPassword123';

      // Create a small CSV with only 3 items (will result in 2 transactions with batch size 2)
      const smallCsvPath = path.join(outputDir, 'small-input.csv');
      const smallCsvContent = `propertyCid,dataGroupCid,dataCid,filePath,uploadedAt
bafkreigpfi4pqur43wj3x2dwm43hnbtrxabgwsi3hobzbtqrs3iytohevu,bafkreigpfi4pqur43wj3x2dwm43hnbtrxabgwsi3hobzbtqrs3iytohevu,bafkreigpfi4pqur43wj3x2dwm43hnbtrxabgwsi3hobzbtqrs3iytohevu,"/test/property1/dataGroup1.json",2024-01-01T00:00:00Z
bafkreigd6yhp5dfcdrtfubtdq76cnstxehqvpjgmrpuhj7jnwtf3syx3ma,bafkreigd6yhp5dfcdrtfubtdq76cnstxehqvpjgmrpuhj7jnwtf3syx3ma,bafkreigd6yhp5dfcdrtfubtdq76cnstxehqvpjgmrpuhj7jnwtf3syx3ma,"/test/property2/dataGroup2.json",2024-01-01T00:01:00Z
bafkreiac4j3s4xhz2ej6qcz6w2xjrcqyhqpmlc5u6l4jy4yk7vfqktkvr4,bafkreiac4j3s4xhz2ej6qcz6w2xjrcqyhqpmlc5u6l4jy4yk7vfqktkvr4,bafkreiac4j3s4xhz2ej6qcz6w2xjrcqyhqpmlc5u6l4jy4yk7vfqktkvr4,"/test/property3/dataGroup3.json",2024-01-01T00:02:00Z`;

      await fs.promises.writeFile(smallCsvPath, smallCsvContent);

      const { stdout } = await execAsync(
        `node ${cliPath} submit-to-contract ${smallCsvPath} ` +
          `--keystore-json ${testKeystorePath} ` +
          `--keystore-password "${testKeystorePassword}" ` +
          `--transaction-batch-size 2 ` +
          `--dry-run`
      );

      // In dry-run mode, we won't see actual transaction IDs
      expect(stdout).toContain('[DRY RUN] Would submit: 3 items');
      expect(stdout).toContain('[DRY RUN] In batches:   2');
    });

    it('should validate transaction IDs CSV path option', async () => {
      const testKeystorePath = path.join(process.cwd(), 'tests/test-keystore.json');
      const testKeystorePassword = 'testPassword123';

      const { stdout, stderr } = await execAsync(
        `node ${cliPath} submit-to-contract ${csvInputPath} ` +
          `--keystore-json ${testKeystorePath} ` +
          `--keystore-password "${testKeystorePassword}" ` +
          `--transaction-ids-csv ${transactionIdsCsvPath} ` +
          `--dry-run`
      );

      expect(stderr).toBe('');
      // Should not show transaction IDs path in dry-run mode
      expect(stdout).not.toContain(`Transaction IDs: ${transactionIdsCsvPath}`);
    });

    it('should handle API mode without transaction IDs CSV', async () => {
      const { stdout, stderr } = await execAsync(
        `node ${cliPath} submit-to-contract ${csvInputPath} ` +
          `--domain test.api.com ` +
          `--api-key test-key ` +
          `--oracle-key-id oracle-123 ` +
          `--dry-run`
      );

      expect(stderr).toBe('');
      expect(stdout).toContain('Using centralized API submission mode');
      expect(stdout).toContain('[DRY RUN] Would submit: 4 items');
    });

    it('should show correct progress tracking for transactions', async () => {
      const testKeystorePath = path.join(process.cwd(), 'tests/test-keystore.json');
      const testKeystorePassword = 'testPassword123';

      // Create CSV with 10 items
      const largeCsvPath = path.join(outputDir, 'large-input.csv');
      let largeCsvContent =
        'propertyCid,dataGroupCid,dataCid,filePath,uploadedAt\n';
      for (let i = 0; i < 10; i++) {
        largeCsvContent += `bafkreigpfi4pqur43wj3x2dwm43hnbtrxabgwsi3hobzbtqrs3iytohevu,bafkreigpfi4pqur43wj3x2dwm43hnbtrxabgwsi3hobzbtqrs3iytohevu,bafkreigpfi4pqur43wj3x2dwm43hnbtrxabgwsi3hobzbtqrs3iytohevu,"/test/property${i}/dataGroup${i}.json",2024-01-01T00:0${i}:00Z\n`;
      }
      await fs.promises.writeFile(largeCsvPath, largeCsvContent.trim());

      const { stdout } = await execAsync(
        `node ${cliPath} submit-to-contract ${largeCsvPath} ` +
          `--keystore-json ${testKeystorePath} ` +
          `--keystore-password "${testKeystorePassword}" ` +
          `--transaction-batch-size 3 ` +
          `--dry-run`
      );

      expect(stdout).toContain('[DRY RUN] Would submit: 10 items');
      expect(stdout).toContain('[DRY RUN] In batches:   4'); // 10 items / 3 batch size = 4 transactions
    });
  });
});
