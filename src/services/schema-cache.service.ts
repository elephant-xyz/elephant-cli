import { IPFSService } from './ipfs.service.js';

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

  constructor(
    private ipfsService: IPFSService,
    maxSize = 1000
  ) {
    this.cache = new Map();
    this.maxSize = maxSize;
  }

  has(cid: string): boolean {
    return this.cache.has(cid);
  }

  get(cid: string): JSONSchema | undefined {
    return this.cache.get(cid);
  }

  private put(cid: string, schema: JSONSchema): void {
    // Simple eviction: clear cache when it gets too big
    if (this.cache.size >= this.maxSize) {
      this.cache.clear();
    }

    this.cache.set(cid, schema);
  }

  async getSchema(dataGroupCid: string): Promise<JSONSchema> {
    // Check cache first
    const cached = this.get(dataGroupCid);
    if (cached) {
      return cached;
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
