import { createReadStream, promises as fsPromises } from 'fs';
// @ipld/car is pinned to 5.4.4, the last release on multiformats 13 (what the rest of the tree uses).
import { CarIndexedReader } from '@ipld/car';
import {
  asyncIterableReader,
  limitReader,
  readBlockHead,
  readHeader,
} from '@ipld/car/decoder';
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
  /**
   * Blocks looked up by CID because they are not stored with the shard that
   * links to them, which takes an index of the whole file: 0 for a file laid
   * out by `hash --output-car`.
   */
  lookups: number;
  /**
   * Blocks that did not fit in the memory budget and were read back from the
   * file when needed.
   */
  spilled: number;
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

type Report = (check: 'root' | 'index', row: Row) => Promise<void>;
type Resolve = (
  check: 'index',
  link: CID,
  from: string,
  context?: Partial<Row>
) => Promise<boolean>;

interface Head {
  root: CID;
  shards: (CID | null)[];
  declared: unknown;
}

/**
 * Check the county index block at the single CAR root, given its bytes. Every
 * malformed piece goes to `report`. Returns nothing when the root itself is
 * unusable.
 */
async function readHead(
  roots: CID[],
  bytes: Uint8Array | undefined,
  report: Report
): Promise<Head | undefined> {
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
  const index = bytes ? decodeDagJson(bytes) : undefined;
  if (!index || typeof index !== 'object') {
    await report('root', {
      block: root.toString(),
      message: bytes
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
  return { root, shards, declared: county.properties };
}

/**
 * Read the entries of one shard block. Every malformed piece goes to `report`
 * and every link to `resolve`; both are passed over, so a validator can
 * collect findings while an exporter can throw on the first. Returns nothing
 * when the block is not a shard.
 */
async function readShard(
  shard: CID,
  bytes: Uint8Array | undefined,
  report: Report,
  resolve: Resolve
): Promise<IndexEntry[] | undefined> {
  const body = bytes ? decodeDagJson(bytes) : undefined;
  const listed = (body as { properties?: unknown } | undefined)?.properties;
  if (!Array.isArray(listed)) {
    await report('index', {
      block: shard.toString(),
      message: 'shard must decode to {"properties": [...]}',
    });
    return;
  }
  const entries: IndexEntry[] = [];
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
  return entries;
}

/** Report an index whose declared property count is not what its shards hold. */
async function checkCount(
  head: Head,
  held: number,
  report: Report
): Promise<void> {
  if (typeof head.declared === 'number' && held !== head.declared) {
    await report('index', {
      block: head.root.toString(),
      message: `index declares ${head.declared} properties but shards hold ${held}`,
    });
  }
}

/**
 * Decode the county index at the single CAR root and walk its shards in file
 * order, looking every block up by CID. Returns nothing when the root itself
 * is unusable.
 */
export async function walkIndex(
  reader: CarIndexedReader,
  report: Report,
  resolve: Resolve
): Promise<{ root: CID; entries: IndexEntry[] } | undefined> {
  const roots = await reader.getRoots();
  const head = await readHead(
    roots,
    roots.length === 1 ? (await reader.get(roots[0]))?.bytes : undefined,
    report
  );
  if (!head) {
    return;
  }
  logger.info(`Reading the county index across ${head.shards.length} shards`);
  const entries: IndexEntry[] = [];
  for (const shard of head.shards) {
    if (!shard || !(await resolve('index', shard, head.root.toString()))) {
      continue;
    }
    const listed = await readShard(
      shard,
      (await reader.get(shard))?.bytes,
      report,
      resolve
    );
    (listed ?? []).forEach((entry) => entries.push(entry));
  }
  await checkCount(head, entries.length, report);
  return { root: head.root, entries };
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

/** Where a block's bytes sit in the file. */
interface Place {
  offset: number;
  length: number;
}

/**
 * Check a county CAR written by `hash --output-car`: block bytes re-hash to
 * their CIDs, the single root is a `CountyIndex`, every shard entry and every
 * link below it resolves inside the file, every data-group root is valid
 * against its schema, and no block is unreachable from the root. One CSV row
 * per finding; `errors` counts rows per check. Lexicon rows pass through the
 * same filter as `validate <zip>`, so a property passes or fails identically
 * in either container.
 *
 * The file is read start to end twice. The first pass hashes every block and
 * picks up the county index, which sits last. The second holds the blocks
 * seen since the previous shard block and checks them when their shard block
 * arrives, because `hash --output-car` writes a shard's blocks right before
 * it. At most `hold` bytes of blocks are held at once; a block beyond that is
 * read back from the file when something needs it.
 *
 * A file laid out another way gets the same findings more slowly: the first
 * link to a block that is in the file but not among the held ones indexes the
 * whole file, and from then on blocks are read one at a time.
 */
export async function validateCar(
  file: string,
  services: {
    schemaCacheService: SchemaCacheService;
    jsonValidatorService: JsonValidatorService;
    csvReporterService: CsvReporterService;
  },
  hold = 2 ** 30
): Promise<CarSummary> {
  const summary: CarSummary = {
    blocks: 0,
    properties: 0,
    groups: 0,
    lookups: 0,
    spilled: 0,
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
  // Every block in file order, read in large chunks, with where its bytes sit.
  const scan = async (
    visit: (
      block: { cid: CID; bytes: Uint8Array; offset: number },
      roots: CID[]
    ) => Promise<void>
  ): Promise<CID[]> => {
    const input = createReadStream(file, { highWaterMark: 1 << 20 });
    try {
      const whole = asyncIterableReader(input);
      const header = await readHeader(whole);
      // A CARv2 file carries an index after its blocks: stop where they end.
      const reader =
        header.version === 2
          ? limitReader(
              whole,
              header.dataSize - (whole.pos - header.dataOffset)
            )
          : whole;
      while ((await reader.upTo(8)).length > 0) {
        const next = await readBlockHead(reader);
        const offset = reader.pos;
        const bytes = await reader.exactly(next.blockLength, true);
        await visit({ cid: next.cid, bytes, offset }, header.roots);
      }
      return header.roots;
    } finally {
      input.destroy();
    }
  };

  // A Bloom filter of every CID in the file, one bit per 16 bytes of file. It
  // says for certain that a block is absent, so a link to a missing block is
  // settled without an index of the whole file; a wrong "maybe present" only
  // costs that index.
  const size = (await fsPromises.stat(file)).size;
  const bits = Math.min(2 ** 32, Math.max(2 ** 20, Math.ceil(size / 16)));
  const filter = new Uint8Array(Math.ceil(bits / 8));
  // Eight positions per CID, cut from its hash digest.
  const spots = (cid: CID): number[] => {
    const digest = cid.multihash.digest;
    return [0, 4, 8, 12, 16, 20, 24, 28].map(
      (start) =>
        [0, 1, 2, 3].reduce(
          (sum, step) =>
            sum * 256 + (digest[(start + step) % digest.length] ?? 0),
          0
        ) % bits
    );
  };
  const marked = (spot: number) =>
    (filter[Math.floor(spot / 8)] & (1 << spot % 8)) !== 0;
  // CIDs the filter had already seen: every block written more than once.
  const twins = new Set<string>();
  const state: {
    head?: Uint8Array;
    held: number;
    index?: Promise<CarIndexedReader>;
    handle?: Promise<fsPromises.FileHandle>;
  } = { held: 0 };

  logger.info(`Checking block integrity in ${file}`);
  const roots = await scan(async (block, listed) => {
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
    const marks = spots(block.cid);
    if (marks.every(marked)) {
      twins.add(block.cid.toString());
    }
    marks.forEach((spot) => {
      filter[Math.floor(spot / 8)] |= 1 << spot % 8;
    });
    if (listed.length === 1 && block.cid.equals(listed[0])) {
      state.head = block.bytes;
    }
  });
  const head = await readHead(roots, state.head, report);
  if (!head) {
    return summary;
  }

  const top = head.root.toString();
  // Blocks seen since the last shard block, by CID string: their bytes, or
  // where they sit in the file when they are not held.
  const pending = new Map<string, Uint8Array | Place>();
  // Links to blocks that are not in the file: the block a graph walk found
  // linking to each, or nothing once the index check has reported it.
  const absent = new Map<string, string | undefined>();
  const flagged = new Set<string>();
  // Blocks reached although they were not among the held ones.
  const far = new Set<string>();
  // Blocks written more than once that a walk has reached.
  const met = new Set<string>();
  // Blocks no walk has reached so far: orphans when the file ends.
  const loose = new Set<string>();
  // ponytail: once the index is open nothing more is held, so the rest of a
  // file with a single link across shards is read block by block. Keep
  // holding per shard if such files turn up.
  const index = (): Promise<CarIndexedReader> => {
    if (!state.index) {
      logger.warn(
        `A block of ${file} is not stored with the shard that links to it; indexing the whole file to look blocks up by CID, which is slower and takes more memory`
      );
      state.index = CarIndexedReader.fromFile(file);
    }
    return state.index;
  };
  const find = async (key: string): Promise<Uint8Array | undefined> => {
    const kept = pending.get(key);
    if (kept instanceof Uint8Array) {
      return kept;
    }
    if (kept) {
      state.handle ??= fsPromises.open(file, 'r');
      const bytes = new Uint8Array(kept.length);
      await (await state.handle).read(bytes, 0, kept.length, kept.offset);
      return bytes;
    }
    if (key === top) {
      return state.head;
    }
    return far.has(key)
      ? (await (await index()).get(CID.parse(key)))?.bytes
      : undefined;
  };
  // A link missing from the file is an index finding when a shard lists it,
  // whichever block is met first; a graph walk only notes it for the end.
  const resolve = async (
    check: 'index' | 'graph',
    link: CID,
    from: string,
    context: Partial<Row> = {}
  ): Promise<boolean> => {
    const key = link.toString();
    if (pending.has(key) || far.has(key)) {
      return true;
    }
    const known = absent.has(key);
    if (
      !known &&
      spots(link).every(marked) &&
      (await (await index()).has(link))
    ) {
      far.add(key);
      return true;
    }
    if (check === 'graph') {
      if (!known) {
        absent.set(key, from);
      }
      return false;
    }
    if (!known || absent.get(key) !== undefined) {
      absent.set(key, undefined);
      await report('index', {
        block: from,
        message: `link ${key} is not in the car`,
        ...context,
      });
    }
    return false;
  };
  const flag = async (key: string, message: string) => {
    if (flagged.has(key)) {
      return;
    }
    flagged.add(key);
    await report('graph', { block: key, message });
  };
  // Follow every link below `start`; each block reached lands in `seen`.
  const walk = async (start: { cid: CID; from: string }, seen: Set<string>) => {
    const queue = [start];
    while (queue.length > 0) {
      const next = queue.pop() as { cid: CID; from: string };
      const key = next.cid.toString();
      if (seen.has(key) || !(await resolve('graph', next.cid, next.from))) {
        continue;
      }
      seen.add(key);
      if (twins.has(key)) {
        met.add(key);
      }
      if (next.cid.code === raw.code) {
        continue;
      }
      if (next.cid.code !== dagJSON.code) {
        await flag(key, `unsupported codec 0x${next.cid.code.toString(16)}`);
        continue;
      }
      const bytes = await find(key);
      const value = bytes ? decodeDagJson(bytes) : undefined;
      if (value === undefined) {
        await flag(key, 'block is not dag-json');
        continue;
      }
      links(value).forEach((cid) => queue.push({ cid, from: key }));
    }
  };
  // Let go of the blocks held for one walk. One it did not reach is an orphan
  // unless another walk reaches it: an earlier walk can only have done so by
  // CID or through a second copy, and a later walk takes it back out.
  const release = (seen: Set<string>) => {
    seen.forEach((key) => loose.delete(key));
    for (const key of pending.keys()) {
      if (!seen.has(key) && !far.has(key) && !met.has(key)) {
        loose.add(key);
      }
    }
    pending.clear();
    state.held = 0;
  };

  logger.info(`Checking ${head.shards.length} shards and their properties`);
  await services.schemaCacheService.warm();
  services.jsonValidatorService.setBlockSource(find);
  const waiting = new Set(
    head.shards.flatMap((shard) => (shard ? [shard.toString()] : []))
  );
  const done = new Set<string>();
  try {
    // Each listed shard is checked when its block arrives.
    await scan(async (block) => {
      const key = block.cid.toString();
      // A second copy under the same shard adds nothing.
      if (!pending.has(key)) {
        // Bytes are worth holding while a shard block can still claim them.
        const wanted = waiting.size > 0 && !state.index;
        const fits = wanted && state.held + block.bytes.length <= hold;
        state.held += fits ? block.bytes.length : 0;
        summary.spilled += wanted && !fits ? 1 : 0;
        pending.set(
          key,
          fits
            ? block.bytes
            : { offset: block.offset, length: block.bytes.length }
        );
      }
      if (!waiting.delete(key)) {
        return;
      }
      done.add(key);
      // Once per listing: an index that names a shard twice holds its properties twice.
      const entries: IndexEntry[] = [];
      for (const listed of head.shards) {
        if (!listed?.equals(block.cid)) {
          continue;
        }
        const listing = await readShard(
          block.cid,
          block.bytes,
          report,
          resolve
        );
        (listing ?? []).forEach((item) => entries.push(item));
      }
      summary.properties += entries.length;
      const seen = new Set<string>();
      await walk({ cid: block.cid, from: top }, seen);
      for (const item of entries) {
        const rows: ErrorEntry[] = [];
        for (const group of item.groups) {
          const context = {
            block: group.data.toString(),
            property: item.property.toString(),
            group: group.schema,
          };
          const data = await find(context.block);
          const value =
            data && group.data.code === dagJSON.code
              ? decodeDagJson(data)
              : undefined;
          if (!data || value === undefined) {
            await report('lexicon', {
              ...context,
              message: data
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
            JSON.parse(new TextDecoder().decode(data)),
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
      release(seen);
    });
    // The whole file went by without these shard blocks.
    for (const shard of head.shards) {
      if (shard && waiting.has(shard.toString())) {
        await resolve('index', shard, top);
      }
    }
    // The index itself, anything else it links to, and whatever follows the last shard.
    const seen = new Set(done);
    await walk({ cid: head.root, from: '' }, seen);
    release(seen);
    await checkCount(head, summary.properties, report);
    for (const [key, from] of absent) {
      if (from !== undefined) {
        await report('graph', {
          block: from,
          message: `link ${key} is not in the car`,
        });
      }
    }
    for (const key of loose) {
      await report('orphans', {
        block: key,
        message: 'block is not reachable from the root',
      });
    }
    summary.lookups = far.size;
  } finally {
    services.jsonValidatorService.setBlockSource(undefined);
    await (await state.index)?.close();
    await (await state.handle)?.close();
  }
  return summary;
}
