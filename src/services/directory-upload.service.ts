import { CID } from 'multiformats/cid';
import { sha256 } from 'multiformats/hashes/sha2';
import * as dagPB from '@ipld/dag-pb';
import { UnixFS } from 'ipfs-unixfs';
import { logger } from '../utils/logger.js';
import { promises as fsPromises } from 'fs';
import path from 'path';

export interface DirectoryEntry {
  path: string;
  content: Buffer;
}

export class DirectoryUploadService {
  constructor() {}

  /**
   * Create a UnixFS directory node
   */
  private createDirectoryNode(): { Data: Uint8Array; Links: dagPB.PBLink[] } {
    const unixfs = new UnixFS({ type: 'directory' });
    return {
      Data: unixfs.marshal(),
      Links: [],
    };
  }

  /**
   * Create a UnixFS file node
   */
  private async createFileNode(content: Buffer): Promise<{
    cid: CID;
    size: number;
    node: { Data: Uint8Array; Links: dagPB.PBLink[] };
  }> {
    const unixfs = new UnixFS({ type: 'file', data: new Uint8Array(content) });
    const node = { Data: unixfs.marshal(), Links: [] };
    const encoded = dagPB.encode(node);
    const hash = await sha256.digest(encoded);
    const cid = CID.create(1, 0x70, hash); // dag-pb codec
    
    return {
      cid,
      size: encoded.length,
      node,
    };
  }

  /**
   * Build a directory structure from files
   */
  async buildDirectoryStructure(entries: DirectoryEntry[]): Promise<{
    rootCid: CID;
    files: Map<string, CID>;
  }> {
    const files = new Map<string, CID>();
    const directories = new Map<string, dagPB.PBNode>();
    
    // First, create all file nodes
    for (const entry of entries) {
      const fileInfo = await this.createFileNode(entry.content);
      files.set(entry.path, fileInfo.cid);
      
      // Add file to its parent directory
      const dirPath = path.dirname(entry.path);
      const fileName = path.basename(entry.path);
      
      if (!directories.has(dirPath)) {
        directories.set(dirPath, this.createDirectoryNode());
      }
      
      const dir = directories.get(dirPath)!;
      dir.Links.push({
        Name: fileName,
        Tsize: fileInfo.size,
        Hash: fileInfo.cid,
      });
    }
    
    // Sort links in each directory (IPFS canonical order)
    for (const [, dir] of directories) {
      dir.Links.sort((a, b) => (a.Name || '').localeCompare(b.Name || ''));
    }
    
    // Calculate CID for root directory
    const rootDir = directories.get('.') || this.createDirectoryNode();
    const encoded = dagPB.encode(rootDir);
    const hash = await sha256.digest(encoded);
    const rootCid = CID.create(1, 0x70, hash);
    
    return {
      rootCid,
      files,
    };
  }

  /**
   * Read all files from a directory and prepare them for upload
   */
  async prepareDirectoryForUpload(dirPath: string): Promise<DirectoryEntry[]> {
    const entries: DirectoryEntry[] = [];
    
    async function scanDir(currentPath: string, relativePath: string) {
      const items = await fsPromises.readdir(currentPath, { withFileTypes: true });
      
      for (const item of items) {
        const itemPath = path.join(currentPath, item.name);
        const relativeItemPath = path.join(relativePath, item.name);
        
        if (item.isFile()) {
          const content = await fsPromises.readFile(itemPath);
          entries.push({
            path: relativeItemPath,
            content,
          });
        } else if (item.isDirectory()) {
          await scanDir(itemPath, relativeItemPath);
        }
      }
    }
    
    await scanDir(dirPath, '');
    return entries;
  }

  /**
   * Create a CAR (Content Addressable aRchive) file from directory entries
   * This creates a simple CAR v1 format that can be uploaded to IPFS
   */
  async createCAR(entries: DirectoryEntry[]): Promise<{
    carData: Buffer;
    rootCid: CID;
  }> {
    // For now, we'll create individual file uploads and link them
    // Full CAR implementation would require additional dependencies
    logger.warn('CAR creation not fully implemented - using alternative approach');
    
    const { rootCid } = await this.buildDirectoryStructure(entries);
    
    return {
      carData: Buffer.from(''), // Placeholder
      rootCid,
    };
  }
}