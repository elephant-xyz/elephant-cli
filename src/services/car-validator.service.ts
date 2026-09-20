import { createReadStream } from 'fs';
// @ipld/car is pinned to 5.4.4, the last release on multiformats 13 (what the rest of the tree uses).
import { CarBlockIterator, CarIndexedReader } from '@ipld/car';
import * as dagJSON from '@ipld/dag-json';
import * as raw from 'multiformats/codecs/raw';
import { CID } from 'multiformats/cid';
import { sha256 } from 'multiformats/hashes/sha2';
import { CsvReporterService } from './csv-reporter.service.js';
import { JsonValidatorService } from './json-validator.service.js';
import { SchemaCacheService } from './schema-cache.service.js';
import { validateDataGroupSchema } from '../utils/single-property-processor.js';
import { logger } from '../utils/logger.js';

export const CAR_CHECKS = [
  'integrity',
  'root',
  'index',
  'graph',
  'lexicon',
  'orphans',
] as const;
export type CarCheck = (typeof CAR_CHECKS)[number];

export interface CarSummary {
  blocks: number;
  properties: number;
  groups: number;
  errors: Record<CarCheck, number>;
}

interface Row {
  block: string;
  message: string;
  property?: string;
  group?: string;
  path?: string;
  value?: string;
}

interface Group {
  property: string;
  schema: string;
  data: CID;
}

function decode(bytes: Uint8Array): unknown {
  try {
    return dagJSON.decode(bytes);
  } catch {
    return undefined;
  }
}

function links(value: unknown, into: CID[] = []): CID[] {
  const cid = CID.asCID(value);
  if (cid) {
    into.push(cid);
    return into;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => links(item, into));
    return into;
  }
  if (value && typeof value === 'object') {
    Object.values(value).forEach((item) => links(item, into));
  }
  return into;
}

function format(data: unknown): string {
  if (data === undefined) {
    return '';
  }
  return typeof data === 'object' ? JSON.stringify(data) : String(data);
}

/**
 * Check a county CAR written by `hash --output-car`: block bytes re-hash to
 * their CIDs, the single root is a `CountyIndex`, every shard entry and every
 * link below it resolves inside the file, every data-group root is valid
 * against its schema, and no block is unreachable from the root. One CSV row
 * per finding; `errors` counts rows per check.
 */
