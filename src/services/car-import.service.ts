import { createReadStream, openAsBlob, promises as fsPromises } from 'fs';
import path from 'path';
import { setTimeout as sleep } from 'timers/promises';
import { CarCIDIterator, CarReader } from '@ipld/car';
import { CID } from 'multiformats/cid';
import { sha256 } from 'multiformats/hashes/sha2';
import { equals as u8eq } from 'uint8arrays/equals';
import { logger } from '../utils/logger.js';
import { DEFAULT_IPFS_GATEWAYS } from '../config/constants.js';
import { decodeDagJson, sameDigest } from './cid-calculator.service.js';

export interface CarImportOptions {
  input: string;
  /** Kubo RPC API base URL. */
  api?: string;
  /** Bearer token for the API; omitted when unset. */
  token?: string;
  /** Gateway used to read the root back. */
  gateway?: string;
  /** Seconds to wait for the root readback; a CLI string or a number. */
  timeout?: number | string;
}

export interface CarImportResult {
  api: string;
  root: string;
  blocks: number;
  gatewayUrl: string;
  uploadedAt: string;
}

export interface TablesImportResult {
  api: string;
  /** CID of the `CountyTables` block, the root of `tables.car`. */
  root: string;
  countyRoot: string;
  /** Part files added and pinned. */
  parts: number;
  gatewayUrl: string;
  uploadedAt: string;
}

/** One NDJSON line of `add`. */
interface AddLine {
  Hash?: string;
}

