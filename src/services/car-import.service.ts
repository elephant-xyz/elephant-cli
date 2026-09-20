import { createReadStream, openAsBlob } from 'fs';
import path from 'path';
import { setTimeout as sleep } from 'timers/promises';
import { CarCIDIterator } from '@ipld/car';
import { CID } from 'multiformats/cid';
import { sha256 } from 'multiformats/hashes/sha2';
import { logger } from '../utils/logger.js';
import { sameDigest } from './cid-calculator.service.js';

export interface CarImportOptions {
  input: string;
  /** Kubo RPC API base URL. */
  api?: string;
  /** Bearer token for the API; omitted when unset. */
  token?: string;
  /** Gateway used to read the root back. */
  gateway?: string;
  /** Seconds to wait for the root readback. */
  timeout?: number;
}

export interface CarImportResult {
  api: string;
  root: string;
  blocks: number;
  gatewayUrl: string;
  uploadedAt: string;
}

/** One NDJSON line of `dag/import?stats=true`. */
interface ImportLine {
  Root?: { Cid: { '/': string }; PinErrorMsg?: string };
  Stats?: { BlockCount: number };
}

/**
 * Retry `step` every two seconds until it resolves a value or `deadline`
 * (ms epoch) passes. A rejection (gateway ECONNRESET, a 5xx while the node
 * is still finalizing the import) is a retry, not a failure; the last one
 * is named in the timeout error.
 */
async function poll<T>(
  deadline: number,
  what: string,
  step: () => Promise<T | undefined>,
  last?: unknown
): Promise<T> {
  const attempt = await step().then(
    (value) => ({ value }),
    (error: unknown) => ({ error })
  );
  if ('value' in attempt && attempt.value !== undefined) {
    return attempt.value;
  }
  const reason = 'error' in attempt ? attempt.error : last;
  if (Date.now() >= deadline) {
    throw new Error(
      `Timed out waiting for ${what}${reason === undefined ? '' : `: ${reason instanceof Error ? reason.message : String(reason)}`}`
    );
  }
  await sleep(2000);
  return poll(deadline, what, step, reason);
}

/** Read the header roots only; the stream is closed before any block. */
async function roots(input: string): Promise<CID[]> {
  const stream = createReadStream(input);
  const iterator = await CarCIDIterator.fromIterable(stream).finally(() =>
    stream.destroy()
  );
  return iterator.getRoots();
}

/**
 * Imports one CAR through the Kubo RPC API (`dag/import?pin-roots=true`),
 * which Filebase, a local kubo daemon and other pinning providers all speak.
 * Requires the imported root to equal the CAR header root, then fetches the
 * root block from the gateway and verifies its sha256 against the CID.
 */
export async function importCar(
  options: CarImportOptions
): Promise<CarImportResult> {
  const timeout = options.timeout ?? 300;
  if (!Number.isFinite(timeout) || timeout <= 0) {
    throw new Error(
      `--timeout must be a number of seconds greater than zero, got ${options.timeout}`
    );
  }
  const api = (options.api ?? 'http://127.0.0.1:5001').replace(/\/+$/, '');
  const gateway = (
    options.gateway ??
    (new URL(api).host === 'rpc.filebase.io'
      ? 'https://ipfs.filebase.io'
      : 'http://127.0.0.1:8080')
  ).replace(/\/+$/, '');
  const deadline = Date.now() + timeout * 1000;

  const header = await roots(options.input);
  if (header.length !== 1) {
    throw new Error(
      `Expected one root in ${options.input}, found ${header.length}`
    );
  }
  const root = header[0];
  if (root.multihash.code !== sha256.code) {
    throw new Error(
      `Unsupported root hash: ${root} uses multihash code ${root.multihash.code}, only sha2-256 roots can be verified`
    );
  }

  logger.info(`Importing ${options.input} through ${api}`);
  const form = new FormData();
  form.append(
    'file',
    await openAsBlob(options.input),
    path.basename(options.input)
  );
  // ponytail: one request; chunk the CAR when a provider caps the request body
  const response = await fetch(
    `${api}/api/v0/dag/import?pin-roots=true&stats=true`,
    {
      method: 'POST',
      headers: options.token
        ? { Authorization: `Bearer ${options.token}` }
        : {},
      body: form,
    }
  );
  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `dag/import failed: ${response.status} ${response.statusText}: ${text}`
    );
  }
  const lines: ImportLine[] = text
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line));
  const imported = lines.filter((line) => line.Root);
  if (imported.length !== 1) {
    throw new Error(
      `dag/import returned ${imported.length} roots, expected one: ${text}`
    );
  }
  const pinned = imported[0].Root!;
  if (pinned.PinErrorMsg) {
    throw new Error(`Pinning ${pinned.Cid['/']} failed: ${pinned.PinErrorMsg}`);
  }
  if (!sameDigest(pinned.Cid['/'], root.toString())) {
    throw new Error(
      `dag/import reported root ${pinned.Cid['/']} but the CAR root is ${root}`
    );
  }
  const blocks = lines.find((line) => line.Stats)?.Stats?.BlockCount ?? 0;
  const uploadedAt = new Date().toISOString();

  const gatewayUrl = `${gateway}/ipfs/${root}`;
  logger.info(`Waiting for ${gatewayUrl} to resolve`);
  const bytes = await poll(deadline, `${gatewayUrl} to resolve`, async () => {
    const response = await fetch(`${gatewayUrl}?format=raw`, {
      signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())),
    });
    if (!response.ok) {
      return undefined;
    }
    return new Uint8Array(await response.arrayBuffer());
  });
  const digest = await sha256.digest(bytes);
  if (!CID.create(1, root.code, digest).equals(root)) {
    throw new Error(
      `Gateway bytes for ${root} hash to ${CID.create(1, root.code, digest)}, not the root`
    );
  }

  return { api, root: root.toString(), blocks, gatewayUrl, uploadedAt };
}
