import path from 'path';
import AdmZip from 'adm-zip';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { pathToFileURL } from 'url';
import { extractZipToTemp } from '../utils/zip.js';
import { BrowserFlowV2Manifest } from './browser-flow-v2.js';
import { Request } from './types.js';
import { logger } from '../utils/logger.js';
import { SchemaManifestService } from '../services/schema-manifest.service.js';
import {
  JSONSchema,
  SchemaCacheService,
} from '../services/schema-cache.service.js';

interface TransformV2Options {
  inputZip: string;
  transformZip: string;
  outputZip: string;
  dataGroup?: string;
}

export interface TransformV2Input {
  request_identifier: string;
  source_http_request: Request;
  address: Record<string, unknown>;
  parcel: Record<string, unknown>;
  captures: BrowserFlowV2Manifest;
  readCapture(name: string): Promise<string>;
}

export interface WriteRelationshipOptions {
  type: string;
  name: string;
  from: string;
  to: string;
}

export interface TransformV2Context {
  input: TransformV2Input;
  readCapture(name: string): Promise<string>;
  writeJson(name: string, value: Record<string, unknown>): Promise<void>;
  writeRelationship(options: WriteRelationshipOptions): Promise<void>;
  logger: typeof logger;
}

export interface TransformV2Config {
  timeoutMs?: number;
}

interface TransformV2Module {
  handler: (context: TransformV2Context) => Promise<void>;
  config?: TransformV2Config;
}

interface RelationshipRef {
  file: string;
  ref: { '/': string };
}

const OUTPUT_NAME_PATTERN = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;
const DEFAULT_TIMEOUT_MS = 120000;
const MIN_TIMEOUT_MS = 1000;
const MAX_TIMEOUT_MS = 600000;

async function loadHandler(transformZip: string, root: string) {
  const dir = path.join(root, 'handler');
  await fs.mkdir(dir, { recursive: true });
  new AdmZip(transformZip).extractAllTo(dir, true);

  const handlerPath = path.join(dir, 'handler.js');
  await fs.access(handlerPath);

  const mod = (await import(
    `${pathToFileURL(handlerPath).href}?t=${Date.now()}`
  )) as Partial<TransformV2Module>;

  if (typeof mod.handler !== 'function') {
    throw new Error('Transform v2 package must export a handler function');
  }

  return {
    handler: mod.handler,
    config: mod.config,
  };
}

function validateOutputName(name: string) {
  if (!OUTPUT_NAME_PATTERN.test(name)) {
    throw new Error(
      `Invalid output name "${name}". Output names must be snake_case stems.`
    );
  }
}

async function readJsonFile<T>(file: string): Promise<T> {
  return JSON.parse(await fs.readFile(file, 'utf-8')) as T;
}

function parseCaptures(content: string): BrowserFlowV2Manifest {
  try {
    return JSON.parse(content) as BrowserFlowV2Manifest;
  } catch {
    throw new Error('captures.json is invalid JSON');
  }
}

function getTimeoutMs(config: TransformV2Config | undefined) {
  const timeoutMs = config?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (
    !Number.isInteger(timeoutMs) ||
    timeoutMs < MIN_TIMEOUT_MS ||
    timeoutMs > MAX_TIMEOUT_MS
  ) {
    throw new Error(
      `Transform v2 timeoutMs must be between ${MIN_TIMEOUT_MS}ms and ${MAX_TIMEOUT_MS}ms`
    );
  }
  return timeoutMs;
}

