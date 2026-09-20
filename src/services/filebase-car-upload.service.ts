import { createReadStream, promises as fsPromises } from 'fs';
import { setTimeout as sleep } from 'timers/promises';
import {
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { CarCIDIterator } from '@ipld/car';
import { CID } from 'multiformats/cid';
import { sha256 } from 'multiformats/hashes/sha2';
import { logger } from '../utils/logger.js';
import { sameDigest } from './cid-calculator.service.js';

export interface FilebaseCarUploadOptions {
  input: string;
  bucket: string;
  key: string;
  accessKey: string;
  secretKey: string;
  endpoint?: string;
  gateway?: string;
  /** Seconds to wait for the object CID and the root readback. */
  timeout?: number;
}

export interface FilebaseCarUploadResult {
  bucket: string;
  key: string;
  objectCid: string;
  root: string;
  gatewayUrl: string;
  uploadedAt: string;
}

/**
 * Retry `step` every two seconds until it resolves a value or `deadline`
 * (ms epoch) passes. A rejection (gateway ECONNRESET, HEAD `NotFound` while
 * Filebase is still finalizing the import) is a retry, not a failure; the
 * last one is named in the timeout error.
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
 * Imports one CAR into Filebase with a single S3 PUT (`import=car`), checks that
 * the object CID Filebase reports equals the CAR header root, then fetches the
 * root block from the public gateway and verifies its sha256 against the CID.
 */
export async function uploadCarToFilebase(
  options: FilebaseCarUploadOptions
): Promise<FilebaseCarUploadResult> {
  const timeout = options.timeout ?? 300;
  if (!Number.isFinite(timeout) || timeout <= 0) {
    throw new Error(
      `--timeout must be a number of seconds greater than zero, got ${options.timeout}`
    );
  }
  const endpoint = (options.endpoint ?? 'https://s3.filebase.io').replace(
    /\/+$/,
    ''
  );
  const gateway = (options.gateway ?? 'https://ipfs.filebase.io').replace(
    /\/+$/,
    ''
  );
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
  const size = (await fsPromises.stat(options.input)).size;

  const client = new S3Client({
    endpoint,
    region: 'us-east-1',
    forcePathStyle: true,
    credentials: {
      accessKeyId: options.accessKey,
      secretAccessKey: options.secretKey,
    },
    // Filebase does not accept the aws-chunked trailing checksums the SDK sends by default.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });

  logger.info(`Uploading to s3://${options.bucket}/${options.key}`);
  // ponytail: single PUT; add multipart when a county CAR exceeds 5 GB
  await client.send(
    new PutObjectCommand({
      Bucket: options.bucket,
      Key: options.key,
      Body: createReadStream(options.input),
      ContentLength: size,
      ContentType: 'application/vnd.ipld.car',
      Metadata: { import: 'car' },
    })
  );
  const uploadedAt = new Date().toISOString();

  const objectCid = await poll(deadline, 'object cid', async () => {
    const head = await client.send(
      new HeadObjectCommand({ Bucket: options.bucket, Key: options.key })
    );
    return head.Metadata?.cid;
  });
  if (!sameDigest(objectCid, root.toString())) {
    throw new Error(
      `Filebase reported object CID ${objectCid} but the CAR root is ${root}`
    );
  }

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

  return {
    bucket: options.bucket,
    key: options.key,
    objectCid,
    root: root.toString(),
    gatewayUrl,
    uploadedAt,
  };
}
