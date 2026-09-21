import {
  createReadStream,
  createWriteStream,
  promises as fsPromises,
} from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { constants as zlib, zstdCompressSync } from 'zlib';
// @ipld/car is pinned to 5.4.4, the last release on multiformats 13 (what the rest of the tree uses).
import { CarIndexedReader, CarWriter } from '@ipld/car';
import * as dagJSON from '@ipld/dag-json';
import { CID } from 'multiformats/cid';
import { sha256 } from 'multiformats/hashes/sha2';
import { importer } from 'ipfs-unixfs-importer';
import { ParquetWriter, fileWriter } from 'hyparquet-writer';
import { walkIndex } from './car-validator.service.js';
import { decodeDagJson } from './cid-calculator.service.js';
import { JSONSchema, SchemaCacheService } from './schema-cache.service.js';
import { schemaManifestUrl } from '../config/constants.js';
import { logger } from '../utils/logger.js';

export interface ExportTablesOptions {
  /** County CAR written by `hash --output-car`. */
  input: string;
  /** Directory that receives `<table>/part-NNNNN.parquet` and `tables.car`. */
  output: string;
  /** Cap on the bytes of one part; default 1 GiB. */
  partSize?: number;
  /** Page compression; default `zstd` (level 3 through node:zlib). */
  codec?: Codec;
}

export type Codec = 'zstd' | 'snappy';

export interface ExportTablesResult {
  output: string;
  car: string;
  /** CID of the `CountyTables` block, the single root of `tables.car`. */
  root: string;
  countyRoot: string;
  partSizeBytes: number;
  codec: Codec;
  tables: Record<string, { rows: number; parts: number }>;
  parts: number;
  exportedAt: string;
}

type Kind = 'STRING' | 'DOUBLE' | 'INT64' | 'BOOLEAN';
type Cell = string | number | bigint | boolean | null;
type Options = ConstructorParameters<typeof ParquetWriter>[0];
type Schema = Options['schema'];
type Meta = NonNullable<
  ConstructorParameters<typeof ParquetWriter>[0]['kvMetadata']
>;

interface Column {
  name: string;
  kind: Kind;
}

interface Table {
  name: string;
  columns: Column[];
}

interface Part {
  cid: CID;
  rows: number;
  bytes: number;
}

/** Parquet codec name and page compressor per `--codec`; snappy is the writer's built-in. */
const CODECS: Record<Codec, Pick<Options, 'codec' | 'compressors'>> = {
  zstd: {
    codec: 'ZSTD',
    compressors: {
      ZSTD: (input) =>
        zstdCompressSync(input, {
          params: { [zlib.ZSTD_c_compressionLevel]: 3 },
        }),
    },
  },
  snappy: { codec: 'SNAPPY' },
};

const KINDS: Record<string, Kind> = {
  number: 'DOUBLE',
  integer: 'INT64',
  boolean: 'BOOLEAN',
};
const EXTRAS = ['cid', 'property_cid', 'data_group_cid', 'request_identifier'];
const RELATIONSHIP: Column[] = [
  'relationship_cid',
  'from_cid',
  'to_cid',
  'property_cid',
  'data_group_cid',
].map((name) => ({ name, kind: 'STRING' }));

/** Parquet kind of a class property: the first non-null JSON type; objects, arrays and untyped values are UTF8 JSON. */
function kind(property: JSONSchema | undefined): Kind {
  const type = ([] as unknown[])
    .concat(property?.type ?? [])
    .find((item) => item !== 'null');
  return KINDS[String(type)] ?? 'STRING';
}

function cell(value: unknown, column: Column, where: string): Cell {
  if (value === null || value === undefined) {
    return null;
  }
  const link = CID.asCID(value);
  if (column.kind === 'STRING') {
    return typeof value === 'string'
      ? value
      : link
        ? link.toString()
        : JSON.stringify(value);
  }
  if (column.kind === 'BOOLEAN' && typeof value === 'boolean') {
    return value;
  }
  if (column.kind === 'DOUBLE' && typeof value === 'number') {
    return value;
  }
  if (column.kind === 'INT64' && Number.isInteger(value)) {
    return BigInt(value as number);
  }
  throw new Error(
    `${where}: column ${column.name} expects ${column.kind}, got ${JSON.stringify(value)}`
  );
}