export async function validateCar(
  file: string,
  services: {
    schemaCacheService: SchemaCacheService;
    jsonValidatorService: JsonValidatorService;
    csvReporterService: CsvReporterService;
  }
): Promise<CarSummary> {
  const summary: CarSummary = {
    blocks: 0,
    properties: 0,
    groups: 0,
    errors: {
      integrity: 0,
      root: 0,
      index: 0,
      graph: 0,
      lexicon: 0,
      orphans: 0,
    },
  };
  const report = async (check: CarCheck, row: Row) => {
    summary.errors[check] += 1;
    await services.csvReporterService.logError({
      propertyCid: row.property ?? '',
      dataGroupCid: row.group ?? '',
      filePath: row.block,
      errorPath: row.path ?? check,
      errorMessage: row.message,
      currentValue: row.value ?? '',
      timestamp: new Date().toISOString(),
    });
  };

  // ponytail: one full pass plus indexed lookups; stream shards if a county index ever exceeds memory
  logger.info(`Checking block integrity in ${file}`);
  const stream = await CarBlockIterator.fromIterable(createReadStream(file));
  for await (const block of stream) {
    summary.blocks += 1;
    const hash = block.cid.multihash;
    const intact =
      hash.code === sha256.code &&
      Buffer.from(hash.digest).equals(
        Buffer.from((await sha256.digest(block.bytes)).digest)
      );
    if (!intact) {
      await report('integrity', {
        block: block.cid.toString(),
        message: 'block bytes do not hash to their cid',
      });
    }
  }

  const reader = await CarIndexedReader.fromFile(file);
  const roots = await reader.getRoots();
  if (roots.length !== 1) {
    await report('root', {
      block: roots.map(String).join(' '),
      message: `expected exactly one root, found ${roots.length}`,
    });
    await reader.close();
    return summary;
  }
  const root = roots[0];
  const head = await reader.get(root);
  const index = head ? decode(head.bytes) : undefined;
  if (!index || typeof index !== 'object') {
    await report('root', {
      block: root.toString(),
      message: head
        ? 'root block is not dag-json'
        : 'root block is not in the car',
    });
    await reader.close();
    return summary;
  }
  const county = index as Partial<{
    label: unknown;
    version: unknown;
    properties: unknown;
    shards: unknown;
  }>;
  const shards = Array.isArray(county.shards)
    ? county.shards.map((shard) => CID.asCID(shard))
    : [];
  const shape: [boolean, string][] = [
    [county.label === 'CountyIndex', 'label must be "CountyIndex"'],
    [county.version === 1, 'version must be 1'],
    [typeof county.properties === 'number', 'properties must be a number'],
    [
      Array.isArray(county.shards) && shards.every((shard) => shard !== null),
      'shards must be an array of links',
    ],
  ];
  for (const [ok, message] of shape) {
    if (!ok) {
      await report('root', { block: root.toString(), message });
    }
  }

  const missing = new Set<string>();
  const resolve = async (
    check: CarCheck,
    link: CID,
    from: string,
    context: Partial<Row> = {}
  ): Promise<boolean> => {
    const key = link.toString();
    if (await reader.has(link)) {
      return true;
    }
    if (!missing.has(key)) {
      missing.add(key);
      await report(check, {
        block: from,
        message: `link ${key} is not in the car`,
        ...context,
      });
    }
    return false;
  };

  logger.info(`Checking index closure across ${shards.length} shards`);
  const groups: Group[] = [];
  for (const shard of shards) {
    if (!shard || !(await resolve('index', shard, root.toString()))) {
      continue;
    }
    const block = await reader.get(shard);
    const body = block ? decode(block.bytes) : undefined;
    const entries = (body as { properties?: unknown } | undefined)?.properties;
    if (!Array.isArray(entries)) {
      await report('index', {
        block: shard.toString(),
        message: 'shard must decode to {"properties": [...]}',
      });
      continue;
    }
    for (const entry of entries as Partial<{
      property_cid: unknown;
      data_groups: unknown;
    }>[]) {
      const property = CID.asCID(entry?.property_cid);
      const pointers = entry?.data_groups;
      if (!property || !pointers || typeof pointers !== 'object') {
        await report('index', {
          block: shard.toString(),
          message:
            'shard entry must hold a property_cid link and a data_groups object',
        });
        continue;
      }
      summary.properties += 1;
      await resolve('index', property, shard.toString(), {
        property: property.toString(),
      });
      for (const [schema, pointer] of Object.entries(pointers)) {
        const data = CID.asCID(pointer);
        if (!data) {
          await report('index', {
            block: shard.toString(),
            property: property.toString(),
            group: schema,
            message: `data_groups.${schema} must be a link`,
          });
          continue;
        }
        const found = await resolve('index', data, shard.toString(), {
          property: property.toString(),
          group: schema,
        });
        if (found) {
          groups.push({ property: property.toString(), schema, data });
        }
      }
    }
  }
  if (summary.properties !== county.properties) {
    await report('index', {
      block: root.toString(),
      message: `index declares ${format(county.properties)} properties but shards hold ${summary.properties}`,
    });
  }

  logger.info('Checking graph closure from the root');
  const reachable = new Set<string>();
  const queue: { cid: CID; from: string }[] = [{ cid: root, from: '' }];
  while (queue.length > 0) {
    const next = queue.pop() as { cid: CID; from: string };
    const key = next.cid.toString();
    if (reachable.has(key) || missing.has(key)) {
      continue;
    }
    if (!(await resolve('graph', next.cid, next.from))) {
      continue;
    }
    reachable.add(key);
    if (next.cid.code === raw.code) {
      continue;
    }
    if (next.cid.code !== dagJSON.code) {
      await report('graph', {
        block: key,
        message: `unsupported codec 0x${next.cid.code.toString(16)}`,
      });
      continue;
    }
    const block = await reader.get(next.cid);
    const value = block ? decode(block.bytes) : undefined;
    if (value === undefined) {
      await report('graph', { block: key, message: 'block is not dag-json' });
      continue;
    }
    links(value).forEach((cid) => queue.push({ cid, from: key }));
  }

  logger.info(`Validating ${groups.length} data-group roots against lexicon`);
  services.jsonValidatorService.setBlockSource(
    async (cid) => (await reader.get(CID.parse(cid)))?.bytes
  );
  for (const group of groups) {
    const block = await reader.get(group.data);
    if (!block || decode(block.bytes) === undefined) {
      continue;
    }
    const context = {
      block: group.data.toString(),
      property: group.property,
      group: group.schema,
    };
    const schema = await services.schemaCacheService
      .get(group.schema)
      .catch(() => undefined);
    if (!schema) {
      await report('lexicon', {
        ...context,
        message: `could not load schema ${group.schema}`,
      });
      continue;
    }
    if (!validateDataGroupSchema(schema).valid) {
      await report('lexicon', {
        ...context,
        message: `schema ${group.schema} is not a valid data group schema`,
      });
      continue;
    }
    const result = await services.jsonValidatorService.validate(
      JSON.parse(new TextDecoder().decode(block.bytes)),
      schema,
      undefined,
      false
    );
    summary.groups += 1;
    if (result.valid) {
      continue;
    }
    for (const info of services.jsonValidatorService.getErrorMessages(
      result.errors ?? []
    )) {
      await report('lexicon', {
        ...context,
        path: info.path,
        message: info.message,
        value: format(info.data),
      });
    }
  }

  logger.info('Checking for blocks unreachable from the root');
  const seen = new Set<string>();
  for await (const cid of reader.cids()) {
    const key = cid.toString();
    if (reachable.has(key) || seen.has(key)) {
      continue;
    }
    seen.add(key);
    await report('orphans', {
      block: key,
      message: 'block is not reachable from the root',
    });
  }
  await reader.close();
  return summary;
}
