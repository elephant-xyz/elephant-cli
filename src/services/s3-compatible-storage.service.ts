import { promises as fsPromises } from 'fs';
import path from 'path';
import {
  S3Client,
  PutObjectCommand,
  type ServiceInputTypes,
  type ServiceOutputTypes,
} from '@aws-sdk/client-s3';
import type {
  DeserializeHandler,
  DeserializeHandlerArguments,
  DeserializeHandlerOutput,
  DeserializeMiddleware,
  HandlerExecutionContext,
} from '@smithy/types';
import { logger } from '../utils/logger.js';
import type { StorageProvider } from './storage-provider.interface.js';
import type {
  PinataMetadata,
  DirectoryUploadResult,
} from './pinata-directory-upload.service.js';

export const FILEBASE_ENDPOINT = 'https://s3.filebase.com';

export interface S3StorageConfig {
  endpoint?: string;
  region?: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

/**
 * A raw HTTP response shape as exposed by the AWS SDK v3 deserialize middleware.
 * The SDK types `DeserializeHandlerOutput.response` as `unknown`; at runtime it is
 * an object matching this shape when the Node.js HTTP handler is used.
 */
interface RawHttpResponse {
  headers: Record<string, string>;
  statusCode: number;
}

function isRawHttpResponse(value: unknown): value is RawHttpResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    'headers' in value &&
    typeof (value as RawHttpResponse).headers === 'object'
  );
}

/**
 * S3-compatible storage provider for IPFS-backed object stores such as Filebase.
 *
 * Filebase pins uploaded objects to IPFS and returns the root IPFS CID in the
 * `x-amz-meta-cid` response header on PutObject. Because the AWS SDK v3 does not
 * surface raw HTTP response headers in `PutObjectCommandOutput`, we capture them
 * via a deserialize-step middleware added to the S3Client.
 *
 * Directory CID semantics:
 * The canonical directory CID is always the locally-computed value produced by
 * `elephant-cli hash` (passed in via `metadata.keyvalues.localCid`). The Filebase
 * header CID is used to CONFIRM that the upload landed on IPFS; if it differs from
 * the local CID we log a warning. If the header is absent we fall back to the local
 * CID. If neither is present, the upload is reported as a failure — parity with the
 * Pinata service which throws "No CID returned".
 *
 * TODO(verify-with-filebase-creds): Per-file PutObject uploads yield per-file CIDs;
 * to preserve the exact directory DAG computed by `hash`, the correct approach is to
 * upload a CAR file (Content-Addressable aRchive) to Filebase's /car endpoint. This
 * ensures the directory CID is pinned exactly. Implement CAR upload once live
 * Filebase credentials are available to verify the flow end-to-end.
 */
export class S3CompatibleStorageProvider implements StorageProvider {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: S3StorageConfig) {
    if (!config.accessKeyId) {
      throw new Error('S3 accessKeyId is required.');
    }
    if (!config.secretAccessKey) {
      throw new Error('S3 secretAccessKey is required.');
    }
    if (!config.bucket) {
      throw new Error('S3 bucket name is required.');
    }

    this.bucket = config.bucket;
    this.client = new S3Client({
      endpoint: config.endpoint ?? FILEBASE_ENDPOINT,
      region: config.region ?? 'us-east-1',
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      forcePathStyle: true,
    });

