import { createReadStream } from 'fs';
// @ipld/car is pinned to 5.4.4, the last release on multiformats 13 (what the rest of the tree uses).
import { CarBlockIterator, CarIndexedReader } from '@ipld/car';
import * as dagJSON from '@ipld/dag-json';
import * as raw from 'multiformats/codecs/raw';
import { CID } from 'multiformats/cid';
import { sha256 } from 'multiformats/hashes/sha2';
import { equals as u8eq } from 'uint8arrays/equals';
import { decodeDagJson } from './cid-calculator.service.js';
import { CsvReporterService } from './csv-reporter.service.js';
import { JsonValidatorService } from './json-validator.service.js';
import { SchemaCacheService } from './schema-cache.service.js';
import { ErrorEntry } from '../types/submit.types.js';
import { validateDataGroupSchema } from '../utils/single-property-processor.js';
import {
  filterErrorRows,
  formatCurrentValue,
} from '../utils/validation-errors.js';
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

export interface Row {
  block: string;
  message: string;
  property?: string;
  group?: string;
  path?: string;
  value?: string;
}

export interface IndexEntry {
  property: CID;
  groups: { schema: string; data: CID }[];
}

/**
 * Decode the county index at the single CAR root and walk its shards in file
 * order. Every malformed piece goes to `report` and every link to `resolve`,
 * which says whether the walk keeps it; the walk continues past both, so a
 * validator can collect findings while an exporter can throw on the first.
 * Returns nothing when the root itself is unusable.
 */
export async function walkIndex(
  reader: CarIndexedReader,
  report: (check: 'root' | 'index', row: Row) => Promise<void>,
  resolve: (
    check: 'index',
    link: CID,
    from: string,
    context?: Partial<Row>
  ) => Promise<boolean>
): Promise<{ root: CID; entries: IndexEntry[] } | undefined> {
  const roots = await reader.getRoots();
  if (roots.length !== 1) {
    await report('root', {
      block: roots.map(String).join(' '),
      message: `expected exactly one root, found ${roots.length}`,
    });
    return;
  }
  const root = roots[0];
  if (root.code !== dagJSON.code) {
    await report('root', {
      block: root.toString(),
      message: 'root must be a dag-json block',
    });
    return;
  }
  const head = await reader.get(root);
  const index = head ? decodeDagJson(head.bytes) : undefined;
  if (!index || typeof index !== 'object') {
    await report('root', {
      block: root.toString(),
      message: head
        ? 'root block is not dag-json'
        : 'root block is not in the car',
    });
    return;
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

  logger.info(`Reading the county index across ${shards.length} shards`);
  const entries: IndexEntry[] = [];
  for (const shard of shards) {
    if (!shard || !(await resolve('index', shard, root.toString()))) {
      continue;
    }
    const block = await reader.get(shard);
    const body = block ? decodeDagJson(block.bytes) : undefined;
    const listed = (body as { properties?: unknown } | undefined)?.properties;
    if (!Array.isArray(listed)) {
      await report('index', {
        block: shard.toString(),
        message: 'shard must decode to {"properties": [...]}',
      });
      continue;
    }
    for (const item of listed as Partial<{
      property_cid: unknown;
      data_groups: unknown;
    }>[]) {
      const property = CID.asCID(item?.property_cid);
      const pointers = item?.data_groups;
      if (!property || !pointers || typeof pointers !== 'object') {
        await report('index', {
          block: shard.toString(),
          message:
            'shard entry must hold a property_cid link and a data_groups object',
        });
        continue;
      }
      await resolve('index', property, shard.toString(), {
        property: property.toString(),
      });
      const groups: IndexEntry['groups'] = [];
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
        await resolve('index', data, shard.toString(), {
          property: property.toString(),
          group: schema,
        });
        groups.push({ schema, data });
      }
      entries.push({ property, groups });
    }
  }
  if (
    typeof county.properties === 'number' &&
    entries.length !== county.properties
  ) {
    await report('index', {
      block: root.toString(),
      message: `index declares ${county.properties} properties but shards hold ${entries.length}`,
    });
  }
  return { root, entries };
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

function entry(check: CarCheck, row: Row): ErrorEntry {
  return {
    propertyCid: row.property ?? '',
    dataGroupCid: row.group ?? '',
    filePath: row.block,
    errorPath: row.path ?? check,
    errorMessage: row.message,
    currentValue: row.value ?? '',
    timestamp: new Date().toISOString(),
  };
}

/**
 * Check a county CAR written by `hash --output-car`: block bytes re-hash to
 * their CIDs, the single root is a `CountyIndex`, every shard entry and every
 * link below it resolves inside the file, every data-group root is valid
 * against its schema, and no block is unreachable from the root. One CSV row
 * per finding; `errors` counts rows per check. Lexicon rows pass through the
 * same filter as `validate <zip>`, so a property passes or fails identically
 * in either container.
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
    await services.csvReporterService.logError(entry(check, row));
  };

  // ponytail: one full pass plus indexed lookups; stream shards if a county index ever exceeds memory
  logger.info(`Checking block integrity in ${file}`);
  const input = createReadStream(file);
  try {
    const stream = await CarBlockIterator.fromIterable(input);
    for await (const block of stream) {
      summary.blocks += 1;
      const hash = block.cid.multihash;
      const intact =
        hash.code === sha256.code &&
        u8eq(hash.digest, (await sha256.digest(block.bytes)).digest);
      if (!intact) {
        await report('integrity', {
          block: block.cid.toString(),
          message: 'block bytes do not hash to their cid',
        });
      }
    }
  } finally {
    input.destroy();
  }

  const reader = await CarIndexedReader.fromFile(file);
  const walk = async () => {
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

    const index = await walkIndex(reader, report, resolve);
    if (!index) {
      return;
    }
    const { root, entries } = index;
    summary.properties = entries.length;

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
      const value = block ? decodeDagJson(block.bytes) : undefined;
      if (value === undefined) {
        await report('graph', { block: key, message: 'block is not dag-json' });
        continue;
      }
      links(value).forEach((cid) => queue.push({ cid, from: key }));
    }

    logger.info(
      `Validating data-group roots of ${entries.length} properties against lexicon`
    );
    services.jsonValidatorService.setBlockSource(
      async (cid) => (await reader.get(CID.parse(cid)))?.bytes
    );
    try {
      for (const item of entries) {
        const rows: ErrorEntry[] = [];
        for (const group of item.groups) {
          const context = {
            block: group.data.toString(),
            property: item.property.toString(),
            group: group.schema,
          };
          const block = await reader.get(group.data);
          const value =
            block && group.data.code === dagJSON.code
              ? decodeDagJson(block.bytes)
              : undefined;
          if (!block || value === undefined) {
            await report('lexicon', {
              ...context,
              message: block
                ? 'data-group root is not a dag-json block'
                : 'data-group root is not in the car',
            });
            continue;
          }
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
            rows.push(
              entry('lexicon', {
                ...context,
                path: info.path,
                message: info.message,
                value: formatCurrentValue(info.data),
              })
            );
          }
        }
        for (const row of filterErrorRows(rows)) {
          summary.errors.lexicon += 1;
          await services.csvReporterService.logError(row);
        }
      }
    } finally {
      services.jsonValidatorService.setBlockSource(undefined);
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
  };
  try {
    await walk();
  } finally {
    await reader.close();
  }
  return summary;
}
