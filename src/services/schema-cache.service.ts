import { IPFSService } from './ipfs.service.js';
import { SEED_DATAGROUP_SCHEMA_CID } from '../config/constants.js';

export interface JSONSchema {
  $schema?: string;
  type?: string;
  properties?: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
  [key: string]: unknown;
}

export class SchemaCacheService {
  private cache: Map<string, JSONSchema>;
  private readonly maxSize: number;
  private accessOrder: string[];

  constructor(
    private ipfsService: IPFSService,
    maxSize = 1000
  ) {
    this.cache = new Map();
    this.maxSize = maxSize;
    this.accessOrder = [];
  }

  has(cid: string): boolean {
    return this.cache.has(cid);
  }

  get(cid: string): JSONSchema | undefined {
    const schema = this.cache.get(cid);
    if (schema) {
      // Move to end of access order (most recently used)
      const index = this.accessOrder.indexOf(cid);
      if (index > -1) {
        this.accessOrder.splice(index, 1);
      }
      this.accessOrder.push(cid);
    }
    return schema;
  }

  private put(cid: string, schema: JSONSchema): void {
    // If already in cache, just update it
    if (this.cache.has(cid)) {
      this.cache.set(cid, schema);
      // Move to end of access order
      const index = this.accessOrder.indexOf(cid);
      if (index > -1) {
        this.accessOrder.splice(index, 1);
      }
      this.accessOrder.push(cid);
      return;
    }

    // If cache is at capacity, evict least recently used items (10% of cache)
    if (this.cache.size >= this.maxSize) {
      const evictCount = Math.ceil(this.maxSize * 0.1); // Evict 10% of items
      for (let i = 0; i < evictCount && this.accessOrder.length > 0; i++) {
        const lruCid = this.accessOrder.shift()!;
        this.cache.delete(lruCid);
      }
    }

    this.cache.set(cid, schema);
    this.accessOrder.push(cid);
  }

  async getSchema(dataGroupCid: string): Promise<JSONSchema> {
    // Check cache first
    const cached = this.get(dataGroupCid);
    if (cached) {
      return cached;
    }

    // Special handling for the seed datagroup schema
    if (dataGroupCid === SEED_DATAGROUP_SCHEMA_CID) {
      const seedDatagroupSchema: JSONSchema = {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {
          "label": {
            "type": "string"
          },
          "relationships": {
            "type": "object"
          }
        },
        "required": ["label", "relationships"],
        "additionalProperties": false
      };
      this.put(dataGroupCid, seedDatagroupSchema);
      return seedDatagroupSchema;
    }

    try {
      const schemaBuffer = await this.ipfsService.fetchContent(dataGroupCid);
      const schemaText = schemaBuffer.toString('utf-8');
      const schema: JSONSchema = JSON.parse(schemaText);

      if (typeof schema !== 'object' || schema === null) {
        throw new Error(`Invalid JSON schema: not an object`);
      }
      this.put(dataGroupCid, schema);

      return schema;
    } catch (error) {
      throw new Error(
        `Failed to download or parse schema ${dataGroupCid}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}
