// Where the native elephant-cli binary of this package is.
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const bundled = join(root, 'npm', 'native', process.platform === 'win32' ? 'elephant-cli.exe' : 'elephant-cli');

/** The binary to run: `ELEPHANT_CLI_BINARY` if set, else the one `npm install` put in this package. */
export function binary() {
  const named = process.env.ELEPHANT_CLI_BINARY;
  if (named) return named;
  if (existsSync(bundled)) return bundled;
  throw new Error(
    `The elephant-cli binary is missing from ${bundled}. Run \`node ${join(root, 'npm', 'install.js')}\` (it needs cargo, from https://rustup.rs), or set ELEPHANT_CLI_BINARY to a binary you built or downloaded.`
  );
}
