import { describe, it, expect, beforeEach, vi } from 'vitest';
import { JsonValidatorService } from '../../../src/services/json-validator.service.js';
import { IPFSService } from '../../../src/services/ipfs.service.js';
import { writeFileSync, mkdirSync } from 'fs';
import path from 'path';

describe('JsonValidatorService - Optional Relationships', () => {
  let jsonValidator: JsonValidatorService;
  let mockIPFSService: IPFSService;
  let tempDir: string;

  beforeEach(() => {
    mockIPFSService = {
      fetchContent: vi.fn(),
    } as any;

    // Create a temporary directory for test files
    tempDir = path.join(process.cwd(), 'tmp', 'test-optional-relationships');
    mkdirSync(tempDir, { recursive: true });

    jsonValidator = new JsonValidatorService(mockIPFSService, tempDir);
  });

  it('should handle invalid relationship data when CID pointer is used', async () => {
    const relationshipSchema = {
      type: 'object',
      properties: {
        from: {
          type: 'object',
          properties: {
            required_field: { type: 'string' },
          },
          required: ['required_field'],
        },
      },
      required: ['from'],
    };

    const mainSchema = {
      type: 'object',
      properties: {
        relationships: {
          type: 'object',
          properties: {
            test_relationship: {
              type: ['string', 'null'],
              cid: 'test-relationship-cid',
            },
          },
        },
      },
    };

    // Mock IPFS service to return the relationship schema
    (mockIPFSService.fetchContent as any).mockResolvedValue(
      Buffer.from(JSON.stringify(relationshipSchema))
    );

    // Test data with invalid relationship data (missing required field)
    const dataWithInvalidRelationship = {
      relationships: {
        test_relationship: {
          '/': './invalid_relationship.json',
        },
      },
    };

    // Write invalid relationship file to the temp directory
    const invalidRelationshipFilePath = path.join(
      tempDir,
      'invalid_relationship.json'
    );
    writeFileSync(invalidRelationshipFilePath, JSON.stringify({ from: {} })); // Missing required_field

    // Test: Invalid relationship data should fail validation
    const testFilePath = path.join(tempDir, 'test-file.json');
    const result = await jsonValidator.validate(
      dataWithInvalidRelationship,
      mainSchema,
      testFilePath
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors!.length).toBeGreaterThan(0);
  });
});
