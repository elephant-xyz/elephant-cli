import { promises as fsPromises } from 'fs';
import path from 'path';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
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
 * S3-compatible storage provider for IPFS-backed object stores such as Filebase.
 * Filebase pins uploaded objects to IPFS and returns the resulting CID in the
 * `x-amz-meta-cid` response header on PutObject.
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

    let confirmedCid: string | undefined;

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

      const output = await this.client.send(command);

      const headerCid = (output as Record<string, unknown>)[
        'x-amz-meta-cid'
      ] as string | undefined;

      if (headerCid && !confirmedCid) {
        confirmedCid = headerCid;
        logger.technical(`CID confirmed from provider header: ${confirmedCid}`);
      }
    }

    if (!confirmedCid) {
      logger.warn(
        'Provider did not return a CID header; CID must be obtained from the locally computed hash.'
      );
      return {
        success: true,
        cid: undefined,
      };
    }

    logger.success(
      `Successfully uploaded directory to S3-compatible store. CID: ${confirmedCid}`
    );

    return { success: true, cid: confirmedCid };
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
