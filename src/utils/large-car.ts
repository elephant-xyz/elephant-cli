import { createReadStream } from 'fs';
import { open, type FileHandle } from 'fs/promises';
import { CarIndexer } from '@ipld/car';
import { CID } from 'multiformats/cid';

/**
 * Reading county CARs with more blocks than one JavaScript Map or Set can hold.
 *
 * V8 caps a Map or Set at 2^24 (16,777,216) entries, whatever the heap size. `CarIndexedReader`
 * from `@ipld/car` keeps every block of a CAR in one Map (and every CID in one array), so it fails
 * on a county CAR above that size (Cook County, IL: 31.5M blocks) with "Map maximum size exceeded".
 * The pieces here split those collections across shards and key them by the CID's bytes rather
 * than its string form, which also roughly halves the memory per block.
 */

/** Shards per collection: 64 × 2^24 ≈ 1.07 billion entries. */
export const SHARDS = 64;

/** A compact, exact key for a CID: its binary form as a one-byte-per-char string. */
export function cidKey(cid: CID): string {
  return String.fromCharCode(...cid.bytes);
}

// The last byte of a CID is the end of its multihash digest: uniformly distributed for sha256.
export const shardOf = (key: string): number =>
  key.charCodeAt(key.length - 1) & (SHARDS - 1);

/** A Set of strings that is not limited to 2^24 entries. */
export class BigSet {
  private readonly shards: Set<string>[] = Array.from(
    { length: SHARDS },
    () => new Set<string>()
  );

  has(key: string): boolean {
    return this.shards[shardOf(key)].has(key);
  }

  private count = 0;

  add(key: string): this {
    const shard = this.shards[shardOf(key)];
    this.count += shard.has(key) ? 0 : 1;
    shard.add(key);
    return this;
  }

  get size(): number {
    return this.count;
  }
}

/** A Map from strings to numbers that is not limited to 2^24 entries. */
export class BigMap {
  private readonly shards: Map<string, number>[] = Array.from(
    { length: SHARDS },
    () => new Map<string, number>()
  );

  get(key: string): number | undefined {
    return this.shards[shardOf(key)].get(key);
  }

  has(key: string): boolean {
    return this.shards[shardOf(key)].has(key);
  }

  private count = 0;

  set(key: string, value: number): this {
    const shard = this.shards[shardOf(key)];
    this.count += shard.has(key) ? 0 : 1;
    shard.set(key, value);
    return this;
  }

  get size(): number {
    return this.count;
  }
}

/** One bit per block of a CAR, by `LargeCarReader.slotOf`: 4 MB for 31.5M blocks instead of a set of CIDs. */
export class BlockMarks {
  private readonly bits: Uint8Array;

  constructor(count: number) {
    this.bits = new Uint8Array(Math.ceil(count / 8));
  }

  has(slot: number): boolean {
    return (this.bits[slot >> 3] & (1 << (slot & 7))) !== 0;
  }

  add(slot: number): this {
    this.bits[slot >> 3] |= 1 << (slot & 7);
    return this;
  }
}

/** What the CAR walkers need from a reader: `CarIndexedReader` and `LargeCarReader` both fit. */
export interface CarBlockReader {
  getRoots(): Promise<CID[]>;
  has(cid: CID): Promise<boolean>;
  get(cid: CID): Promise<{ cid: CID; bytes: Uint8Array } | undefined>;
}

/**
 * Random access to the blocks of a CAR file of any size, like `CarIndexedReader.fromFile`: one
 * streaming pass indexes where each block's bytes are, then `get` reads them from the file.
 * Positions live in typed arrays (12 bytes a block); the CID lookup is a sharded map. `cids()`
 * streams the file again rather than keeping a list of every CID.
 */
export class LargeCarReader implements CarBlockReader {
  private constructor(
    private readonly path: string,
    private readonly file: FileHandle,
    private readonly roots: CID[],
    private readonly slots: BigMap,
    private readonly offsets: Float64Array,
    private readonly lengths: Uint32Array
  ) {}

  static async fromFile(path: string): Promise<LargeCarReader> {
    const indexer = await CarIndexer.fromIterable(createReadStream(path));
    const roots = await indexer.getRoots();
    const slots = new BigMap();
    const positions = {
      offsets: new Float64Array(1 << 20),
      lengths: new Uint32Array(1 << 20),
    };
    for await (const entry of indexer) {
      const key = cidKey(entry.cid);
      if (slots.has(key)) {
        continue; // a repeated block: the first copy serves, as in CarIndexedReader
      }
      const slot = slots.size;
      if (slot === positions.offsets.length) {
        const offsets = new Float64Array(slot * 2);
        offsets.set(positions.offsets);
        const lengths = new Uint32Array(slot * 2);
        lengths.set(positions.lengths);
        Object.assign(positions, { offsets, lengths });
      }
      positions.offsets[slot] = entry.blockOffset;
      positions.lengths[slot] = entry.blockLength;
      slots.set(key, slot);
    }
    const file = await open(path, 'r');
    return new LargeCarReader(
      path,
      file,
      roots,
      slots,
      positions.offsets,
      positions.lengths
    );
  }

  /** Distinct blocks indexed. */
  get blockCount(): number {
    return this.slots.size;
  }

  async getRoots(): Promise<CID[]> {
    return this.roots;
  }

  /**
   * The block's position among the distinct blocks (0 to blockCount - 1), or undefined when the CAR
   * lacks it. Lets a walker mark blocks in a `BlockMarks` instead of keeping their CIDs.
   */
  slotOf(cid: CID): number | undefined {
    return this.slots.get(cidKey(cid));
  }

  async has(cid: CID): Promise<boolean> {
    return this.slots.has(cidKey(cid));
  }

  async get(cid: CID): Promise<{ cid: CID; bytes: Uint8Array } | undefined> {
    const slot = this.slots.get(cidKey(cid));
    if (slot === undefined) {
      return undefined;
    }
    const bytes = new Uint8Array(this.lengths[slot]);
    // A regular file returns every requested byte unless it ends first.
    const result = await this.file.read(
      bytes,
      0,
      bytes.length,
      this.offsets[slot]
    );
    if (result.bytesRead !== bytes.length) {
      throw new Error(`${this.path} ended inside block ${cid}`);
    }
    return { cid, bytes };
  }

  /** Every CID in file order, repeats included, read from the file again. */
  async *cids(): AsyncGenerator<CID> {
    const indexer = await CarIndexer.fromIterable(createReadStream(this.path));
    for await (const entry of indexer) {
      yield entry.cid;
    }
  }

  async close(): Promise<void> {
    await this.file.close();
  }
}
