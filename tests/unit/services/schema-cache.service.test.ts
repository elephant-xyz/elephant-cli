import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';

vi.mock('../../../src/utils/schema-fetcher.js', () => {
  return {
    fetchFromIpfs: vi.fn(),
  };
});

import { SchemaCacheService, JSONSchema } from '../../../src/services/schema-cache.service';
import { fetchFromIpfs } from '../../../src/utils/schema-fetcher.js';

describe('SchemaCacheService', () => {
  let schemaCacheService: SchemaCacheService;
  let cacheDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    cacheDir = path.join(process.cwd(), 'tmp', `schema-cache-${Math.random().toString(36).slice(2)}`);
    fs.mkdirSync(cacheDir, { recursive: true });
    schemaCacheService = new SchemaCacheService(cacheDir);
  });

  afterEach(() => {
    if (cacheDir && fs.existsSync(cacheDir)) {
      fs.rmSync(cacheDir, { recursive: true, force: true });
    }
  });

  describe('has method', () => {
    it('should return false for non-existent entries', () => {
      expect(schemaCacheService.has('non-existent')).toBe(false);
    });

    it('should return true for cached entries', async () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: { test: { type: 'string' } },
      };
      (fetchFromIpfs as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(JSON.stringify(schema));

      await schemaCacheService.get('test-cid');
      expect(schemaCacheService.has('test-cid')).toBe(true);
    });
  });

  describe('get', () => {
    it('should download and cache schema on first request', async () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
          age: { type: 'number' },
        },
        required: ['name'],
      };

      (fetchFromIpfs as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(JSON.stringify(schema));

      const result = await schemaCacheService.get('test-cid');

      expect(fetchFromIpfs).toHaveBeenCalledWith('test-cid');
      expect(result).toEqual(schema);
      expect(schemaCacheService.has('test-cid')).toBe(true);
    });

    it('should return cached schema on subsequent requests', async () => {
      const schema: JSONSchema = { type: 'object' };
      (fetchFromIpfs as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(JSON.stringify(schema));

      const result1 = await schemaCacheService.get('test-cid');
      expect(fetchFromIpfs).toHaveBeenCalledTimes(1);

      const result2 = await schemaCacheService.get('test-cid');
      expect(fetchFromIpfs).toHaveBeenCalledTimes(1);
      expect(result2).toEqual(schema);
      expect(result1).toEqual(result2);
    });

    it('should handle JSON parsing errors', async () => {
      (fetchFromIpfs as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce('invalid json');

      await expect(schemaCacheService.get('invalid-cid')).rejects.toThrow();
    });

    it('should handle IPFS download errors', async () => {
      (fetchFromIpfs as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Network error'));

      await expect(schemaCacheService.get('error-cid')).rejects.toThrow('Network error');
    });

    it('should reject non-object schemas', async () => {
      (fetchFromIpfs as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce('"not an object"');

      await expect(schemaCacheService.get('string-cid')).rejects.toThrow(
        'Invalid JSON schema: not an object'
      );
    });

    it('should reject null schemas', async () => {
      (fetchFromIpfs as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce('null');

      await expect(schemaCacheService.get('null-cid')).rejects.toThrow(
        'Invalid JSON schema: not an object'
      );
    });
  });
});

