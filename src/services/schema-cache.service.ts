import path from 'path';
import os from 'os';
import fs from 'fs';
import { fetchFromIpfs } from '../utils/schema-fetcher.js';

export type JSONSchema = {
  $schema?: string;
  type: string;
  properties: Record<string, JSONSchema>;
  required?: string[];
  additionalProperties?: boolean;
  title?: string;
  [key: string]: unknown;
};

export class SchemaCacheService {
  private cache: Map<string, JSONSchema>;
  private readonly cacheDir: string;

  constructor(
    cacheDir: string = path.join(os.homedir(), '.elephant-cli', 'schema-cache')
  ) {
    this.cacheDir = cacheDir;
    this.cache = new Map();
    fs.mkdirSync(this.cacheDir, { recursive: true });
    for (const file of fs.readdirSync(this.cacheDir)) {
      if (file.endsWith('.json')) {
        const filePath = path.join(this.cacheDir, file);
        const schemaCId = file.replace('.json', '');
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        this.cache.set(schemaCId, data);
      }
    }
  }

  has(cid: string): boolean {
    return this.cache.has(cid);
  }

  private async fetchSchema(cid: string): Promise<JSONSchema> {
    const schema = JSON.parse(await fetchFromIpfs(cid));

    if (typeof schema !== 'object' || schema === null) {
      throw new Error(`Invalid JSON schema: not an object`);
    }

    this.cache.set(cid, schema);

    await fs.promises.writeFile(
      path.join(this.cacheDir, `${cid}.json`),
      JSON.stringify(schema),
      'utf-8'
    );
    return schema;
  }
  async get(cid: string): Promise<JSONSchema> {
    return this.cache.get(cid) || (await this.fetchSchema(cid));
  }
}
