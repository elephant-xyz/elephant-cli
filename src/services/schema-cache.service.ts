import path from 'path';
import os from 'os';
import fs from 'fs';
import pLimit from 'p-limit';
import { fetchFromIpfs, fetchSchemaManifest } from '../utils/schema-fetcher.js';
import { logger } from '../utils/logger.js';

export type JSONSchema = {
  $schema?: string;
  type: string;
  properties?: Record<string, JSONSchema>;
  required?: string[];
  additionalProperties?: boolean;
  title?: string;
  [key: string]: unknown;
};

export class SchemaCacheService {
  private cache: Map<string, JSONSchema>;
  private pending = new Map<string, Promise<JSONSchema>>();
  private readonly cacheDir: string;

  constructor(
    cacheDir: string = process.env.AWS_LAMBDA_FUNCTION_NAME ||
    process.env.AIRFLOW_HOME ||
    process.env.AIRFLOW__CORE__DAGS_FOLDER ||
    process.env.AIRFLOW__CORE__EXECUTOR
      ? path.join('/tmp', 'elephant-cli', 'schema-cache')
      : path.join(os.homedir(), '.elephant-cli', 'schema-cache')
  ) {
    this.cacheDir = cacheDir;
    this.cache = new Map();
    logger.info(`Schema cache directory: ${this.cacheDir}`);
    try {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    } catch (error) {
      logger.error(`Error creating schema cache directory: ${error}`);
    }
    let files: string[] = [];
    try {
      files = fs.readdirSync(this.cacheDir);
    } catch (error) {
      logger.error(`Error reading schema cache directory: ${error}`);
    }
    logger.info(`Found ${files.length} schema files in cache`);
    files
      .filter((f) => f.endsWith('.json'))
      .forEach((file) => {
        logger.info(`Loading schema ${file}`);
        const filePath = path.join(this.cacheDir, file);
        const schemaCid = file.replace('.json', '');
        try {
          const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
          this.cache.set(schemaCid, data);
        } catch (error) {
          logger.error(`Error loading schema ${schemaCid}: ${error}`);
        }
      });
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
  /**
   * Fetch every lexicon manifest schema that is not cached yet, 16 at a time.
   * A schema that fails here is fetched again, and reported, by get().
   */
  async warm(): Promise<void> {
    const manifest = await fetchSchemaManifest().catch(() => ({}));
    const limit = pLimit(16);
    await Promise.all(
      Object.values(manifest)
        .map((meta) => meta.ipfsCid)
        .filter((cid) => !this.cache.has(cid))
        .map((cid) => limit(() => this.get(cid).catch(() => undefined)))
    );
  }

  /**
   * The schema for a CID, always as the same object: validators key their
   * work on it, so concurrent first lookups share one fetch and callers must
   * not edit what they get.
   */
  async get(cid: string): Promise<JSONSchema> {
    const cached = this.cache.get(cid);
    if (cached) {
      return cached;
    }
    const fetching =
      this.pending.get(cid) ??
      this.fetchSchema(cid).finally(() => this.pending.delete(cid));
    this.pending.set(cid, fetching);
    return fetching;
  }
}
