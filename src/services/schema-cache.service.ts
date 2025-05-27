import { IpfsService } from './ipfs.service';

export interface JSONSchema {
  $schema?: string;
  type?: string;
  properties?: Record<string, any>;
  required?: string[];
  additionalProperties?: boolean;
  [key: string]: any;
}

export interface LRUCacheNode {
  key: string;
  value: JSONSchema;
  prev: LRUCacheNode | null;
  next: LRUCacheNode | null;
}

export class SchemaCacheService {
  private cache: Map<string, LRUCacheNode>;
  private head: LRUCacheNode | null = null;
  private tail: LRUCacheNode | null = null;
  private readonly maxSize: number;

  constructor(
    private ipfsService: IpfsService,
    maxSize = 1000
  ) {
    this.cache = new Map();
    this.maxSize = maxSize;
  }

  has(cid: string): boolean {
    return this.cache.has(cid);
  }

  private addToHead(node: LRUCacheNode): void {
    node.prev = null;
    node.next = this.head;
    
    if (this.head) {
      this.head.prev = node;
    }
    
    this.head = node;
    
    if (!this.tail) {
      this.tail = node;
    }
  }

  private removeNode(node: LRUCacheNode): void {
    if (node.prev) {
      node.prev.next = node.next;
    } else {
      this.head = node.next;
    }
    
    if (node.next) {
      node.next.prev = node.prev;
    } else {
      this.tail = node.prev;
    }
  }

  private moveToHead(node: LRUCacheNode): void {
    this.removeNode(node);
    this.addToHead(node);
  }

  private removeTail(): LRUCacheNode | null {
    if (!this.tail) {
      return null;
    }
    
    const lastNode = this.tail;
    this.removeNode(lastNode);
    return lastNode;
  }

  get(cid: string): JSONSchema | undefined {
    const node = this.cache.get(cid);
    
    if (!node) {
      return undefined;
    }
    
    // Move to head (most recently used)
    this.moveToHead(node);
    
    return node.value;
  }

  private put(cid: string, schema: JSONSchema): void {
    const existingNode = this.cache.get(cid);
    
    if (existingNode) {
      // Update existing
      existingNode.value = schema;
      this.moveToHead(existingNode);
    } else {
      // Add new
      const newNode: LRUCacheNode = {
        key: cid,
        value: schema,
        prev: null,
        next: null,
      };
      
      if (this.cache.size >= this.maxSize) {
        // Remove least recently used
        const tail = this.removeTail();
        if (tail) {
          this.cache.delete(tail.key);
        }
      }
      
      this.cache.set(cid, newNode);
      this.addToHead(newNode);
    }
  }

  async getSchema(dataGroupCid: string): Promise<JSONSchema> {
    // Check cache first
    const cached = this.get(dataGroupCid);
    if (cached) {
      return cached;
    }

    // Download from IPFS
    try {
      const schemaBuffer = await this.ipfsService.downloadFile(dataGroupCid);
      const schemaText = schemaBuffer.toString('utf-8');
      const schema: JSONSchema = JSON.parse(schemaText);
      
      // Validate it's a JSON schema
      if (typeof schema !== 'object' || schema === null) {
        throw new Error(`Invalid JSON schema: not an object`);
      }
      
      // Store in cache
      this.put(dataGroupCid, schema);
      
      return schema;
    } catch (error) {
      throw new Error(`Failed to download or parse schema ${dataGroupCid}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async preloadSchemas(cids: string[]): Promise<void> {
    const uniqueCids = [...new Set(cids)];
    const missingCids = uniqueCids.filter(cid => !this.has(cid));
    
    if (missingCids.length === 0) {
      return;
    }

    // Download schemas in parallel (max 10 concurrent)
    const batchSize = 10;
    const batches: string[][] = [];
    
    for (let i = 0; i < missingCids.length; i += batchSize) {
      batches.push(missingCids.slice(i, i + batchSize));
    }

    for (const batch of batches) {
      const promises = batch.map(async (cid) => {
        try {
          await this.getSchema(cid);
        } catch (error) {
          // Log error but don't fail the entire batch
          console.error(`Failed to preload schema ${cid}:`, error);
        }
      });

      await Promise.all(promises);
    }
  }

  getCacheStats(): {
    size: number;
    maxSize: number;
    hitRatio?: number;
  } {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
    };
  }

  clear(): void {
    this.cache.clear();
    this.head = null;
    this.tail = null;
  }
}