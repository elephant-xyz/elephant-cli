import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { SchemaCacheService } from '../../../src/services/schema-cache.service.js';
import { SEED_DATAGROUP_SCHEMA_CID } from '../../../src/config/constants.js';

vi.mock('../../../src/utils/schema-fetcher.js', () => {
  return {
    fetchFromIpfs: vi.fn().mockImplementation(async (cid: string) => {
      if (cid === SEED_DATAGROUP_SCHEMA_CID) {
        // Return the actual seed datagroup schema
        return JSON.stringify({
          $schema: 'https://json-schema.org/draft-07/schema#',
          additionalProperties: false,
          description: 'JSON Schema for Seed data group',
          properties: {
            label: {
              description: 'Data group label',
              enum: ['Seed'],
              type: 'string',
            },
            relationships: {
              additionalProperties: false,
              description:
                'Object of relationships in this data group, keyed by relationship_type',
              properties: {
                property_seed: {
                  cid: 'bafkreidg2zay3yqoo7uh2q3kajvs4kyzig6txtdhug6kmf5g53kgqvkmhe',
                  description:
                    'Reference to property_seed_to_unnormalized_address relationship schema (required)',
                  type: 'string',
                },
              },
              required: ['property_seed'],
              type: 'object',
            },
          },
          required: ['label', 'relationships'],
          title: 'Seed',
          type: 'object',
        });
      } else if (
        cid === 'bafkreidg2zay3yqoo7uh2q3kajvs4kyzig6txtdhug6kmf5g53kgqvkmhe'
      ) {
        // Return property_seed relationship schema
        return JSON.stringify({
          $schema: 'https://json-schema.org/draft-07/schema#',
          type: 'object',
          properties: {
            from: {
              type: 'string',
              cid: 'bafkreicfc3vxw6x45bds6iccgbajovmmywboqecp6y4sunghrsyex47bia',
              description: 'Reference to property_seed class schema',
            },
            to: {
              type: 'string',
              cid: 'bafkreiez2uw2xonvowibquwnd5dszwdjbi2i3wf3hhnkmeq4wnf6om44m4',
              description: 'Reference to unnormalized_address class schema',
            },
          },
          required: ['from', 'to'],
        });
      } else if (
        cid === 'bafkreicfc3vxw6x45bds6iccgbajovmmywboqecp6y4sunghrsyex47bia'
      ) {
        // Return property_seed entity schema
        return JSON.stringify({
          $schema: 'https://json-schema.org/draft-07/schema#',
          type: 'object',
          properties: {
            parcel_id: {
              description: 'A unique identifier for the property parcel',
              minLength: 1,
              type: 'string',
            },
            request_identifier: {
              description: 'Identifier value',
              minLength: 1,
              type: ['string', 'null'],
            },
          },
          required: ['parcel_id'],
        });
      }
      throw new Error(`Schema not found for CID: ${cid}`);
    }),
  };
});

import { fetchFromIpfs } from '../../../src/utils/schema-fetcher.js';

describe('SchemaCacheService - Seed Datagroup', () => {
  let schemaCacheService: SchemaCacheService;
  let cacheDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    cacheDir = path.join(
      process.cwd(),
      'tmp',
      `schema-cache-${Math.random().toString(36).slice(2)}`
    );
    fs.mkdirSync(cacheDir, { recursive: true });
    schemaCacheService = new SchemaCacheService(cacheDir);
  });

  afterEach(() => {
    if (cacheDir && fs.existsSync(cacheDir)) {
      fs.rmSync(cacheDir, { recursive: true, force: true });
    }
  });

  it('should fetch seed datagroup schema from IPFS (no special handling)', async () => {
    // Get the schema
    const schema = await schemaCacheService.get(SEED_DATAGROUP_SCHEMA_CID);

    // Verify IPFS was called
    expect(fetchFromIpfs).toHaveBeenCalledWith(SEED_DATAGROUP_SCHEMA_CID);

    // Verify the schema has the correct structure
    expect(schema).toHaveProperty('properties.label.enum', ['Seed']);
    expect(schema).toHaveProperty(
      'properties.relationships.properties.property_seed.cid'
    );
    expect(
      schema.properties?.relationships?.properties?.property_seed?.cid
    ).toBe('bafkreidg2zay3yqoo7uh2q3kajvs4kyzig6txtdhug6kmf5g53kgqvkmhe');
  });

  it('should cache schemas after fetching', async () => {
    // First call should fetch from IPFS
    const schema1 = await schemaCacheService.get(SEED_DATAGROUP_SCHEMA_CID);
    expect(fetchFromIpfs).toHaveBeenCalledTimes(1);

    // Second call should use cache
    const schema2 = await schemaCacheService.get(SEED_DATAGROUP_SCHEMA_CID);
    expect(fetchFromIpfs).toHaveBeenCalledTimes(1); // Still only 1 call

    // Schemas should be identical
    expect(schema1).toBe(schema2);
  });

  it('should allow fetching relationship schemas referenced by seed datagroup', async () => {
    // Get the seed datagroup schema
    const seedSchema = await schemaCacheService.get(SEED_DATAGROUP_SCHEMA_CID);

    // Extract the property_seed relationship CID
    const relationshipCid =
      seedSchema.properties?.relationships?.properties?.property_seed?.cid;
    expect(relationshipCid).toBeDefined();

    // Fetch the relationship schema
    const relationshipSchema = await schemaCacheService.get(
      relationshipCid as string
    );

    // Verify it has the correct structure
    expect(relationshipSchema).toHaveProperty('properties.from.cid');
    expect(relationshipSchema).toHaveProperty('properties.to.cid');
    expect(relationshipSchema.required).toContain('from');
    expect(relationshipSchema.required).toContain('to');
  });

  it('should fetch property_seed entity schema and validate parcel_id as string', async () => {
    const propertySeedCid =
      'bafkreicfc3vxw6x45bds6iccgbajovmmywboqecp6y4sunghrsyex47bia';

    // Fetch the property_seed entity schema
    const schema = await schemaCacheService.get(propertySeedCid);

    // Verify parcel_id is defined as string type
    expect(schema).toHaveProperty('properties.parcel_id.type', 'string');
    expect(schema).toHaveProperty('properties.parcel_id.minLength', 1);
    expect(schema.required).toContain('parcel_id');
  });
});
