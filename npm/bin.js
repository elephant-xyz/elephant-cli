#!/usr/bin/env node
// `elephant-cli` for npm installs: hands everything to the native binary.
import { spawnSync } from 'node:child_process';
import { binary } from './native.js';

const ran = spawnSync(binary(), process.argv.slice(2), { stdio: 'inherit' });
if (ran.error) {
  console.error(`error: cannot run elephant-cli: ${ran.error.message}`);
  process.exit(2);
}
process.exit(ran.status ?? 2);