/** A part as `export-tables` records it in the `CountyTables` block. */
interface PartLink {
  cid: CID;
  rows: number;
  bytes: number;
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

/** Validated API origin, gateway origin and readback timeout in seconds. */
function target(options: CarImportOptions): {
  api: string;
  gateway: string;
  timeout: number;
} {
  const timeout = Number(options.timeout ?? 300);
  if (!Number.isFinite(timeout) || timeout <= 0) {
    throw new Error(
      `--timeout must be a number of seconds greater than zero, got ${options.timeout}`
    );
  }
  const api = (options.api ?? 'http://127.0.0.1:5001').replace(/\/+$/, '');
  if (!URL.canParse(api)) {
    throw new Error(`--api must be a URL with a scheme, got ${options.api}`);
  }
  const gateway = (
    options.gateway ??
    (new URL(api).host === 'rpc.filebase.io'
      ? DEFAULT_IPFS_GATEWAYS[0]
      : 'http://127.0.0.1:8080')
  ).replace(/\/+$/, '');
  return { api, gateway, timeout };
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
  const { api, gateway, timeout } = target(options);

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
  // Only JSON lines are parsed, so a 200 with an HTML body (wrong --api) is
  // reported below with the body instead of a bare SyntaxError.
  const lines: ImportLine[] = text
    .split('\n')
    .filter((line) => line.trimStart().startsWith('{'))
    .map((line) => JSON.parse(line));
  const imported = lines.filter((line) => line.Root);
  if (imported.length !== 1) {
    throw new Error(
      `dag/import returned ${imported.length} roots, expected one; response: ${text}`
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
  // --timeout is the wait for the root to resolve; a slow upload must not consume it.
  const deadline = Date.now() + timeout * 1000;

  const gatewayUrl = `${gateway}/ipfs/${root}`;
  logger.info(`Waiting for ${gatewayUrl} to resolve`);
  const bytes = await poll(deadline, `${gatewayUrl} to resolve`, async () => {
    const response = await fetch(`${gatewayUrl}?format=raw`, {
      signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())),
    });
    if (!response.ok) {
      await response.body?.cancel();
      return undefined;
    }
    return new Uint8Array(await response.arrayBuffer());
  });
  const digest = await sha256.digest(bytes);
  if (!u8eq(digest.bytes, root.multihash.bytes)) {
    throw new Error(
      `Gateway bytes for ${root} hash to ${CID.create(1, root.code, digest)}, not the root`
    );
  }

  return { api, root: root.toString(), blocks, gatewayUrl, uploadedAt };
}

/** Byte length a gateway reports for `url`: the `Content-Range` total of a one-byte range, or the full body when ranges are not honoured. */
async function served(
  url: string,
  signal: AbortSignal
): Promise<number | undefined> {
  const response = await fetch(url, {
    headers: { Range: 'bytes=0-0' },
    signal,
  });
  if (!response.ok) {
    await response.body?.cancel();
    return undefined;
  }
  const total = response.headers.get('content-range')?.match(/\/(\d+)$/);
  await response.body?.cancel();
  if (total) {
    return Number(total[1]);
  }
  // No usable total (no header, or `/*`): the probe body is one byte at most, so fetch the whole file.
  // ponytail: a gateway that ignores Range gets the whole part read into memory; stream-count if one is measured too big
  const whole = await fetch(url, { signal });
  if (!whole.ok) {
    await whole.body?.cancel();
    return undefined;
  }
  return (await whole.arrayBuffer()).byteLength;
}

/**
 * Uploads a tables directory written by `export-tables`: every part is added
 * through `add` (pinned, CIDv1, raw leaves, the importer's 256 KiB chunker) and must come back with
 * the CID the `CountyTables` block records, then `tables.car` is imported and
 * read back exactly like a county CAR, and finally the first part is fetched
 * from the gateway and its size compared with the recorded bytes.
 */
export async function importTables(
  options: CarImportOptions
): Promise<TablesImportResult> {
  const { api, gateway, timeout } = target(options);
  const car = path.join(options.input, 'tables.car');
  const reader = await CarReader.fromBytes(await fsPromises.readFile(car));
  const roots = await reader.getRoots();
  const head = roots.length === 1 ? await reader.get(roots[0]) : undefined;
  const index = head ? decodeDagJson(head.bytes) : undefined;
  const tables = (
    index as Partial<{ label: unknown; county_root: unknown; tables: unknown }>
  )?.tables;
  const countyRoot = CID.asCID(
    (index as Partial<{ county_root: unknown }>)?.county_root
  );
  if (
    (index as Partial<{ label: unknown }>)?.label !== 'CountyTables' ||
    !countyRoot ||
    !tables ||
    typeof tables !== 'object'
  ) {
    throw new Error(`${car} does not hold a CountyTables root`);
  }
  const listed = Object.entries(
    tables as Record<string, { parts?: unknown }>
  ).flatMap(([table, entry]) =>
    (Array.isArray(entry.parts) ? entry.parts : []).map(
      (part: Partial<PartLink>, position) => ({
        table,
        position,
        cid: CID.asCID(part.cid),
        bytes: Number(part.bytes),
        file: path.join(
          options.input,
          table,
          `part-${String(position).padStart(5, '0')}.parquet`
        ),
      })
    )
  );
  // The whole index is checked against the directory before the first add.
  for (const part of listed) {
    if (!part.cid) {
      throw new Error(
        `${car} records no CID for ${part.table} part ${part.position}`
      );
    }
    const size = await fsPromises.stat(part.file).then(
      (stats) => stats.size,
      () => undefined
    );
    if (size !== part.bytes) {
      throw new Error(
        size === undefined
          ? `${part.file} is missing but ${car} records it`
          : `${part.file} is ${size} bytes but ${car} records ${part.bytes}`
      );
    }
  }
  const headers: Record<string, string> = options.token
    ? { Authorization: `Bearer ${options.token}` }
    : {};
  for (const part of listed) {
    logger.info(`Adding ${part.file} through ${api}`);
    const form = new FormData();
    form.append('file', await openAsBlob(part.file), path.basename(part.file));
    const response = await fetch(
      `${api}/api/v0/add?pin=true&cid-version=1&raw-leaves=true&chunker=size-262144`,
      { method: 'POST', headers, body: form }
    );
    const text = await response.text();
    if (!response.ok) {
      throw new Error(
        `add failed for ${part.file}: ${response.status} ${response.statusText}: ${text}`
      );
    }
    const added: AddLine | undefined = text
      .split('\n')
      .filter((line) => line.trimStart().startsWith('{'))
      .map((line): AddLine => JSON.parse(line))
      .find((line) => line.Hash);
    if (!added?.Hash || !sameDigest(added.Hash, String(part.cid))) {
      throw new Error(
        `add returned ${added?.Hash ?? 'no CID'} for ${part.file} but the index records ${part.cid}`
      );
    }
  }

  const imported = await importCar({ ...options, input: car });
  const first = listed[0];
  if (first?.cid) {
    // --timeout bounds this readback on its own, as it does the root readback inside importCar.
    const deadline = Date.now() + timeout * 1000;
    const what = `${first.table} part ${first.position} to resolve on ${gateway}`;
    logger.info(`Waiting for ${what}`);
    const size = await poll(deadline, what, async () => {
      const signal = AbortSignal.timeout(Math.max(1, deadline - Date.now()));
      return (
        (await served(
          `${imported.gatewayUrl}/tables/${first.table}/parts/${first.position}/cid`,
          signal
        )) ?? (await served(`${gateway}/ipfs/${first.cid}`, signal))
      );
    });
    if (size !== first.bytes) {
      throw new Error(
        `Gateway serves ${size} bytes for ${first.cid} but the index records ${first.bytes}`
      );
    }
  }
  return {
    api,
    root: imported.root,
    countyRoot: countyRoot.toString(),
    parts: listed.length,
    gatewayUrl: imported.gatewayUrl,
    uploadedAt: imported.uploadedAt,
  };
}
