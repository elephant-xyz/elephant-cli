// Compare two `export-tables` outputs table by table: columns, row count and every row.
// usage: HYPARQUET=/path/to/node_modules/hyparquet/src/index.js node compare-tables.mjs <tables-dir-a> <tables-dir-b>
// (hyparquet is the reader elephant-cli 1.x ships; any copy of it will do)
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { zstdDecompressSync } from 'node:zlib';

const { parquetReadObjects, parquetMetadataAsync } = await import(process.env.HYPARQUET || 'hyparquet');
const compressors = { ZSTD: (input) => new Uint8Array(zstdDecompressSync(input)) };

/** A table as its column names with types, and one digest over its rows in sorted order. */
async function table(dir) {
  const rows = [];
  let columns;
  for (const part of readdirSync(dir).filter((name) => name.endsWith('.parquet')).sort()) {
    const buffer = readFileSync(join(dir, part));
    const file = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    const meta = await parquetMetadataAsync(file);
    columns = meta.schema.slice(1).map((column) => `${column.name}:${column.type}${column.converted_type ? `/${column.converted_type}` : ''}${column.repetition_type === 'OPTIONAL' ? '?' : ''}`);
    for (const row of await parquetReadObjects({ file, compressors })) {
      rows.push(JSON.stringify(row, (key, value) => (typeof value === 'bigint' ? Number(value) : value instanceof Date ? value.toISOString() : value)));
    }
  }
  rows.sort();
  const digest = createHash('sha256');
  for (const row of rows) digest.update(row).update('\n');
  return { columns, count: rows.length, digest: digest.digest('hex'), first: rows[0] };
}

const [a, b] = process.argv.slice(2);
const names = (dir) => readdirSync(dir).filter((name) => statSync(join(dir, name)).isDirectory()).sort();
const [ta, tb] = [names(a), names(b)];
console.log('tables:', ta.length, tb.length, JSON.stringify(ta) === JSON.stringify(tb) ? 'same names' : `DIFFERENT ${ta} | ${tb}`);
let differing = 0;
for (const name of ta.filter((name) => tb.includes(name))) {
  const [x, y] = [await table(join(a, name)), await table(join(b, name))];
  const sameColumns = JSON.stringify(x.columns) === JSON.stringify(y.columns);
  const same = sameColumns && x.count === y.count && x.digest === y.digest;
  if (!same) differing += 1;
  console.log(`${same ? 'same     ' : 'DIFFERENT'} ${name}: rows ${x.count} / ${y.count}, columns ${x.columns.length} / ${y.columns.length}${sameColumns ? '' : ' (columns differ)'}`);
  if (!sameColumns) {
    console.log('   only a:', x.columns.filter((column) => !y.columns.includes(column)).join(' '));
    console.log('   only b:', y.columns.filter((column) => !x.columns.includes(column)).join(' '));
  } else if (!same) {
    console.log('   a:', x.first.slice(0, 300));
    console.log('   b:', y.first.slice(0, 300));
  }
}
console.log(differing ? `${differing} tables differ` : 'every table has the same columns and the same rows');