    logger.technical(
      `S3CompatibleStorageProvider initialized (endpoint: ${config.endpoint ?? FILEBASE_ENDPOINT}, bucket: ${config.bucket})`
    );
  }

  async uploadDirectory(
    directoryPath: string,
    metadata?: PinataMetadata
  ): Promise<DirectoryUploadResult> {
    const dirStats = await fsPromises.stat(directoryPath).catch(() => null);
    if (!dirStats || !dirStats.isDirectory()) {
      return { success: false, error: `Directory not found: ${directoryPath}` };
    }

    const files = await this.getAllFiles(directoryPath);

    if (files.length === 0) {
      return {
        success: false,
        error: `No files found in directory: ${directoryPath}`,
      };
    }

    logger.technical(`Found ${files.length} files to upload via S3`);

    const dirName = metadata?.directoryName ?? path.basename(directoryPath);
    const objectMetadata = this.buildObjectMetadata(metadata);

    // The canonical CID is always the locally-computed one, passed via keyvalues.
    const localCid =
      typeof metadata?.keyvalues?.localCid === 'string'
        ? metadata.keyvalues.localCid
        : undefined;

    let headerCid: string | undefined;

    for (const filePath of files) {
      const relativePath = this.getRelativePath(directoryPath, filePath);
      const key = `${dirName}/${relativePath}`;
      const body = await fsPromises.readFile(filePath);

      logger.debug(`Uploading: ${key}`);

      const command = new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: 'application/octet-stream',
        Metadata: objectMetadata,
      });

      // Capture raw response headers via a one-shot deserialize middleware.
      // The AWS SDK v3 does not surface vendor-specific response headers
      // (such as Filebase's `x-amz-meta-cid`) in the typed command output;
      // they are accessible only on the raw HttpResponse at the deserialize step.
      let capturedHeaders: Record<string, string> | undefined;

      const captureMiddleware: DeserializeMiddleware<
        ServiceInputTypes,
        ServiceOutputTypes
      > =
        (
          next: DeserializeHandler<ServiceInputTypes, ServiceOutputTypes>,
          _context: HandlerExecutionContext
        ) =>
        async (
          args: DeserializeHandlerArguments<ServiceInputTypes>
        ): Promise<DeserializeHandlerOutput<ServiceOutputTypes>> => {
          const result = await next(args);
          if (isRawHttpResponse(result.response)) {
            capturedHeaders = result.response.headers;
          }
          return result;
        };

      this.client.middlewareStack.add(captureMiddleware, {
        step: 'deserialize',
        name: 'captureFilebaseCidHeader',
        priority: 'low',
      });

      await this.client.send(command);

      this.client.middlewareStack.remove('captureFilebaseCidHeader');

      const cidFromHeader = capturedHeaders?.['x-amz-meta-cid'];
      if (cidFromHeader && !headerCid) {
        headerCid = cidFromHeader;
        logger.technical(`CID confirmed by provider header: ${headerCid}`);
        if (localCid && headerCid !== localCid) {
          logger.warn(
            `Provider header CID (${headerCid}) differs from local CID (${localCid}). Using local CID as canonical.`
          );
        }
      }
    }

    // Prefer the locally-computed CID as the canonical value.
    // Fall back to the provider header CID only if no local CID was supplied.
    // If neither is available, this is an error — parity with PinataDirectoryUploadService
    // which returns { success: false, error: 'No CID returned from Pinata API' }.
    const cid = localCid ?? headerCid;

    if (!cid) {
      return {
        success: false,
        error:
          'No CID available: provider did not return a CID header and no local CID was supplied.',
      };
    }

    logger.success(
      `Successfully uploaded directory to S3-compatible store. CID: ${cid}`
    );

    return { success: true, cid };
  }

  private buildObjectMetadata(
    metadata?: PinataMetadata
  ): Record<string, string> {
    const result: Record<string, string> = {};

    if (!metadata?.keyvalues) {
      return result;
    }

    for (const [key, value] of Object.entries(metadata.keyvalues)) {
      if (value !== null && value !== undefined) {
        result[key] =
          value instanceof Date ? value.toISOString() : String(value);
      }
    }

    return result;
  }

  private async getAllFiles(dir: string): Promise<string[]> {
    const files: string[] = [];

    const walk = async (currentPath: string) => {
      const entries = await fsPromises.readdir(currentPath, {
        withFileTypes: true,
      });

      for (const entry of entries) {
        const fullPath = path.join(currentPath, entry.name);

        if (entry.isDirectory()) {
          await walk(fullPath);
        } else if (entry.isFile()) {
          files.push(fullPath);
        }
      }
    };

    await walk(dir);
    return files;
  }

  private getRelativePath(base: string, file: string): string {
    const relativePath = path.relative(base, file);
    return relativePath.split(path.sep).join(path.posix.sep);
  }
}