/** UnixFS file CID of `file` as kubo's `add --cid-version 1 --raw-leaves` computes it; blocks are hashed, not kept. */
async function fileCid(file: string): Promise<CID> {
  const sink = { put: async (cid: CID) => cid };
  const source = [{ content: createReadStream(file) }];
  for await (const entry of importer(source, sink, {
    cidVersion: 1,
    rawLeaves: true,
  })) {
    return entry.cid;
  }
  throw new Error(`Importer produced no CID for ${file}`);
}

/**
 * Rows of one table, streamed into `part-NNNNN.parquet` files. Pending rows
 * become a row group on `flush()`; a part is sealed when the next row's
 * estimated bytes would push it past the cap, so the split depends only on
 * the rows and the same input always yields the same parts.
 */
class TableWriter {
  private rows: Cell[][] = [];
  private pending = 0;
  private part?: {
    file: string;
    writer: ReturnType<typeof fileWriter>;
    parquet: ParquetWriter;
    rows: number;
  };
  readonly parts: Part[] = [];
  private readonly schema: Schema;

  constructor(
    private readonly dir: string,
    readonly table: Table,
    private readonly cap: number,
    private readonly meta: Meta,
    private readonly codec: Codec
  ) {
    this.schema = [
      { name: 'root', num_children: table.columns.length },
      ...table.columns.map((column) =>
        column.kind === 'STRING'
          ? {
              name: column.name,
              type: 'BYTE_ARRAY' as const,
              converted_type: 'UTF8' as const,
              repetition_type: 'OPTIONAL' as const,
            }
          : {
              name: column.name,
              type: column.kind,
              repetition_type: 'OPTIONAL' as const,
            }
      ),
    ];
  }

  get rowCount(): number {
    return this.parts.reduce((sum, part) => sum + part.rows, 0);
  }

  async push(values: Cell[]): Promise<void> {
    const size = values.reduce<number>(
      (sum, value) => sum + (typeof value === 'string' ? value.length : 8),
      8
    );
    const held = (this.part?.writer.offset ?? 0) + this.pending;
    if (held > 0 && held + size > this.cap) {
      await this.seal();
    }
    this.rows.push(values);
    this.pending += size;
  }

  get held(): number {
    return this.pending;
  }

  async flush(): Promise<void> {
    if (this.rows.length === 0) {
      return;
    }
    const part = this.part ?? (await this.open());
    await part.parquet.write({
      columnData: this.table.columns.map((column, index) => ({
        name: column.name,
        data: this.rows.map((row) => row[index]),
        codec: CODECS[this.codec].codec,
      })),
      rowGroupSize: this.rows.length,
    });
    part.rows += this.rows.length;
    this.rows = [];
    this.pending = 0;
  }

  private async open() {
    const index = this.parts.length;
    const file = path.join(
      this.dir,
      this.table.name,
      `part-${String(index).padStart(5, '0')}.parquet`
    );
    await fsPromises.mkdir(path.dirname(file), { recursive: true });
    const writer = fileWriter(file);
    this.part = {
      file,
      writer,
      parquet: new ParquetWriter({
        ...CODECS[this.codec],
        writer,
        schema: this.schema,
        kvMetadata: [
          ...this.meta,
          { key: 'elephant.table', value: this.table.name },
          { key: 'elephant.part', value: String(index) },
        ],
      }),
      rows: 0,
    };
    return this.part;
  }

  async seal(): Promise<void> {
    await this.flush();
    const part = this.part;
    if (!part) {
      return;
    }
    this.part = undefined;
    await part.parquet.finish();
    const cid = await fileCid(part.file);
    const bytes = (await fsPromises.stat(part.file)).size;
    this.parts.push({ cid, rows: part.rows, bytes });
    logger.info(
      `Sealed ${path.relative(this.dir, part.file)} (${part.rows} rows, ${bytes} bytes, ${cid})`
    );
  }
}

