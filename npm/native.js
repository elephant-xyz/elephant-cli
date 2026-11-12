// Where the native elephant-cli binary of this package is.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const bundled = join(root, 'npm', 'native', process.platform === 'win32' ? 'elephant-cli.exe' : 'elephant-cli');

/** The binary to run: `ELEPHANT_CLI_BINARY` if set, else the one in this package, fetched or built on first use if `npm install` did not run scripts. */
export function binary() {
  const named = process.env.ELEPHANT_CLI_BINARY;
  if (named) return named;
  if (existsSync(bundled)) return bundled;
  // npm can be told not to run install scripts; do then what postinstall would have done
  spawnSync(process.execPath, [join(root, 'npm', 'install.js')], { stdio: ['ignore', 2, 2] });
  if (existsSync(bundled)) return bundled;
  throw new Error(
    `The elephant-cli binary is missing from ${bundled}. Install Rust (https://rustup.rs) and run \`node ${join(root, 'npm', 'install.js')}\`, or set ELEPHANT_CLI_BINARY to a binary you built or downloaded.`
  );
}