async function withTimeout(action: Promise<void>, timeoutMs: number) {
  let timeout: NodeJS.Timeout | undefined;
  const timer = new Promise<never>((_, reject) => {
    timeout = setTimeout(
      () => reject(new Error(`Transform v2 timed out after ${timeoutMs}ms`)),
      timeoutMs
    );
  });

  try {
    await Promise.race([action, timer]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function schemaTypeIncludes(schema: JSONSchema | undefined, type: string) {
  if (!schema) {
    return false;
  }
  if (schema.type === type) {
    return true;
  }
  if (Array.isArray(schema.type)) {
    return schema.type.includes(type);
  }
  return false;
}

function getRelationshipSchema(schema: JSONSchema, type: string) {
  const relationships = schema.properties?.relationships;
  return relationships?.properties?.[type];
}

async function createDataGroupRoot(
  outputDir: string,
  dataGroup: string,
  relationships: Map<string, RelationshipRef[]>
) {
  if (relationships.size === 0) {
    return;
  }

  const manifest = new SchemaManifestService();
  await manifest.loadSchemaManifest();
  const cid = manifest.getDataGroupCidByLabel(dataGroup);
  if (!cid) {
    throw new Error(`Schema not found for data group type: ${dataGroup}`);
  }

  const cache = new SchemaCacheService();
  const schema = await cache.get(cid);
  const root: Record<string, unknown> = {};

  for (const [type, refs] of relationships) {
    const relSchema = getRelationshipSchema(schema, type);
    if (!relSchema) {
      throw new Error(
        `Relationship type "${type}" is not valid for ${dataGroup}`
      );
    }
    if (schemaTypeIncludes(relSchema, 'array')) {
      root[type] = refs.map((ref) => ref.ref);
      continue;
    }
    if (refs.length > 1) {
      throw new Error(
        `Relationship type "${type}" only allows one relationship`
      );
    }
    root[type] = refs[0].ref;
  }

  await fs.writeFile(
    path.join(outputDir, `${cid}.json`),
    JSON.stringify(
      {
        label: dataGroup,
        relationships: root,
      },
      null,
      2
    ),
    'utf-8'
  );
}

export async function executeTransformV2(options: TransformV2Options) {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'elephant-transform-v2-'));

  try {
    const dir = await extractZipToTemp(options.inputZip, root, 'input');
    const outputDir = path.join(root, 'data');
    const capturesPath = path.join(dir, 'captures.json');
    const capturesContent = await fs
      .readFile(capturesPath, 'utf-8')
      .catch(() => {
        throw new Error('captures.json is required for transform v2');
      });
    const captures = parseCaptures(capturesContent);
    const address = await readJsonFile<Record<string, unknown>>(
      path.join(dir, 'address.json')
    );
    const parcel = await readJsonFile<Record<string, unknown>>(
      path.join(dir, 'parcel.json')
    );
    const request = parcel.source_http_request as Request | undefined;
    const id = parcel.request_identifier as string | undefined;

    if (!request) {
      throw new Error('parcel.json missing source_http_request');
    }
    if (!id) {
      throw new Error('parcel.json missing request_identifier');
    }

    const mod = await loadHandler(options.transformZip, root);
    const timeoutMs = getTimeoutMs(mod.config);
    const outputs = new Set<string>();
    const entities = new Set<string>();
    const relationships = new Map<string, RelationshipRef[]>();

    await fs.mkdir(outputDir, { recursive: true });

    const readCapture = async (name: string) => {
      const capture = captures.captures.find((item) => item.name === name);
      if (!capture) {
        throw new Error(`Unknown capture: ${name}`);
      }
      const inputRoot = path.resolve(dir);
      const resolved = path.resolve(inputRoot, capture.path);
      const relative = path.relative(inputRoot, resolved);
      if (relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new Error(`Invalid capture path: ${capture.path}`);
      }
      return await fs.readFile(resolved, 'utf-8');
    };

    const writeJson = async (name: string, value: Record<string, unknown>) => {
      validateOutputName(name);
      if (outputs.has(name)) {
        throw new Error(`Duplicate output name: ${name}`);
      }

      outputs.add(name);
      entities.add(name);
      await fs.writeFile(
        path.join(outputDir, `${name}.json`),
        JSON.stringify(
          {
            ...value,
            source_http_request: value.source_http_request ?? request,
            request_identifier: id,
          },
          null,
          2
        ),
        'utf-8'
      );
    };

    const writeRelationship = async (options: WriteRelationshipOptions) => {
      validateOutputName(options.name);
      if (outputs.has(options.name)) {
        throw new Error(`Duplicate output name: ${options.name}`);
      }
      if (!entities.has(options.from)) {
        throw new Error(`Unknown relationship source: ${options.from}`);
      }
      if (!entities.has(options.to)) {
        throw new Error(`Unknown relationship target: ${options.to}`);
      }

      outputs.add(options.name);
      const file = `${options.name}.json`;
      await fs.writeFile(
        path.join(outputDir, file),
        JSON.stringify(
          {
            from: { '/': `./${options.from}.json` },
            to: { '/': `./${options.to}.json` },
          },
          null,
          2
        ),
        'utf-8'
      );

      const refs = relationships.get(options.type) ?? [];
      refs.push({
        file,
        ref: { '/': `./${file}` },
      });
      relationships.set(options.type, refs);
    };

    await withTimeout(
      mod.handler({
        input: {
          request_identifier: id,
          source_http_request: request,
          address,
          parcel,
          captures,
          readCapture,
        },
        readCapture,
        writeJson,
        writeRelationship,
        logger,
      }),
      timeoutMs
    );

    await createDataGroupRoot(
      outputDir,
      options.dataGroup ?? 'County',
      relationships
    );

    const zip = new AdmZip();
    const entries = await fs.readdir(outputDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile()) {
        zip.addLocalFile(path.join(outputDir, entry.name), 'data');
      }
    }
    zip.writeZip(options.outputZip);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}