/**
 * Walk a county CAR (root -> shards -> data-group roots -> relationships ->
 * entities) and write one Parquet table per lexicon class, one per
 * relationship type, and `properties` from the index. The table of an entity
 * is the class its relationship schema names for that end (`from`/`to`
 * `cid` -> class schema `title`), never the file name. `tables.car` holds one
 * dag-json `CountyTables` block whose part links are UnixFS file CIDs, so a
 * kubo `add --cid-version 1 --raw-leaves` of a part returns the recorded CID.
 * Pages are Zstd level 3 through node:zlib unless `codec` says snappy.
 */
export async function exportTables(
  options: ExportTablesOptions,
  services: { schemaCacheService: SchemaCacheService }
): Promise<ExportTablesResult> {
  const cap = options.partSize ?? 1 << 30;
  const codec = options.codec ?? 'zstd';
  const reader = await CarIndexedReader.fromFile(options.input);
  const run = async (): Promise<ExportTablesResult> => {
    const fail = (message: string): never => {
      throw new Error(message);
    };
    const index = await walkIndex(
      reader,
      async (check, row) => fail(`${check}: ${row.message} (${row.block})`),
      async (_check, link, from) =>
        (await reader.has(link)) ||
        fail(`link ${link} from ${from} is not in the car`)
    );
    if (!index) {
      return fail(`${options.input} has no usable county index`);
    }
    const countyRoot = index.root.toString();
    const meta: Meta = [
      { key: 'elephant.county_root', value: countyRoot },
      { key: 'elephant.manifest_url', value: schemaManifestUrl() },
      { key: 'elephant.part_size_bytes', value: String(cap) },
    ];

    const block = async (cid: CID): Promise<Record<string, unknown>> => {
      const got = await reader.get(cid);
      const value =
        got && cid.code === dagJSON.code ? decodeDagJson(got.bytes) : undefined;
      if (!value || typeof value !== 'object') {
        return fail(`block ${cid} is not a dag-json object in the car`);
      }
      return value as Record<string, unknown>;
    };

    // Schemas are resolved once per CID; the class chain comes from the schema, never from a name.
    const classes = new Map<string, Table>();
    const clazz = async (cid: string): Promise<Table> => {
      const known = classes.get(cid);
      if (known) {
        return known;
      }
      const schema = await services.schemaCacheService.get(cid);
      const title = typeof schema.title === 'string' ? schema.title : '';
      const name = title.trim().replace(/\s+/g, '_').toLowerCase();
      if (!name) {
        return fail(`class schema ${cid} has no title`);
      }
      const columns = Object.entries(schema.properties ?? {}).map(
        ([field, property]): Column => ({ name: field, kind: kind(property) })
      );
      for (const extra of EXTRAS) {
        if (!columns.some((column) => column.name === extra)) {
          columns.push({ name: extra, kind: 'STRING' });
        }
      }
      const table = { name, columns };
      classes.set(cid, table);
      return table;
    };
    const chains = new Map<string, Map<string, { from: Table; to: Table }>>();
    const chain = async (cid: string) => {
      const known = chains.get(cid);
      if (known) {
        return known;
      }
      const schema = await services.schemaCacheService.get(cid);
      const ends = new Map<string, { from: Table; to: Table }>();
      for (const [key, reference] of Object.entries(
        schema.properties?.relationships?.properties ?? {}
      )) {
        // A single link keeps `cid` on the property; an array of links keeps it on `items`.
        const pointer =
          reference.cid ?? (reference.items as JSONSchema | undefined)?.cid;
        const relationship =
          typeof pointer === 'string'
            ? await services.schemaCacheService.get(pointer)
            : undefined;
        const from = relationship?.properties?.from?.cid;
        const to = relationship?.properties?.to?.cid;
        if (typeof from !== 'string' || typeof to !== 'string') {
          return fail(
            `relationship ${key} of data group ${cid} does not name from/to class schemas`
          );
        }
        ends.set(key, { from: await clazz(from), to: await clazz(to) });
      }
      chains.set(cid, ends);
      return ends;
    };

    // ponytail: one writer per table, parts split by size; add parallel writers if a county export is measured too slow
    const writers = new Map<string, TableWriter>();
    const writer = (table: Table): TableWriter => {
      const known = writers.get(table.name);
      if (known) {
        return known;
      }
      const made = new TableWriter(options.output, table, cap, meta, codec);
      writers.set(table.name, made);
      return made;
    };
    // Row groups are cut by total pending bytes across tables so memory stays bounded whatever the table count.
    const budget = 64 << 20;
    const drain = async () => {
      const held = [...writers.values()].reduce(
        (sum, item) => sum + item.held,
        0
      );
      if (held < budget) {
        return;
      }
      for (const item of writers.values()) {
        await item.flush();
      }
    };

    const groups = [
      ...new Set(
        index.entries.flatMap((entry) =>
          entry.groups.map((group) => group.schema)
        )
      ),
    ];
    const properties = writer({
      name: 'properties',
      columns: ['property_cid', ...groups].map((name) => ({
        name,
        kind: 'STRING',
      })),
    });
    // ponytail: entity CIDs seen, so a block shared by several relationships lands in one row; spill to disk if a county export is measured too big
    const seen = new Set<string>();
    const entity = async (
      table: Table,
      cid: CID,
      property: string,
      group: string
    ) => {
      const key = cid.toString();
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      const value = await block(cid);
      const extras: Record<string, unknown> = {
        cid: key,
        property_cid: property,
        data_group_cid: group,
        request_identifier: value.request_identifier,
      };
      await writer(table).push(
        table.columns.map((column) =>
          cell(
            column.name in extras ? extras[column.name] : value[column.name],
            column,
            `${table.name} ${key}`
          )
        )
      );
    };

    logger.info(
      `Exporting ${index.entries.length} properties from ${options.input}`
    );
    for (const entry of index.entries) {
      const property = entry.property.toString();
      await properties.push([
        property,
        ...groups.map(
          (schema) =>
            entry.groups
              .find((group) => group.schema === schema)
              ?.data.toString() ?? null
        ),
      ]);
      for (const group of entry.groups) {
        const root = await block(group.data);
        const ends = await chain(group.schema);
        const relationships =
          root.relationships && typeof root.relationships === 'object'
            ? (root.relationships as Record<string, unknown>)
            : {};
        for (const [key, value] of Object.entries(relationships)) {
          const pair = ends.get(key);
          if (!pair) {
            return fail(
              `relationship ${key} in ${group.data} is not in data group schema ${group.schema}`
            );
          }
          for (const item of ([] as unknown[]).concat(value)) {
            const link = CID.asCID(item);
            if (!link) {
              continue;
            }
            const relationship = await block(link);
            const from = CID.asCID(relationship.from);
            const to = CID.asCID(relationship.to);
            if (!from || !to) {
              return fail(`relationship ${link} does not link from and to`);
            }
            await writer({ name: key, columns: RELATIONSHIP }).push([
              link.toString(),
              from.toString(),
              to.toString(),
              property,
              group.schema,
            ]);
            await entity(pair.from, from, property, group.schema);
            await entity(pair.to, to, property, group.schema);
          }
        }
      }
      await drain();
    }

    const tables: Record<string, { rows: number; parts: Part[] }> = {};
    for (const item of writers.values()) {
      await item.seal();
      tables[item.table.name] = { rows: item.rowCount, parts: item.parts };
    }
    const bytes = dagJSON.encode({
      label: 'CountyTables',
      version: 1,
      county_root: index.root,
      part_size_bytes: cap,
      codec,
      tables,
    });
    const root = CID.create(1, dagJSON.code, await sha256.digest(bytes));
    const car = path.join(options.output, 'tables.car');
    const channel = CarWriter.create([root]);
    const drained = pipeline(
      Readable.from(channel.out),
      createWriteStream(car)
    );
    await channel.writer.put({ cid: root, bytes });
    await channel.writer.close();
    await drained;
    return {
      output: options.output,
      car,
      root: root.toString(),
      countyRoot,
      partSizeBytes: cap,
      codec,
      tables: Object.fromEntries(
        Object.entries(tables).map(([name, table]) => [
          name,
          { rows: table.rows, parts: table.parts.length },
        ])
      ),
      parts: Object.values(tables).reduce(
        (sum, table) => sum + table.parts.length,
        0
      ),
      exportedAt: new Date().toISOString(),
    };
  };
  try {
    return await run();
  } finally {
    await reader.close();
  }
}
