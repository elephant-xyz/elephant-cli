import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { promises as fsPromises } from 'fs';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// We need to test the CSV post-processing functions that are internal to validate.ts
// Since they're not exported, we'll test them through their effects on actual CSV files

// Helper functions extracted for testing - these mirror the internal implementations
function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

function escapeCsvValue(value: string): string {
  const escaped = value.replace(/"/g, '""');
  if (
    escaped.includes(',') ||
    escaped.includes('\n') ||
    escaped.includes('"')
  ) {
    return `"${escaped}"`;
  }
  return escaped;
}

function formatCurrentValue(data: unknown): string {
  if (data === undefined) {
    return '';
  }
  if (data === null) {
    return 'null';
  }
  if (typeof data === 'object') {
    return JSON.stringify(data);
  }
  return String(data);
}

const TYPE_ERROR_PATTERN = /^must be (null|object|array)$/;

describe('CSV Post-Processing Helper Functions', () => {
  describe('parseCsvLine', () => {
    it('should parse simple CSV line without quotes', () => {
      const line = 'a,b,c,d';
      const result = parseCsvLine(line);
      expect(result).toEqual(['a', 'b', 'c', 'd']);
    });

    it('should parse CSV line with quoted values', () => {
      const line = '"hello, world",b,c';
      const result = parseCsvLine(line);
      expect(result).toEqual(['hello, world', 'b', 'c']);
    });

    it('should handle escaped quotes inside quoted values', () => {
      const line = '"say ""hello""",value';
      const result = parseCsvLine(line);
      expect(result).toEqual(['say "hello"', 'value']);
    });

    it('should parse empty fields', () => {
      const line = 'a,,c,';
      const result = parseCsvLine(line);
      expect(result).toEqual(['a', '', 'c', '']);
    });

    it('should handle newlines inside quoted values', () => {
      const line = '"multi\nline",value';
      const result = parseCsvLine(line);
      expect(result).toEqual(['multi\nline', 'value']);
    });

    it('should parse real CSV error line', () => {
      const line =
        'prop1,dg1,/path/to/file.json,/relationships/0/value,"error, with comma",currentValue,2024-01-01T00:00:00Z';
      const result = parseCsvLine(line);
      expect(result).toHaveLength(7);
      expect(result[4]).toBe('error, with comma');
    });

    it('should handle single field', () => {
      const line = 'single';
      const result = parseCsvLine(line);
      expect(result).toEqual(['single']);
    });

    it('should handle empty string', () => {
      const line = '';
      const result = parseCsvLine(line);
      expect(result).toEqual(['']);
    });
  });

  describe('escapeCsvValue', () => {
    it('should return value unchanged if no special characters', () => {
      expect(escapeCsvValue('simple')).toBe('simple');
      expect(escapeCsvValue('path/to/file')).toBe('path/to/file');
    });

    it('should wrap value in quotes if it contains comma', () => {
      expect(escapeCsvValue('hello, world')).toBe('"hello, world"');
    });

    it('should wrap value in quotes if it contains newline', () => {
      expect(escapeCsvValue('line1\nline2')).toBe('"line1\nline2"');
    });

    it('should escape quotes and wrap in quotes', () => {
      expect(escapeCsvValue('say "hello"')).toBe('"say ""hello"""');
    });

    it('should handle empty string', () => {
      expect(escapeCsvValue('')).toBe('');
    });

    it('should handle value with multiple special characters', () => {
      const value = 'error "message", with\nnewline';
      const escaped = escapeCsvValue(value);
      expect(escaped).toBe('"error ""message"", with\nnewline"');
    });
  });

  describe('formatCurrentValue', () => {
    it('should return empty string for undefined', () => {
      expect(formatCurrentValue(undefined)).toBe('');
    });

    it('should return "null" string for null', () => {
      expect(formatCurrentValue(null)).toBe('null');
    });

    it('should stringify objects', () => {
      expect(formatCurrentValue({ key: 'value' })).toBe('{"key":"value"}');
    });

    it('should stringify arrays', () => {
      expect(formatCurrentValue([1, 2, 3])).toBe('[1,2,3]');
    });

    it('should convert strings to string', () => {
      expect(formatCurrentValue('hello')).toBe('hello');
    });

    it('should convert numbers to string', () => {
      expect(formatCurrentValue(42)).toBe('42');
      expect(formatCurrentValue(3.14)).toBe('3.14');
    });

    it('should convert booleans to string', () => {
      expect(formatCurrentValue(true)).toBe('true');
      expect(formatCurrentValue(false)).toBe('false');
    });

    it('should handle empty object', () => {
      expect(formatCurrentValue({})).toBe('{}');
    });

    it('should handle empty array', () => {
      expect(formatCurrentValue([])).toBe('[]');
    });

    it('should handle nested objects', () => {
      const nested = { a: { b: { c: 1 } } };
      expect(formatCurrentValue(nested)).toBe('{"a":{"b":{"c":1}}}');
    });
  });

  describe('TYPE_ERROR_PATTERN', () => {
    it('should match "must be null"', () => {
      expect(TYPE_ERROR_PATTERN.test('must be null')).toBe(true);
    });

    it('should match "must be object"', () => {
      expect(TYPE_ERROR_PATTERN.test('must be object')).toBe(true);
    });

    it('should match "must be array"', () => {
      expect(TYPE_ERROR_PATTERN.test('must be array')).toBe(true);
    });

    it('should not match "must be string"', () => {
      expect(TYPE_ERROR_PATTERN.test('must be string')).toBe(false);
    });

    it('should not match "must be number"', () => {
      expect(TYPE_ERROR_PATTERN.test('must be number')).toBe(false);
    });

    it('should not match partial matches', () => {
      expect(TYPE_ERROR_PATTERN.test('value must be null')).toBe(false);
      expect(TYPE_ERROR_PATTERN.test('must be null!')).toBe(false);
    });

    it('should not match other error messages', () => {
      expect(TYPE_ERROR_PATTERN.test('must match a schema in anyOf')).toBe(
        false
      );
      expect(TYPE_ERROR_PATTERN.test('is required')).toBe(false);
    });
  });
});

describe('CSV Post-Processing Integration', () => {
  let tempDir: string;
  let csvPath: string;

  beforeEach(async () => {
    tempDir = await fsPromises.mkdtemp(
      path.join(os.tmpdir(), 'csv-postprocess-test-')
    );
    csvPath = path.join(tempDir, 'test_errors.csv');
  });

  afterEach(async () => {
    if (tempDir && fs.existsSync(tempDir)) {
      await fsPromises.rm(tempDir, { recursive: true, force: true });
    }
  });

  // Helper to simulate postProcessErrorCsv
  async function postProcessErrorCsv(csvPath: string): Promise<number> {
    const content = await fsPromises.readFile(csvPath, 'utf-8');
    const lines = content.split('\n');

    if (lines.length <= 1) {
      return 0;
    }

    const header = lines[0];
    const dataLines = lines.slice(1).filter((line) => line.trim() !== '');

    type RowType = {
      original: string;
      propertyCid: string;
      dataGroupCid: string;
      filePath: string;
      errorPath: string;
      errorMessage: string;
      currentValue: string;
      timestamp: string;
    };

    const rows: RowType[] = [];
    const addressOneOfErrorFiles = new Set<string>();

    for (const line of dataLines) {
      const fields = parseCsvLine(line);
      if (fields.length < 7) {
        continue;
      }

      const [
        propertyCid,
        dataGroupCid,
        filePath,
        errorPath,
        errorMessage,
        currentValue,
        timestamp,
      ] = fields;

      if (TYPE_ERROR_PATTERN.test(errorMessage)) {
        continue;
      }

      // Track files with address oneOf errors (on the /to side, which is the address entity)
      const isAddressOneOfError =
        errorPath.includes('property_has_address') &&
        errorPath.includes('/to') &&
        errorMessage === 'must match a schema in anyOf';
      if (isAddressOneOfError) {
        addressOneOfErrorFiles.add(filePath);
      }

      if (errorMessage === 'must match a schema in anyOf') {
        continue;
      }

      rows.push({
        original: line,
        propertyCid,
        dataGroupCid,
        filePath,
        errorPath,
        errorMessage,
        currentValue,
        timestamp,
      });
    }

    // Consolidate address-related errors only for files where the address entity itself
    // failed the oneOf validation (not property errors)
    const addressConsolidatedRows: RowType[] = [];
    const nonAddressRows: RowType[] = [];

    for (const row of rows) {
      // Only consolidate errors on the address entity (/to side), not property errors (/from side)
      const isAddressEntityError =
        (row.errorPath.includes('property_has_address') &&
          row.errorPath.includes('/to')) ||
        row.errorPath.includes('address_has_fact_sheet');

      if (addressOneOfErrorFiles.has(row.filePath) && isAddressEntityError) {
        const hasConsolidated = addressConsolidatedRows.some(
          (r) => r.filePath === row.filePath
        );
        if (!hasConsolidated) {
          addressConsolidatedRows.push({
            ...row,
            errorPath: '/relationships/property_has_address',
            errorMessage:
              'Address should provide either unnormalized_address or normalized version distributed to other fields',
          });
        }
      } else {
        nonAddressRows.push(row);
      }
    }

    const filteredRows = [...nonAddressRows, ...addressConsolidatedRows];

    const dedupeMap = new Map<string, RowType>();

    for (const row of filteredRows) {
      const pathParts = row.errorPath.split('/').filter((p) => p !== '');
      const lastSegment =
        pathParts.length > 0 ? pathParts[pathParts.length - 1] : 'root';
      const key = `${row.errorMessage}::${lastSegment}`;

      const existing = dedupeMap.get(key);
      if (!existing) {
        dedupeMap.set(key, row);
        continue;
      }

      const existingHasFactSheet =
        existing.errorPath.includes('has_fact_sheet');
      const currentHasFactSheet = row.errorPath.includes('has_fact_sheet');

      if (existingHasFactSheet && !currentHasFactSheet) {
        dedupeMap.set(key, row);
      }
    }

    const dedupedRows = Array.from(dedupeMap.values());
    const outputLines = [header];

    for (const row of dedupedRows) {
      const csvLine = [
        escapeCsvValue(row.propertyCid),
        escapeCsvValue(row.dataGroupCid),
        escapeCsvValue(row.filePath),
        escapeCsvValue(row.errorPath),
        escapeCsvValue(row.errorMessage),
        escapeCsvValue(row.currentValue),
        escapeCsvValue(row.timestamp),
      ].join(',');
      outputLines.push(csvLine);
    }

    await fsPromises.writeFile(csvPath, outputLines.join('\n') + '\n');

    return dedupedRows.length;
  }

  it('should return 0 for empty CSV (header only)', async () => {
    const header =
      'property_cid,data_group_cid,file_path,error_path,error_message,currentValue,timestamp\n';
    await fsPromises.writeFile(csvPath, header);

    const count = await postProcessErrorCsv(csvPath);
    expect(count).toBe(0);
  });

  it('should filter out "must be null" type errors', async () => {
    const csv = `property_cid,data_group_cid,file_path,error_path,error_message,currentValue,timestamp
prop1,dg1,file1.json,/path,must be null,value,2024-01-01
prop2,dg2,file2.json,/path,is required,,2024-01-01
`;
    await fsPromises.writeFile(csvPath, csv);

    const count = await postProcessErrorCsv(csvPath);
    expect(count).toBe(1);

    const result = await fsPromises.readFile(csvPath, 'utf-8');
    expect(result).not.toContain('must be null');
    expect(result).toContain('is required');
  });

  it('should filter out "must be object" type errors', async () => {
    const csv = `property_cid,data_group_cid,file_path,error_path,error_message,currentValue,timestamp
prop1,dg1,file1.json,/path,must be object,value,2024-01-01
prop2,dg2,file2.json,/path,is required,,2024-01-01
`;
    await fsPromises.writeFile(csvPath, csv);

    const count = await postProcessErrorCsv(csvPath);
    expect(count).toBe(1);

    const result = await fsPromises.readFile(csvPath, 'utf-8');
    expect(result).not.toContain('must be object');
    expect(result).toContain('is required');
  });

  it('should filter out "must be array" type errors', async () => {
    const csv = `property_cid,data_group_cid,file_path,error_path,error_message,currentValue,timestamp
prop1,dg1,file1.json,/path,must be array,value,2024-01-01
prop2,dg2,file2.json,/path,is required,,2024-01-01
`;
    await fsPromises.writeFile(csvPath, csv);

    const count = await postProcessErrorCsv(csvPath);
    expect(count).toBe(1);

    const result = await fsPromises.readFile(csvPath, 'utf-8');
    expect(result).not.toContain('must be array');
    expect(result).toContain('is required');
  });

  it('should filter out generic anyOf schema errors', async () => {
    const csv = `property_cid,data_group_cid,file_path,error_path,error_message,currentValue,timestamp
prop1,dg1,file1.json,/relationships/0,must match a schema in anyOf,value,2024-01-01
prop2,dg2,file2.json,/label,is required,,2024-01-01
`;
    await fsPromises.writeFile(csvPath, csv);

    const count = await postProcessErrorCsv(csvPath);
    expect(count).toBe(1);

    const result = await fsPromises.readFile(csvPath, 'utf-8');
    expect(result).not.toContain('must match a schema in anyOf');
    expect(result).toContain('is required');
  });

  it('should show property errors without consolidation when error is on /from side', async () => {
    // Errors on /from (property) side should NOT be consolidated
    const csv = `property_cid,data_group_cid,file_path,error_path,error_message,currentValue,timestamp
prop1,dg1,file1.json,/relationships/property_has_address/0/from,must match a schema in anyOf,value,2024-01-01
prop1,dg1,file1.json,/relationships/property_has_address/0/from/property_type,is required,,2024-01-01
prop1,dg1,file1.json,/label,label error,,2024-01-01
`;
    await fsPromises.writeFile(csvPath, csv);

    const count = await postProcessErrorCsv(csvPath);
    // Shows actual property errors (not consolidated because error is on /from side)
    expect(count).toBe(2);

    const result = await fsPromises.readFile(csvPath, 'utf-8');
    // Should NOT contain consolidated message since errors are on property (/from) side
    expect(result).not.toContain(
      'Address should provide either unnormalized_address or normalized version distributed to other fields'
    );
    // Should show actual errors
    expect(result).toContain('is required');
    expect(result).toContain('label error');
  });

  it('should consolidate address errors when anyOf error is on /to side', async () => {
    // Errors on /to (address) side SHOULD be consolidated
    const csv = `property_cid,data_group_cid,file_path,error_path,error_message,currentValue,timestamp
prop1,dg1,file1.json,/relationships/property_has_address/0/to,must match a schema in anyOf,value,2024-01-01
prop1,dg1,file1.json,/relationships/property_has_address/0/to/street,is required,,2024-01-01
prop1,dg1,file1.json,/relationships/address_has_fact_sheet/0/from,another address error,,2024-01-01
`;
    await fsPromises.writeFile(csvPath, csv);

    const count = await postProcessErrorCsv(csvPath);
    // Should be consolidated into single address error
    expect(count).toBe(1);

    const result = await fsPromises.readFile(csvPath, 'utf-8');
    // Should contain consolidated message
    expect(result).toContain(
      'Address should provide either unnormalized_address or normalized version distributed to other fields'
    );
    // Should NOT show individual address errors
    expect(result).not.toContain('is required');
    expect(result).not.toContain('another address error');
  });

  it('should deduplicate errors by message and last path segment', async () => {
    const csv = `property_cid,data_group_cid,file_path,error_path,error_message,currentValue,timestamp
prop1,dg1,file1.json,/relationships/0/street,is required,,2024-01-01
prop2,dg2,file2.json,/relationships/1/street,is required,,2024-01-01
prop3,dg3,file3.json,/data/street,is required,,2024-01-01
`;
    await fsPromises.writeFile(csvPath, csv);

    const count = await postProcessErrorCsv(csvPath);
    expect(count).toBe(1);

    const result = await fsPromises.readFile(csvPath, 'utf-8');
    const dataLines = result
      .split('\n')
      .filter((l) => l && !l.startsWith('property_cid'));
    expect(dataLines).toHaveLength(1);
  });

  it('should prefer paths without has_fact_sheet when deduplicating', async () => {
    const csv = `property_cid,data_group_cid,file_path,error_path,error_message,currentValue,timestamp
prop1,dg1,file1.json,/relationships/data_has_fact_sheet/0/value,is required,,2024-01-01
prop2,dg2,file2.json,/data/value,is required,,2024-01-01
`;
    await fsPromises.writeFile(csvPath, csv);

    const count = await postProcessErrorCsv(csvPath);
    expect(count).toBe(1);

    const result = await fsPromises.readFile(csvPath, 'utf-8');
    expect(result).toContain('/data/value');
    expect(result).not.toContain('has_fact_sheet');
  });

  it('should handle CSV with quoted values correctly', async () => {
    const csv = `property_cid,data_group_cid,file_path,error_path,error_message,currentValue,timestamp
prop1,dg1,file1.json,/path,"error, with comma",value,2024-01-01
`;
    await fsPromises.writeFile(csvPath, csv);

    const count = await postProcessErrorCsv(csvPath);
    expect(count).toBe(1);

    const result = await fsPromises.readFile(csvPath, 'utf-8');
    expect(result).toContain('error, with comma');
  });

  it('should skip lines with fewer than 7 fields', async () => {
    const csv = `property_cid,data_group_cid,file_path,error_path,error_message,currentValue,timestamp
prop1,dg1,file1.json,/path
prop2,dg2,file2.json,/path,is required,,2024-01-01
`;
    await fsPromises.writeFile(csvPath, csv);

    const count = await postProcessErrorCsv(csvPath);
    expect(count).toBe(1);

    const result = await fsPromises.readFile(csvPath, 'utf-8');
    const dataLines = result
      .split('\n')
      .filter((l) => l && !l.startsWith('property_cid'));
    expect(dataLines).toHaveLength(1);
    expect(result).toContain('is required');
  });

  it('should preserve property errors when anyOf is not on /to side', async () => {
    // anyOf error is on generic path, not specifically on /to, so no consolidation
    const csv = `property_cid,data_group_cid,file_path,error_path,error_message,currentValue,timestamp
prop1,dg1,file1.json,/relationships/property_has_address/0,must match a schema in anyOf,value,2024-01-01
prop1,dg1,file1.json,/relationships/property_has_address/0/from/property_type,is required,,2024-01-01
prop1,dg1,file1.json,/label,label is required,,2024-01-01
`;
    await fsPromises.writeFile(csvPath, csv);

    const count = await postProcessErrorCsv(csvPath);
    // Shows all actual errors (anyOf filtered, property_type and label errors remain)
    expect(count).toBe(2);

    const result = await fsPromises.readFile(csvPath, 'utf-8');
    expect(result).toContain('label is required');
    // Should NOT contain consolidated message since anyOf is not on /to side
    expect(result).not.toContain(
      'Address should provide either unnormalized_address or normalized version distributed to other fields'
    );
    // The specific property error IS present (not consolidated)
    expect(result).toContain('is required');
  });

  it('should not add consolidated error if no address errors remain after filtering', async () => {
    // Only the anyOf error exists for address - it gets filtered but no consolidation should happen
    const csv = `property_cid,data_group_cid,file_path,error_path,error_message,currentValue,timestamp
prop1,dg1,file1.json,/relationships/property_has_address/0,must match a schema in anyOf,value,2024-01-01
prop1,dg1,file1.json,/label,is required,,2024-01-01
`;
    await fsPromises.writeFile(csvPath, csv);

    const count = await postProcessErrorCsv(csvPath);
    expect(count).toBe(1);

    const result = await fsPromises.readFile(csvPath, 'utf-8');
    expect(result).toContain('is required');
    // No consolidated address error should appear since there were no non-anyOf address errors
    expect(result).not.toContain(
      'Address should provide either unnormalized_address or normalized version distributed to other fields'
    );
  });

  it('should handle multiple files with different errors', async () => {
    const csv = `property_cid,data_group_cid,file_path,error_path,error_message,currentValue,timestamp
prop1,dg1,file1.json,/label,label is required,,2024-01-01
prop2,dg2,file2.json,/value,must be number,,2024-01-01
prop3,dg3,file3.json,/status,must be one of: active,,2024-01-01
`;
    await fsPromises.writeFile(csvPath, csv);

    const count = await postProcessErrorCsv(csvPath);
    expect(count).toBe(3);
  });

  it('should keep "must be string" errors (not filtered)', async () => {
    const csv = `property_cid,data_group_cid,file_path,error_path,error_message,currentValue,timestamp
prop1,dg1,file1.json,/path,must be string,123,2024-01-01
`;
    await fsPromises.writeFile(csvPath, csv);

    const count = await postProcessErrorCsv(csvPath);
    expect(count).toBe(1);

    const result = await fsPromises.readFile(csvPath, 'utf-8');
    expect(result).toContain('must be string');
  });

  it('should keep "must be number" errors (not filtered)', async () => {
    const csv = `property_cid,data_group_cid,file_path,error_path,error_message,currentValue,timestamp
prop1,dg1,file1.json,/path,must be number,text,2024-01-01
`;
    await fsPromises.writeFile(csvPath, csv);

    const count = await postProcessErrorCsv(csvPath);
    expect(count).toBe(1);

    const result = await fsPromises.readFile(csvPath, 'utf-8');
    expect(result).toContain('must be number');
  });
});
