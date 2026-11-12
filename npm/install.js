// Runs after `npm install`: makes sure this package has the native binary.
//
// A published release carries npm/release.json and downloads the binary built
// for this platform. Anything else (a git install such as
// `npm i github:elephant-xyz/elephant-cli#main`, a checkout) builds it from
// the Rust sources in the package with cargo. For a git install npm runs this
// once in its clone, packs the result (npm/native/ is in "files"), and the
// run in node_modules then finds the binary in place.
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

/** Download the release binary for this platform; false when there is none to use. */
async function download(release) {
  const triple = triples[`${process.platform}-${process.arch}`];
  const expected = triple && release.sha256?.[triple];
  if (!expected) return false;
  const url = `${release.base}/elephant-cli-${triple}.tar.gz`;
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
  return unpacked.status === 0 && existsSync(bundled);
}

/** Build the binary from the sources in this package. */
function build() {
  const cargo = spawnSync('cargo', ['--version'], { encoding: 'utf8' });
  if (cargo.error || cargo.status !== 0) {
    throw new Error(
      'cargo was not found, and it is needed to build elephant-cli from source. Install Rust from https://rustup.rs, or set ELEPHANT_CLI_BINARY to an elephant-cli binary.'
    );
  }
  say(`building from source with ${cargo.stdout.trim()} (a few minutes the first time)`);
  const target = join(root, 'target');
  const built = spawnSync('cargo', ['build', '--release', '--locked', '--manifest-path', join(root, 'Cargo.toml'), '--target-dir', target], { stdio: 'inherit' });
  if (built.status !== 0) throw new Error('cargo build failed');
  copyFileSync(join(target, 'release', process.platform === 'win32' ? 'elephant-cli.exe' : 'elephant-cli'), bundled);
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
    const release = join(root, 'npm', 'release.json');
    const fetched = existsSync(release) && (await download(JSON.parse(readFileSync(release, 'utf8'))));
    if (!fetched) build();
    chmodSync(bundled, 0o755);
    say(`installed ${bundled}`);
  } catch (error) {
    say(error.message);
    process.exit(1);
  }
}
