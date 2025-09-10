import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn } from 'child_process';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('submit-to-contract command - API validation', () => {
  let testDir: string;
  let csvPath: string;

  beforeEach(() => {
    // Create test directory
    testDir = join(tmpdir(), `elephant-cli-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });

    // Create test CSV
    csvPath = join(testDir, 'test-data.csv');
    const csvContent = `propertyCid,dataGroupCid,dataCid,filePath,uploadedAt
QmProperty1,QmDataGroup1,QmData1,/path/to/file1.json,2024-01-01T00:00:00Z`;
    writeFileSync(csvPath, csvContent);
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('should reject private key when API parameters are provided', async () => {
    const result = await runCommand([
      'submit-to-contract',
      csvPath,
      '--private-key',
      '0x' + '1'.repeat(64),
      '--domain',
      'oracles.staircaseapi.com',
      '--api-key',
      'test-api-key',
      '--oracle-key-id',
      '550e8400-e29b-41d4-a716-446655440000',
      '--dry-run',
    ]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain(
      'Private key or keystore should not be provided when using API mode'
    );
  });

  it('should require all three API parameters together', async () => {
    const result = await runCommand([
      'submit-to-contract',
      csvPath,
      '--domain',
      'oracles.staircaseapi.com',
      '--api-key',
      'test-api-key',
      // Missing oracle-key-id
      '--dry-run',
    ]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('all three parameters must be provided');
  });

  it('should work without private key in API mode', async () => {
    const result = await runCommand(
      [
        'submit-to-contract',
        csvPath,
        '--domain',
        'oracles.staircaseapi.com',
        '--api-key',
        'test-api-key',
        '--oracle-key-id',
        '550e8400-e29b-41d4-a716-446655440000',
        '--from-address',
        '0x1234567890123456789012345678901234567890',
        '--dry-run',
      ],
      { ELEPHANT_PRIVATE_KEY: undefined }
    ); // Clear env var

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Contract submission process finished');
    expect(result.stdout).toContain('Using centralized API submission mode');
  });

  it('should ignore ELEPHANT_PRIVATE_KEY env var in API mode', async () => {
    const result = await runCommand(
      [
        'submit-to-contract',
        csvPath,
        '--domain',
        'oracles.staircaseapi.com',
        '--api-key',
        'test-api-key',
        '--oracle-key-id',
        '550e8400-e29b-41d4-a716-446655440000',
        '--from-address',
        '0x1234567890123456789012345678901234567890',
        '--dry-run',
      ],
      {
        ELEPHANT_PRIVATE_KEY:
          'c653a42f9b89ef1e39166e97ba00ae1449d3933f7c3b7a02d72d48a9c4da8f46',
      }
    ); // Set env var

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Contract submission process finished');
    expect(result.stdout).toContain('Using centralized API submission mode');
    expect(result.stdout).toContain(
      'Ignoring ELEPHANT_PRIVATE_KEY environment variable'
    );
  });
});

function runCommand(
  args: string[],
  env: Record<string, string | undefined> = {}
): Promise<{
  code: number | null;
  stdout: string;
  stderr: string;
}> {
  return new Promise((resolve) => {
    // Create a copy of process.env and apply overrides
    const finalEnv = { ...process.env };
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) {
        delete finalEnv[key];
      } else {
        finalEnv[key] = value;
      }
    }

    const child = spawn('./bin/elephant-cli', args, {
      env: finalEnv,
      cwd: process.cwd(),
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}
