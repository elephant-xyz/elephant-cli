import { createWriteStream, rmSync, promises as fsPromises } from 'fs';
import { once } from 'events';
import path from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
// @ipld/car is pinned to 5.4.4, the last release on multiformats 13 (what the rest of the tree uses).
import { CarWriter } from '@ipld/car';
import * as dagJSON from '@ipld/dag-json';
import { CID } from 'multiformats/cid';
import { sha256 } from 'multiformats/hashes/sha2';

// dag-json CID of `{}`: same byte length as the index CID that replaces it in the header.
const PLACEHOLDER = CID.parse(
  'baguqeeraiqjw7i2vwntyuekgvulpp2det2kpwt6cd7tx5ayqybqpmhfk76fa'
);

interface Property {
  property_cid: CID;
  data_groups: Record<string, CID>;
}

async function encode(
  value: unknown
): Promise<{ cid: CID; bytes: Uint8Array }> {
  const bytes = dagJSON.encode(value);
  return {
    cid: CID.create(1, dagJSON.code, await sha256.digest(bytes)),
    bytes,
  };
}

/**
 * Streams blocks into one CAR file whose single root is a county index block:
 * `{ label: "CountyIndex", version: 1, properties: <count>, shards: [link...] }`,
 * each shard `{ properties: [{ property_cid: link, data_groups: { <schema cid>: link } }] }`
 * holding at most `shardSize` properties. The header is written first with a
 * placeholder root of the same byte length and patched with the index CID on
 * `close()`, so the file is written in one pass with nothing held in memory
 * beyond the current partial shard.
 */
export class CarOutputService {
  private blocks = 0;
  private properties = 0;
  private pending: Property[] = [];
  private readonly shards: CID[] = [];
  private readonly channel = CarWriter.create([PLACEHOLDER]);
  private drained: Promise<void> = Promise.resolve();
  private done = false;
  private readonly purge = () => {
    if (!this.done) {
      rmSync(this.target, { force: true });
    }
  };

  constructor(
    readonly target: string,
    private readonly shardSize = 5000
  ) {}

  async open(): Promise<void> {
    await fsPromises.mkdir(path.dirname(this.target), { recursive: true });
    const stream = createWriteStream(this.target);
    // Surface an unwritable target here, before any hashing work.
    await once(stream, 'open');
    this.drained = pipeline(Readable.from(this.channel.out), stream);
    this.drained.catch(() => undefined);
    process.on('exit', this.purge);
  }

  /**
   * Append one block. The put is raced against the file pipeline so a write
   * error mid-run (ENOSPC, closed disk) rejects here instead of hanging.
   * Blocks are not deduplicated across properties; importers dedupe by CID
   * and a repeated block costs only file bytes, while a seen-CID set would
   * grow to hundreds of MB for a county.
   */
  async put(cid: CID, bytes: Uint8Array): Promise<void> {
    await Promise.race([this.channel.writer.put({ cid, bytes }), this.drained]);
    this.blocks += 1;
  }

  async property(cid: CID, groups: Record<string, CID>): Promise<void> {
    this.pending.push({ property_cid: cid, data_groups: groups });
    this.properties += 1;
    if (this.pending.length >= this.shardSize) {
      await this.flush();
    }
  }

  private async flush(): Promise<void> {
    const shard = await encode({ properties: this.pending });
    this.pending = [];
    await this.put(shard.cid, shard.bytes);
    this.shards.push(shard.cid);
  }

  /** Finalize the file; returns the block count and the index CID. */
  async close(): Promise<{ blocks: number; root: string }> {
    if (this.pending.length > 0) {
      await this.flush();
    }
    const index = await encode({
      label: 'CountyIndex',
      version: 1,
      properties: this.properties,
      shards: this.shards,
    });
    await this.put(index.cid, index.bytes);
    await Promise.all([this.channel.writer.close(), this.drained]);
    const fd = await fsPromises.open(this.target, 'r+');
    await CarWriter.updateRootsInFile(fd, [index.cid]).finally(() =>
      fd.close()
    );
    this.done = true;
    process.off('exit', this.purge);
    return { blocks: this.blocks, root: index.cid.toString() };
  }

  /** Remove the partial file unless `close()` already finalized it. */
  async abort(): Promise<void> {
    if (this.done) {
      return;
    }
    this.done = true;
    process.off('exit', this.purge);
    void this.channel.writer.close().catch(() => undefined);
    await this.drained.catch(() => undefined);
    await fsPromises.rm(this.target, { force: true });
  }
}
