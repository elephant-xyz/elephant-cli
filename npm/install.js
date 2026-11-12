// Runs after `npm install`: makes sure this package has the native binary.
// It takes the first of these that applies:
//
// 1. A package published to npm carries npm/release.json and downloads the
//    binary of its release for this platform.
// 2. A git install (`npm i github:elephant-xyz/elephant-cli#main`) downloads
//    the binary CI built for the commit it was installed from.
// 3. Otherwise the binary is built from the Rust sources in the package with
//    cargo: a checkout with local changes, a commit CI has not built, a
//    platform without a binary, or a downloaded binary that does not run here.
//
// For a git install npm runs this once in its clone and packs the result
// (npm/native/ is in "files"), so the copy in node_modules has the binary.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { bundled, root } from './native.js';

const say = (text) => console.error(`elephant-cli: ${text}`);

const triples = {
  'linux-x64': 'x86_64-unknown-linux-gnu',
  'linux-arm64': 'aarch64-unknown-linux-gnu',
  'darwin-x64': 'x86_64-apple-darwin',
  'darwin-arm64': 'aarch64-apple-darwin',
  'win32-x64': 'x86_64-pc-windows-msvc',
};
const triple = triples[`${process.platform}-${process.arch}`];
// Where CI publishes the binaries of each commit on main, as release `build-<commit>`.
const builds = process.env.ELEPHANT_CLI_BUILDS || 'https://github.com/elephant-xyz/elephant-cli/releases/download';

/** The commit this package was installed from, when a binary built for it would be this code. */
function commit() {
  // npm's clone of a git dependency, or a checkout: its HEAD, unless files differ from it
  if (existsSync(join(root, '.git'))) {
    const git = (...args) => spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
    const head = git('rev-parse', 'HEAD');
    const changed = git('status', '--porcelain', '--untracked-files=no');
    return head.status === 0 && changed.status === 0 && !changed.stdout.trim() ? head.stdout.trim() : undefined;
  }
  // in node_modules: npm's own record of where the package came from
  const record = join(root, '..', '..', '.package-lock.json');
  if (!existsSync(record)) return undefined;
  const packages = JSON.parse(readFileSync(record, 'utf8')).packages || {};
  const resolved = Object.entries(packages).find(([path]) => path.endsWith('node_modules/@elephant-xyz/cli'))?.[1]?.resolved;
  return /#([0-9a-f]{40})$/.exec(resolved || '')?.[1];
}

/** The sha256 a `SHA256SUMS` file at `base` gives for `file`. */
async function published(base, file) {
  const response = await fetch(`${base}/SHA256SUMS`);
  if (!response.ok) return undefined;
  const line = (await response.text()).split('\n').find((entry) => entry.trim().endsWith(file));
  return line?.trim().split(/\s+/)[0];
}

/** Download the binary for this platform from `base`; false when there is none to use. */
async function download(base, expected) {
  if (!triple || !expected) return false;
  const url = `${base}/elephant-cli-${triple}.tar.gz`;
  say(`downloading ${url}`);
  const response = await fetch(url);
  if (!response.ok) {
    say(`download failed: ${response.status} ${response.statusText}`);
    return false;
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  const found = createHash('sha256').update(bytes).digest('hex');
  if (found !== expected) throw new Error(`${url} has sha256 ${found}, expected ${expected}`);
  const archive = join(dirname(bundled), 'download.tar.gz');
  writeFileSync(archive, bytes);
  const unpacked = spawnSync('tar', ['-xzf', archive, '-C', dirname(bundled)], { stdio: 'inherit' });
  rmSync(archive, { force: true });
  if (unpacked.status !== 0 || !existsSync(bundled)) return false;
  chmodSync(bundled, 0o755);
  // built for another system (an older C library, say): better to build than to fail on first use
  if (spawnSync(bundled, ['--version']).status === 0) return true;
  say('the downloaded binary does not run on this system');
  rmSync(bundled, { force: true });
  return false;
}

/** A prebuilt binary: the release's, or the one CI built for this commit. */
async function fetched() {
  if (process.env.ELEPHANT_CLI_BUILD_FROM_SOURCE) return false;
  const release = join(root, 'npm', 'release.json');
  if (existsSync(release)) {
    const known = JSON.parse(readFileSync(release, 'utf8'));
    return download(known.base, known.sha256?.[triple]);
  }
  const from = commit();
  if (!from || !triple) return false;
  const base = `${builds}/build-${from}`;
  return download(base, await published(base, `elephant-cli-${triple}.tar.gz`).catch(() => undefined));
}

/** Build the binary from the sources in this package. */
function build() {
  const cargo = spawnSync('cargo', ['--version'], { encoding: 'utf8' });
  if (cargo.error || cargo.status !== 0) {
    throw new Error(
      'there is no prebuilt elephant-cli for this install, and cargo was not found to build it from source. Install Rust from https://rustup.rs and run the install again, install a release with `npm i @elephant-xyz/cli`, or set ELEPHANT_CLI_BINARY to an elephant-cli binary.'
    );
  }
  say(`building from source with ${cargo.stdout.trim()} (a few minutes the first time)`);
  const target = join(root, 'target');
  const built = spawnSync('cargo', ['build', '--release', '--locked', '--manifest-path', join(root, 'Cargo.toml'), '--target-dir', target], { stdio: 'inherit' });
  if (built.status !== 0) throw new Error('cargo build failed');
  copyFileSync(join(target, 'release', process.platform === 'win32' ? 'elephant-cli.exe' : 'elephant-cli'), bundled);
  chmodSync(bundled, 0o755);
  // inside node_modules the build directory is only weight
  if (root.split(/[\\/]/).includes('node_modules')) rmSync(target, { recursive: true, force: true });
}

if (process.env.ELEPHANT_CLI_BINARY) {
  say(`using ELEPHANT_CLI_BINARY=${process.env.ELEPHANT_CLI_BINARY}`);
} else if (existsSync(bundled) && !process.argv.includes('--force')) {
  say(`binary already in place at ${bundled}`);
} else {
  try {
    mkdirSync(dirname(bundled), { recursive: true });
    if (!(await fetched())) build();
    say(`installed ${bundled}`);
  } catch (error) {
    say(error.message);
    process.exit(1);
  }
}
