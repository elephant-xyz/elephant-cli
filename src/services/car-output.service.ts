import {
  createReadStream,
  createWriteStream,
  promises as fsPromises,
} from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
// @ipld/car is pinned to 5.4.4, the last release on multiformats 13 (what the rest of the tree uses).
import { CarWriter } from '@ipld/car';
import { CID } from 'multiformats/cid';

async function collect(out: AsyncIterable<Uint8Array>): Promise<Buffer> {
  const parts: Uint8Array[] = [];
  for await (const part of out) {
    parts.push(part);
  }
  return Buffer.concat(parts);
}

/**
 * Streams blocks into one CAR file, deduplicated by CID. A CAR header needs
 * the roots up front, but roots are only known when the run ends, so blocks
 * are appended to `<target>.tmp` as they arrive and `close()` writes the
 * header followed by those bytes. No block bytes are held between calls.
 */
export class CarOutputService {
  private readonly seen = new Set<string>();
  readonly roots: CID[] = [];
  private readonly channel = CarWriter.createAppender();
  private readonly drained: Promise<void>;

  constructor(readonly target: string) {
    this.drained = fsPromises
      .mkdir(path.dirname(target), { recursive: true })
      .then(() =>
        pipeline(Readable.from(this.channel.out), createWriteStream(this.temp))
      );
  }

  private get temp(): string {
    return `${this.target}.tmp`;
  }

  get blocks(): number {
    return this.seen.size;
  }

  async put(cid: string, bytes: Uint8Array): Promise<void> {
    if (this.seen.has(cid)) {
      return;
    }
    this.seen.add(cid);
    await this.channel.writer.put({ cid: CID.parse(cid), bytes });
  }

  root(cid: string): void {
    this.roots.push(CID.parse(cid));
  }

  async close(): Promise<void> {
    await this.channel.writer.close();
    await this.drained;
    const header = CarWriter.create(this.roots);
    const [bytes] = await Promise.all([
      collect(header.out),
      header.writer.close(),
    ]);
    await fsPromises.writeFile(this.target, bytes);
    await pipeline(
      createReadStream(this.temp),
      createWriteStream(this.target, { flags: 'a' })
    );
    await fsPromises.rm(this.temp);
  }
}
