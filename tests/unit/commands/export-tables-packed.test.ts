import { describe, it, expect } from 'vitest';
import { promises as fsPromises } from 'fs';
import path from 'path';
import { zstdDecompressSync } from 'zlib';
import { parquetReadObjects } from 'hyparquet';
import { handleExportTables } from '../../../src/commands/export-tables.js';
import { CID } from 'multiformats/cid';
import { CarOutputService } from '../../../src/services/car-output.service.js';
import { CidCalculatorService } from '../../../src/services/cid-calculator.service.js';
import { json } from '../../helpers/county-car.js';
import {
  COUNTY,
  EXPECTED,
  hash,
  scratch,
  services,
  VECTORS,
} from '../../helpers/packed.js';

const fresh = await scratch('export-packed-');

describe('export-tables with packed data groups', () => {
  /** Hash vector 2 linked or packed, export it, and read every table back. */
  const tables = async (packed: boolean) => {
    const out = await fresh();
    const hashed = await hash(
      path.join(VECTORS, 'vector-2', 'property'),
      out,
      packed
    );
    const result = await handleExportTables(
      {
        input: hashed.outputCar,
        output: path.join(out, 'tables'),
        silent: true,
        cwd: out,
      },
      services()
    );
    const rows: Record<string, Record<string, unknown>[]> = {};
    for (const name of Object.keys(result!.tables)) {
      const bytes = await fsPromises.readFile(
        path.join(out, 'tables', name, 'part-00000.parquet')
      );
      rows[name] = await parquetReadObjects({
        file: bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength
        ),
        compressors: { ZSTD: (input) => zstdDecompressSync(input) },
      });
    }
    return { result: result!, rows };
  };

  it('writes the same table rows from a packed county CAR as from the linked one', async () => {
    const linked = await tables(false);
    const packed = await tables(true);

    expect(packed.result.tables).toEqual(linked.result.tables);
    expect(linked.result.tables).toMatchObject({
      properties: { rows: 1 },
      property: { rows: 1 },
      address: { rows: 1 },
      parcel: { rows: 1 },
      tax: { rows: 2 },
      property_has_address: { rows: 1 },
      property_has_tax: { rows: 2 },
      address_has_parcel: { rows: 1 },
    });
    // Only the County data CID of `properties` and the county root differ.
    expect(linked.rows.properties[0][COUNTY]).toBe(EXPECTED['vector-2'].linked);
    expect(packed.rows.properties[0][COUNTY]).toBe(EXPECTED['vector-2'].packed);
    expect({
      ...packed.rows,
      properties: [{ ...packed.rows.properties[0], [COUNTY]: '' }],
    }).toEqual({
      ...linked.rows,
      properties: [{ ...linked.rows.properties[0], [COUNTY]: '' }],
    });
    expect(packed.result.countyRoot).not.toBe(linked.result.countyRoot);
  });

  it('names the data group whose packed root cannot be unpacked', async () => {
    const tmp = await fresh();
    const text = (
      await fsPromises.readFile(
        path.join(VECTORS, 'vector-2', 'packed.json'),
        'utf-8'
      )
    ).replace('"tax_year":2023', '"tax_year":1e999');
    const cid = CID.parse(
      await new CidCalculatorService().calculateCidFromCanonicalJson(text)
    );
    const car = new CarOutputService(path.join(tmp, 'broken.car'));
    await car.open();
    await car.put(cid, Buffer.from(text));
    await car.property(cid, { [COUNTY]: cid });
    await car.close();

    await expect(
      handleExportTables(
        { input: car.target, output: path.join(tmp, 'tables'), silent: true },
        services()
      )
    ).rejects.toThrow(`packed data group ${cid} cannot be read`);
  });

  it('refuses a packed root that is not well formed instead of writing its rows', async () => {
    const tmp = await fresh();
    const source = path.join(VECTORS, 'vector-2', 'packed.json');
    const packed = JSON.parse(await fsPromises.readFile(source, 'utf-8'));
    packed.relationships.property_has_tax[0].to = EXPECTED.property;
    const root = await json(packed);
    const car = new CarOutputService(path.join(tmp, 'county.car'));
    await car.open();
    await car.put(root.cid, root.bytes);
    await car.property(root.cid, { [COUNTY]: root.cid });
    await car.close();

    await expect(
      handleExportTables(
        { input: car.target, output: path.join(tmp, 'tables'), silent: true },
        services()
      )
    ).rejects.toThrow(`to "${EXPECTED.property}" is not a key of "entities"`);
  });
});
