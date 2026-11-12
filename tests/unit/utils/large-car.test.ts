import { promises as fsPromises } from 'fs';
import os from 'os';
import path from 'path';
import { CarIndexedReader, CarWriter } from '@ipld/car';
import { describe, expect, it } from 'vitest';
import {
  BigMap,
  BigSet,
  cidKey,
  LargeCarReader,
} from '../../../src/utils/large-car.js';
import { json, text, type Block } from '../../helpers/county-car.js';

async function writeCar(roots: Block[], blocks: Block[]): Promise<string> {
  const dir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'large-car-'));
  const file = path.join(dir, 'test.car');
  const { writer, out } = CarWriter.create(roots.map((root) => root.cid));
  const chunks: Uint8Array[] = [];
  const done = (async () => {
    for await (const chunk of out) {
      chunks.push(chunk);
    }
  })();
  for (const block of blocks) {
    await writer.put(block);
  }
  await writer.close();
  await done;
  await fsPromises.writeFile(file, Buffer.concat(chunks));
  return file;
}

describe('LargeCarReader', () => {
  it('answers getRoots, has, get and cids exactly like CarIndexedReader', async () => {
    const leaves = await Promise.all(
      Array.from({ length: 300 }, (_, i) => text(`leaf ${i}`))
    );
    const root = await json({ leaves: leaves.map((leaf) => leaf.cid) });
    // A repeated block: both readers serve its first copy and list it twice in cids().
    const file = await writeCar([root], [root, ...leaves, leaves[7]]);
    const absent = await text('not in the car');

    const large = await LargeCarReader.fromFile(file);
    const indexed = await CarIndexedReader.fromFile(file);
    try {
      expect((await large.getRoots()).map(String)).toEqual(
        (await indexed.getRoots()).map(String)
      );
      expect(large.blockCount).toBe(301);
      for (const block of [root, ...leaves]) {
        expect(await large.has(block.cid)).toBe(true);
        expect((await large.get(block.cid))?.bytes).toEqual(
          (await indexed.get(block.cid))?.bytes
        );
      }
      expect(await large.has(absent.cid)).toBe(false);
      expect(await large.get(absent.cid)).toBeUndefined();

      const fromLarge: string[] = [];
      for await (const cid of large.cids()) {
        fromLarge.push(cid.toString());
      }
      const fromIndexed: string[] = [];
      for await (const cid of indexed.cids()) {
        fromIndexed.push(cid.toString());
      }
      expect(fromLarge).toHaveLength(302);
      expect(new Set(fromLarge)).toEqual(new Set(fromIndexed));
      expect(fromLarge.slice(0, 3)).toEqual(
        [root, leaves[0], leaves[1]].map((block) => block.cid.toString())
      );
    } finally {
      await large.close();
      await indexed.close();
    }
  });

  it('grows its position arrays past their first size', async () => {
    const leaves = await Promise.all(
      Array.from({ length: 1100 }, (_, i) => text(`block ${i}`))
    );
    const file = await writeCar([leaves[0]], leaves);
    const large = await LargeCarReader.fromFile(file);
    try {
      expect(large.blockCount).toBe(1100);
      expect(
        new TextDecoder().decode((await large.get(leaves[1099].cid))?.bytes)
      ).toBe('block 1099');
    } finally {
      await large.close();
    }
  });
});

describe('BigSet and BigMap', () => {
  it('count distinct keys across shards', async () => {
    const keys = (
      await Promise.all(Array.from({ length: 500 }, (_, i) => text(`k${i}`)))
    ).map((block) => cidKey(block.cid));
    const set = new BigSet();
    const map = new BigMap();
    keys.forEach((key, i) => {
      set.add(key).add(key);
      map.set(key, i).set(key, i);
    });
    expect(set.size).toBe(500);
    expect(map.size).toBe(500);
    expect(keys.every((key) => set.has(key))).toBe(true);
    expect(map.get(keys[42])).toBe(42);
    expect(set.has('missing')).toBe(false);
  });

  it('hold more keys than one Set allows', () => {
    // V8 refuses a 2^24 + 1st entry in a single Set; 64 shards take far more.
    const set = new BigSet();
    const total = (1 << 24) + 1000;
    for (let i = 0; i < total; i += 1) {
      set.add(`${i}\u0000${String.fromCharCode(i & 255)}`);
    }
    expect(set.size).toBe(total);
  }, 120_000);
});
