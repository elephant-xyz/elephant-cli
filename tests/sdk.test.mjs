// The npm side of the package: the `elephant-cli` launcher and the library
// functions of '@elephant-xyz/cli/lib', run against the native binary.
// Run with `node --test tests/sdk.test.mjs` after `node npm/install.js`
// (or with ELEPHANT_CLI_BINARY pointing at a built binary).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import * as cli from '../npm/lib.js';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const fixtures = join(repo, 'tests', 'fixtures');
let work;

before(() => {
  work = mkdtempSync(join(tmpdir(), 'elephant-sdk-'));
  process.env.ELEPHANT_SCHEMA_CACHE_DIR = join(fixtures, 'lexicon');
  process.env.ELEPHANT_OFFLINE = '1';
});
after(() => rmSync(work, { recursive: true, force: true }));

test('the launcher runs validate the way atlas calls it', () => {
  cpSync(join(fixtures, 'hash', 'single', 'expected', 'county.car'), join(work, 'county.car'));
  // atlas: spawnSync(cli, ['validate', file, '--output-csv', csv]); ok when status is 0
  const ran = spawnSync(process.execPath, [join(repo, 'npm', 'bin.js'), 'validate', join(work, 'county.car'), '--output-csv', join(work, 'atlas.csv')], { encoding: 'utf8' });
  assert.equal(ran.status, 1, 'the golden hash fixture is not lexicon-valid, so validate must fail it');
  assert.match(ran.stdout, /integrity errors:\s+0/);
  assert.match(ran.stdout, /lexicon errors:\s+[1-9]/);
  assert.match(readFileSync(join(work, 'atlas.csv'), 'utf8'), /^property_cid,data_group_cid,file_path,error_path,error_message,currentValue,timestamp\n/);
});

test('hash, validate and exportTables return the 1.x result shapes', async () => {
  const hashed = await cli.hash({ input: join(fixtures, 'validate', 'batch'), outputZip: 'hashed', outputCsv: 'hash.csv', outputCar: 'county.car', cwd: work });
  assert.equal(hashed.success, true, hashed.error);
  assert.equal(hashed.outputCarPath, join(work, 'county.car'));
  assert.match(hashed.carRoot, /^baguqeera/);

  const checked = await cli.validate({ input: 'county.car', outputCsv: 'car-errors.csv', cwd: work });
  assert.deepEqual(
    { success: checked.success, properties: checked.car.properties, groups: checked.car.groups, lexicon: checked.car.errors.lexicon },
    { success: false, properties: 2, groups: 4, lexicon: 1 }
  );
  assert.equal(checked.errors, 1);
  assert.equal(checked.errorCsvPath, join(work, 'car-errors.csv'));

  const property = await cli.validate({ input: join(fixtures, 'validate', 'clean'), cwd: work });
  assert.deepEqual({ success: property.success, errors: property.errors, car: property.car }, { success: true, errors: 0, car: undefined });

  const exported = await cli.exportTables({ input: join(fixtures, 'export-tables', 'county.car'), output: 'tables', cwd: work });
  assert.equal(exported.success, true, exported.error);
  assert.equal(exported.tables.properties.rows, 2);
  assert.equal(exported.parts, 8);
});

test('transform reports a failing script as scriptFailure', async () => {
  const zip = (name, dir) => spawnSync('python3', ['-I', '-m', 'zipfile', '-c', join(work, name), '.'], { cwd: dir });
  // python's zipfile keeps the "./" prefix out of entry names when given "."
  zip('prepared.zip', join(fixtures, 'transform', 'scripts-mode', 'input'));
  zip('failing.zip', join(fixtures, 'transform', 'failing-scripts', 'scripts'));
  const failed = await cli.transform({ inputZip: 'prepared.zip', scriptsZip: 'failing.zip', outputZip: 'out.zip', cwd: work });
  assert.equal(failed.success, false);
  assert.match(failed.error, /^Script failed \(script=data_extractor\.js code=1/);
  assert.match(failed.scriptFailure.stderr, /Unknown enum value Barn\./);
  assert.equal(failed.outputPath, join(work, 'out.zip'));
});

test('prepare resolves on success and throws the reason on failure', async () => {
  const server = http.createServer((request, response) => {
    if (request.url.startsWith('/gone')) return response.writeHead(404).end();
    response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ asked: request.url }));
  });
  await new Promise((listening) => server.listen(0, '127.0.0.1', listening));
  const base = `http://127.0.0.1:${server.address().port}`;
  const seed = (name, path) => {
    const dir = mkdtempSync(join(work, 'seed-'));
    writeFileSync(join(dir, 'parcel.json'), JSON.stringify({ source_http_request: { url: base + path, method: 'GET' }, request_identifier: 'p1' }));
    writeFileSync(join(dir, 'address.json'), '{}');
    spawnSync('python3', ['-I', '-m', 'zipfile', '-c', join(work, name), 'parcel.json', 'address.json'], { cwd: dir });
  };
  seed('seed.zip', '/api');
  seed('gone.zip', '/gone');
  try {
    assert.equal(await cli.prepare(join(work, 'seed.zip'), join(work, 'prepared-out.zip')), undefined);
    await assert.rejects(cli.prepare(join(work, 'gone.zip'), join(work, 'never.zip')), /HTTP error 404: Not Found/);
  } finally {
    server.close();
  }
});

test('functions removed in 2.0 say so', async () => {
  await assert.rejects(cli.submitToContract({}), /removed in elephant-cli 2/);
  const pinata = await cli.upload({ input: 'x.zip', pinataJwt: 'token' });
  assert.deepEqual({ success: pinata.success, removed: /removed/.test(pinata.error) }, { success: false, removed: true });
});
