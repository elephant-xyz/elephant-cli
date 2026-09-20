import { describe, it, expect } from 'vitest';
import { promises as fsPromises } from 'fs';
import os from 'os';
import path from 'path';
import { CarReader } from '@ipld/car';
import * as dagJSON from '@ipld/dag-json';
import { CID } from 'multiformats/cid';
import { CarOutputService } from '../../../src/services/car-output.service.js';

const cids = [
  'baguqeeraefi3cy4z3j2xvnuta73mktlysxlkqsflbtrpwxsvvxfwbqs6qyra',
  'baguqeeraek5eh2ihcujvsmbv5i6jwmkqvvc3z46qegpyo7mdgm4w2j2z4qda',
  'baguqeerayu4taidffltdqvbkju5pywsxudmmihuexdexoufnzo7ci7wpoewa',
];

describe('CarOutputService', () => {
  it('flushes a full shard and keeps the rest in a final shard', async () => {
    const tmp = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'car-'));
    const target = path.join(tmp, 'index.car');
    const car = new CarOutputService(target, 2);
    await car.open();
    for (const cid of cids) {
      await car.property(cid, { schema: cid });
    }
    const root = await car.close();

    const reader = await CarReader.fromBytes(await fsPromises.readFile(target));
    const roots = await reader.getRoots();
    expect(roots.map(String)).toEqual([root]);
    const index = dagJSON.decode<{ properties: number; shards: CID[] }>(
      (await reader.get(roots[0]))!.bytes
    );
    expect(index.properties).toBe(3);
    expect(index.shards).toHaveLength(2);
    const sizes = await Promise.all(
      index.shards.map(
        async (cid) =>
          dagJSON.decode<{ properties: unknown[] }>(
            (await reader.get(cid))!.bytes
          ).properties.length
      )
    );
    expect(sizes).toEqual([2, 1]);
    // 2 shards + 1 index, no property blocks were put
    expect(car.blocks).toBe(3);
    await fsPromises.rm(tmp, { recursive: true, force: true });
  });
});
