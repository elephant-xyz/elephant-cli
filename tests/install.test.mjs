// How the npm package gets its native binary: `npm/install.js`, run against a
// local stand-in for the GitHub releases that hold the binaries CI builds.
// Run with `node --test tests/install.test.mjs`. Nothing here needs cargo or
// the network.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const triples = ['x86_64-unknown-linux-gnu', 'aarch64-unknown-linux-gnu', 'x86_64-apple-darwin', 'aarch64-apple-darwin'];
let work;
let server;
let builds;
// what the stand-in serves: path -> body
const served = new Map();
const asked = [];

before(async () => {
  work = mkdtempSync(join(tmpdir(), 'elephant-install-'));
  server = http.createServer((request, response) => {
    asked.push(request.url);
    const body = served.get(request.url);
    response.writeHead(body ? 200 : 404).end(body);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  builds = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  server.close();
  rmSync(work, { recursive: true, force: true });
});

/** A tarball holding a stand-in `elephant-cli` that answers `--version` with `says`. */
function tarball(name, says) {
  const dir = join(work, `binary-${name}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'elephant-cli'), `#!/bin/sh\n${says}\n`);
  chmodSync(join(dir, 'elephant-cli'), 0o755);
  const made = spawnSync('tar', ['-czf', join(dir, 'binary.tar.gz'), '-C', dir, 'elephant-cli']);
  assert.equal(made.status, 0);
  return readFileSync(join(dir, 'binary.tar.gz'));
}

/** Publish `bytes` as the build of `commit`, with `sums` (default: the true ones) as its SHA256SUMS. */
function publish(commit, bytes, sum = createHash('sha256').update(bytes).digest('hex')) {
  for (const triple of triples) served.set(`/build-${commit}/elephant-cli-${triple}.tar.gz`, bytes);
  served.set(`/build-${commit}/SHA256SUMS`, triples.map((triple) => `${sum}  elephant-cli-${triple}.tar.gz`).join('\n') + '\n');
}

/** The package's npm files in a directory of their own. */
function unpack(to) {
  mkdirSync(join(to, 'npm'), { recursive: true });
  for (const name of ['install.js', 'native.js']) cpSync(join(repo, 'npm', name), join(to, 'npm', name));
  cpSync(join(repo, 'package.json'), join(to, 'package.json'));
  return to;
}

/** Run the installer in `root` with no cargo on PATH. Not spawnSync: the stand-in server lives in this process. */
function install(root) {
  const path = [dirname(process.execPath), '/usr/bin', '/bin'].join(':');
  const child = spawn(process.execPath, [join(root, 'npm', 'install.js')], { env: { PATH: path, HOME: work, ELEPHANT_CLI_BUILDS: builds } });
  let stderr = '';
  child.stderr.on('data', (chunk) => (stderr += chunk));
  return new Promise((resolve) => child.on('close', (status) => resolve({ status, stderr })));
}

/** A git checkout of the package, as npm clones a git dependency; returns its root and commit. */
function clone(name) {
  const root = unpack(join(work, name));
  const git = (...args) => spawnSync('git', ['-C', root, '-c', 'user.name=test', '-c', 'user.email=test@example.invalid', ...args], { encoding: 'utf8' });
  assert.equal(git('init', '-q').status, 0);
  writeFileSync(join(root, '.gitignore'), 'npm/native/\n');
  git('add', '-A');
  assert.equal(git('commit', '-q', '-m', name).status, 0);
  return { root, commit: git('rev-parse', 'HEAD').stdout.trim() };
}

const version = (root) => spawnSync(join(root, 'npm', 'native', 'elephant-cli'), ['--version'], { encoding: 'utf8' }).stdout.trim();

test('a git install gets the binary CI built for its commit, without cargo', async () => {
  const { root, commit } = clone('from-git');
  publish(commit, tarball('good', 'echo "elephant-cli 9.9.9"'));
  const ran = await install(root);
  assert.equal(ran.status, 0, ran.stderr);
  assert.equal(version(root), 'elephant-cli 9.9.9');
});

test('an install in node_modules finds its commit in npm\'s record of the package', async () => {
  const commit = 'c0ffee0000000000000000000000000000000001';
  const root = unpack(join(work, 'app', 'node_modules', '@elephant-xyz', 'cli'));
  const record = { packages: { 'node_modules/@elephant-xyz/cli': { version: '2.0.0', resolved: `git+ssh://git@github.com/elephant-xyz/elephant-cli.git#${commit}` } } };
  writeFileSync(join(work, 'app', 'node_modules', '.package-lock.json'), JSON.stringify(record));
  publish(commit, tarball('recorded', 'echo "elephant-cli 8.8.8"'));
  const ran = await install(root);
  assert.equal(ran.status, 0, ran.stderr);
  assert.equal(version(root), 'elephant-cli 8.8.8');
});

test('a binary whose checksum is not the published one is refused', async () => {
  const { root, commit } = clone('tampered');
  publish(commit, tarball('tampered', 'echo "elephant-cli 6.6.6"'), 'a'.repeat(64));
  const ran = await install(root);
  assert.equal(ran.status, 1);
  assert.match(ran.stderr, /has sha256 [0-9a-f]{64}, expected a{64}/);
  assert.equal(existsSync(join(root, 'npm', 'native', 'elephant-cli')), false);
});

test('without a binary for the commit, or with one that does not run here, it builds from source', async () => {
  const missing = clone('no-build');
  const built = await install(missing.root);
  assert.equal(built.status, 1);
  // no cargo on this PATH: the attempt to build is what the message shows
  assert.match(built.stderr, /cargo was not found/);
  assert.ok(asked.includes(`/build-${missing.commit}/SHA256SUMS`), 'it asked for the commit\'s build first');

  const broken = clone('wrong-system');
  publish(broken.commit, tarball('broken', 'exit 127'));
  const fallen = await install(broken.root);
  assert.equal(fallen.status, 1);
  assert.match(fallen.stderr, /does not run on this system/);
  assert.match(fallen.stderr, /cargo was not found/);
});

test('a checkout with local changes is built from its own sources', async () => {
  const { root, commit } = clone('edited');
  publish(commit, tarball('stale', 'echo "elephant-cli 7.7.7"'));
  writeFileSync(join(root, 'package.json'), readFileSync(join(root, 'package.json'), 'utf8') + '\n');
  const ran = await install(root);
  assert.equal(ran.status, 1);
  assert.match(ran.stderr, /cargo was not found/);
  assert.ok(!asked.includes(`/build-${commit}/SHA256SUMS`), 'the committed build is not what this tree holds');
});
