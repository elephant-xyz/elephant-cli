import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SchemaManifestService } from '../../../src/services/schema-manifest.service.js';

// Mock fetch globally
global.fetch = vi.fn();

describe('SchemaManifestService', () => {
  let service: SchemaManifestService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new SchemaManifestService();
  });

  describe('loadSchemaManifest', () => {
    it('should load and cache schema manifest', async () => {
      const mockManifest = {
        Photo_Metadata: {
          ipfsCid: 'bafkreiabc123',
          type: 'dataGroup' as const,
        },
        Property_Details: {
          ipfsCid: 'bafkreidef456',
          type: 'dataGroup' as const,
        },
        Some_Class: {
          ipfsCid: 'bafkreighi789',
          type: 'class' as const,
        },
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockManifest,
      });

      const result = await service.loadSchemaManifest();

      expect(result).toEqual(mockManifest);
      expect(global.fetch).toHaveBeenCalledWith(
        'https://lexicon.elephant.xyz/json-schemas/schema-manifest.json'
      );
    });

    it('should return cached manifest on subsequent calls', async () => {
      const mockManifest = {
        Photo_Metadata: {
          ipfsCid: 'bafkreiabc123',
          type: 'dataGroup' as const,
        },
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockManifest,
      });

      await service.loadSchemaManifest();
      const result = await service.loadSchemaManifest();

      expect(result).toEqual(mockManifest);
      expect(global.fetch).toHaveBeenCalledTimes(1); // Only called once
    });

    it('should throw error when fetch fails', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      await expect(service.loadSchemaManifest()).rejects.toThrow(
        'Failed to load schema manifest from Elephant Network'
      );
    });
  });

  describe('getDataGroupCidByLabel', () => {
    it('should return CID for matching datagroup label', async () => {
      const mockManifest = {
        Photo_Metadata: {
          ipfsCid: 'bafkreiabc123',
          type: 'dataGroup' as const,
        },
        Property_Details: {
          ipfsCid: 'bafkreidef456',
          type: 'dataGroup' as const,
        },
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockManifest,
      });

      await service.loadSchemaManifest();
      const cid = service.getDataGroupCidByLabel('Photo_Metadata');

      expect(cid).toBe('bafkreiabc123');
    });

    it('should return null for non-existent label', async () => {
      const mockManifest = {
        Photo_Metadata: {
          ipfsCid: 'bafkreiabc123',
          type: 'dataGroup' as const,
        },
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockManifest,
      });

      await service.loadSchemaManifest();
      const cid = service.getDataGroupCidByLabel('Non_Existent');

      expect(cid).toBeNull();
    });

    it('should throw error if manifest not loaded', () => {
      expect(() => service.getDataGroupCidByLabel('Photo_Metadata')).toThrow(
        'Schema manifest not loaded. Call loadSchemaManifest() first.'
      );
    });
  });

  describe('isDataGroupRootFile', () => {
    it('should return true for valid datagroup structure', () => {
      const validData = {
        label: 'Photo Metadata',
        relationships: {
          property: { '/': 'some-cid' },
        },
      };

      expect(SchemaManifestService.isDataGroupRootFile(validData)).toBe(true);
    });

    it('should return false for data with additional keys', () => {
      const invalidData = {
        label: 'Photo Metadata',
        relationships: {},
        extraKey: 'value',
      };

      expect(SchemaManifestService.isDataGroupRootFile(invalidData)).toBe(
        false
      );
    });

    it('should return false for data missing label', () => {
      const invalidData = {
        relationships: {},
      };

      expect(SchemaManifestService.isDataGroupRootFile(invalidData)).toBe(
        false
      );
    });

    it('should return false for data missing relationships', () => {
      const invalidData = {
        label: 'Photo Metadata',
      };

      expect(SchemaManifestService.isDataGroupRootFile(invalidData)).toBe(
        false
      );
    });

    it('should return false for non-object data', () => {
      expect(SchemaManifestService.isDataGroupRootFile(null)).toBe(false);
      expect(SchemaManifestService.isDataGroupRootFile(undefined)).toBe(false);
      expect(SchemaManifestService.isDataGroupRootFile('string')).toBe(false);
      expect(SchemaManifestService.isDataGroupRootFile(123)).toBe(false);
      expect(SchemaManifestService.isDataGroupRootFile([])).toBe(false);
    });

    it('should return false when label is not a string', () => {
      const invalidData = {
        label: 123,
        relationships: {},
      };

      expect(SchemaManifestService.isDataGroupRootFile(invalidData)).toBe(
        false
      );
    });

    it('should return false when relationships is not an object', () => {
      const invalidData = {
        label: 'Photo Metadata',
        relationships: 'not an object',
      };

      expect(SchemaManifestService.isDataGroupRootFile(invalidData)).toBe(
        false
      );
    });
  });
});
