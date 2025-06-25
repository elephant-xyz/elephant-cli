import { IPFSService } from './ipfs.service.js';
import { Ajv, ValidateFunction } from 'ajv';
import { CID } from 'multiformats';

export interface JSONSchema {
  $schema?: string;
  type?: string;
  properties?: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
  [key: string]: unknown;
}

export class SchemaCacheService {
  private cache: Map<string, ValidateFunction>;
  private readonly maxSize: number;
  private readonly ajv: Ajv;

  constructor(
    private ipfsService: IPFSService,
    maxSize = 1000
  ) {
    this.cache = new Map();
    this.maxSize = maxSize;
    this.ajv = new Ajv();
    this.ajv.addFormat('cid', {
      type: 'string',
      validate: (value: string) => {
        try {
          CID.parse(value);
        } catch (error) {
          return false;
        }
        return true;
      },
    });
  }

  has(cid: string): boolean {
    return this.cache.has(cid);
  }

  get(cid: string): ValidateFunction | undefined {
    return this.cache.get(cid);
  }

  private put(cid: string, schema: ValidateFunction): void {
    // Simple eviction: clear cache when it gets too big
    if (this.cache.size >= this.maxSize) {
      this.cache.clear();
    }

    this.cache.set(cid, schema);
  }

  async getSchema(dataGroupCid: string): Promise<ValidateFunction> {
    // Check cache first
    const cached = this.get(dataGroupCid);
    if (cached) {
      return cached;
    }

    // Download from IPFS
    try {
      const schemaBuffer = await this.ipfsService.fetchContent(dataGroupCid);
      const schemaText = schemaBuffer.toString('utf-8');
      const schema: JSONSchema = JSON.parse(schemaText);

      // Validate it's a JSON schema
      if (typeof schema !== 'object' || schema === null) {
        throw new Error(`Invalid JSON schema: not an object`);
      }
      let validate;
      try {
        validate = this.ajv.compile(schema);
      } catch (error) {
        throw new Error(
          `Failed to compile schema ${dataGroupCid}: ${error instanceof Error ? error.message : String(error)}`
        );
      }

      // Store in cache
      this.put(dataGroupCid, validate);

      return validate;
    } catch (error) {
      throw new Error(
        `Failed to download or parse schema ${dataGroupCid}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}
