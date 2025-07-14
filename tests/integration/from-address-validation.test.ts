import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import { writeFileSync, unlinkSync, existsSync } from 'fs';
import path from 'path';

describe('--from-address validation', () => {
  const testCsvPath = path.join(process.cwd(), 'test-validation.csv');
  const testJsonPath = path.join(process.cwd(), 'test-unsigned.json');

  const validCsvContent = `propertyCid,dataGroupCid,dataCid,filePath,uploadedAt
bafkreigpfi4pqur43wj3x2dwm43hnbtrxabgwsi3hobzbtqrs3iytohevu,bafkreigpfi4pqur43wj3x2dwm43hnbtrxabgwsi3hobzbtqrs3iytohevu,bafkreigpfi4pqur43wj3x2dwm43hnbtrxabgwsi3hobzbtqrs3iytohevu,"/test/property1/dataGroup1.json",2024-01-01T00:00:00Z`;

  beforeEach(() => {
    // Create test CSV file
    writeFileSync(testCsvPath, validCsvContent);
  });

  afterEach(() => {
    // Clean up test files
    if (existsSync(testCsvPath)) {
      unlinkSync(testCsvPath);
    }
    if (existsSync(testJsonPath)) {
      unlinkSync(testJsonPath);
    }
  });

  it('should reject invalid from-address format - no 0x prefix', () => {
    const command = `./bin/elephant-cli submit-to-contract ${testCsvPath} --dry-run --unsigned-transactions-json ${testJsonPath} --from-address 742d35Cc6634C0532925a3b844Bc9e7595f89ce0`;

    expect(() => {
      execSync(command, {
        cwd: process.cwd(),
        stdio: 'pipe',
        encoding: 'utf8',
      });
    }).toThrow();

    // Verify the error message contains the expected validation error
    try {
      execSync(command, {
        cwd: process.cwd(),
        stdio: 'pipe',
        encoding: 'utf8',
      });
    } catch (error: any) {
      expect(error.stdout || error.stderr).toMatch(
        /Invalid from-address format/
      );
    }
  });

  it('should reject invalid from-address format - wrong length', () => {
    const command = `./bin/elephant-cli submit-to-contract ${testCsvPath} --dry-run --unsigned-transactions-json ${testJsonPath} --from-address 0x742d35Cc6634C0532925a3b844Bc9e7595f89ce`;

    expect(() => {
      execSync(command, {
        cwd: process.cwd(),
        stdio: 'pipe',
        encoding: 'utf8',
      });
    }).toThrow();

    try {
      execSync(command, {
        cwd: process.cwd(),
        stdio: 'pipe',
        encoding: 'utf8',
      });
    } catch (error: any) {
      expect(error.stdout || error.stderr).toMatch(
        /Invalid from-address format/
      );
    }
  });

  it('should reject invalid from-address format - invalid characters', () => {
    const command = `./bin/elephant-cli submit-to-contract ${testCsvPath} --dry-run --unsigned-transactions-json ${testJsonPath} --from-address 0x742d35Cc6634C0532925a3b844Bc9e7595f89cG0`;

    expect(() => {
      execSync(command, {
        cwd: process.cwd(),
        stdio: 'pipe',
        encoding: 'utf8',
      });
    }).toThrow();

    try {
      execSync(command, {
        cwd: process.cwd(),
        stdio: 'pipe',
        encoding: 'utf8',
      });
    } catch (error: any) {
      expect(error.stdout || error.stderr).toMatch(
        /Invalid from-address format/
      );
    }
  });

  it('should accept valid from-address format', () => {
    const command = `./bin/elephant-cli submit-to-contract ${testCsvPath} --dry-run --unsigned-transactions-json ${testJsonPath} --from-address 0x742d35Cc6634C0532925a3b844Bc9e7595f89ce0`;

    // Should not throw an error
    expect(() => {
      execSync(command, {
        cwd: process.cwd(),
        stdio: 'pipe',
        encoding: 'utf8',
      });
    }).not.toThrow();

    // Verify unsigned transactions JSON was created
    expect(existsSync(testJsonPath)).toBe(true);
  });

  it('should require private key when from-address is not provided', () => {
    const command = `./bin/elephant-cli submit-to-contract ${testCsvPath} --dry-run --unsigned-transactions-json ${testJsonPath}`;

    try {
      const result = execSync(command, {
        cwd: process.cwd(),
        stdio: 'pipe',
        encoding: 'utf8',
      });
      // If it doesn't throw, the test should fail
      expect(result).toBe('should have thrown an error');
    } catch (error: any) {
      // Should throw with private key required error
      expect(error.status).not.toBe(0);
      const output = error.stdout || error.stderr || '';
      expect(output).toMatch(/Private key is required/);
    }
  });

  it('should require private key when not in unsigned transaction mode', () => {
    const command = `./bin/elephant-cli submit-to-contract ${testCsvPath} --dry-run --from-address 0x742d35Cc6634C0532925a3b844Bc9e7595f89ce0`;

    try {
      const result = execSync(command, {
        cwd: process.cwd(),
        stdio: 'pipe',
        encoding: 'utf8',
      });
      // If it doesn't throw, the test should fail
      expect(result).toBe('should have thrown an error');
    } catch (error: any) {
      // Should throw with private key required error
      expect(error.status).not.toBe(0);
      const output = error.stdout || error.stderr || '';
      expect(output).toMatch(/Private key is required/);
    }
  });

  it('should validate that unsigned-transactions-json requires dry-run mode', () => {
    const command = `./bin/elephant-cli submit-to-contract ${testCsvPath} --unsigned-transactions-json ${testJsonPath} --from-address 0x742d35Cc6634C0532925a3b844Bc9e7595f89ce0 --private-key 0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890`;

    expect(() => {
      execSync(command, {
        cwd: process.cwd(),
        stdio: 'pipe',
        encoding: 'utf8',
      });
    }).toThrow();

    try {
      execSync(command, {
        cwd: process.cwd(),
        stdio: 'pipe',
        encoding: 'utf8',
      });
    } catch (error: any) {
      expect(error.stdout || error.stderr).toMatch(
        /can only be used with --dry-run mode/
      );
    }
  });
});
