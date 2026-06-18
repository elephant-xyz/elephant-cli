import {
  PinataMetadata,
  DirectoryUploadResult,
} from './pinata-directory-upload.service.js';

export type { PinataMetadata as StorageMetadata, DirectoryUploadResult };

export interface StorageProvider {
  uploadDirectory(
    directoryPath: string,
    metadata?: PinataMetadata
  ): Promise<DirectoryUploadResult>;
}
