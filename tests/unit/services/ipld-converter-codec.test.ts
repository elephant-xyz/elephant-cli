import { describe, it, expect } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { CID } from 'multiformats/cid';
import * as dagJSON from '@ipld/dag-json';
import * as raw from 'multiformats/codecs/raw';
import { IPLDConverterService } from '../../../src/services/ipld-converter.service.js';
import { CidCalculatorService } from '../../../src/services/cid-calculator.service.js';
import { IPLDCanonicalizerService } from '../../../src/services/ipld-canonicalizer.service.js';
import { PinataService } from '../../../src/services/pinata.service.js';

describe('IPLDConverterService linked-file codec', () => {
  it('keeps the dag-json CID when Pinata pins the same bytes under a raw CID', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ipld-codec-'));
    const child = { request_identifier: 'x', value: 1 };
    await fs.writeFile(path.join(dir, 'child.json'), JSON.stringify(child));

    const calculator = new CidCalculatorService();
    const canonicalizer = new IPLDCanonicalizerService();
    const canonical = canonicalizer.canonicalize(child);
    const pinned = await calculator.calculateCidV1ForRawData(
      Buffer.from(canonical, 'utf-8')
    );
    expect(CID.parse(pinned).code).toBe(raw.code);

    const pinata = {
      uploadBatch: async () => [{ success: true, cid: pinned }],
    } as unknown as PinataService;
    const converter = new IPLDConverterService(
      dir,
      pinata,
      calculator,
      canonicalizer
    );

    const result = await converter.convertToIPLD(
      { link: { '/': './child.json' } },
      path.join(dir, 'parent.json')
    );

    const linked = CID.parse(result.convertedData.link['/']);
    expect(linked.code).toBe(dagJSON.code);
    expect(linked.multihash.bytes).toEqual(CID.parse(pinned).multihash.bytes);
    expect(result.linkedCIDs).toEqual([linked.toString()]);
  });

  it('returns the uploaded CID when Pinata pinned different bytes', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ipld-codec-'));
    await fs.writeFile(path.join(dir, 'child.json'), '{"value":1}');
    const other = 'bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku';
    const pinata = {
      uploadBatch: async () => [{ success: true, cid: other }],
    } as unknown as PinataService;
    const converter = new IPLDConverterService(dir, pinata);

    const result = await converter.convertToIPLD(
      { link: { '/': './child.json' } },
      path.join(dir, 'parent.json')
    );
    expect(result.convertedData.link['/']).toBe(other);
  });
});
