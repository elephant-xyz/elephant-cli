import * as fs from 'fs';
import * as path from 'path';
import { DownloadResult, ElephantAssignment } from '../types';

export class IPFSService {
  private gateway: string;
  private maxConcurrent: number;
  private activeDownloads: number = 0;
  private downloadQueue: (() => Promise<void>)[] = [];
  private completedCount: number = 0;
  private totalCount: number = 0;
  private onProgress?: (completed: number, total: number) => void;

  constructor(gatewayUrl: string, maxConcurrent: number = 3) {
    this.gateway = gatewayUrl.endsWith('/') ? gatewayUrl : gatewayUrl + '/';
    this.maxConcurrent = maxConcurrent;
  }

  async downloadFile(
    cid: string,
    outputPath: string,
    retries: number = 1
  ): Promise<DownloadResult> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        // Create directory if it doesn't exist
        const dir = path.dirname(outputPath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }

        const url = `${this.gateway}${cid}`;

        // Create AbortController for timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

        const response = await fetch(url, {
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        if (!response.body) {
          throw new Error('Response body is null');
        }

        // Convert ReadableStream to Node.js Readable stream
        const reader = response.body.getReader();
        const writer = fs.createWriteStream(outputPath);

        // Stream the data
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            await new Promise<void>((resolve, reject) => {
              writer.write(value, (error) => {
                if (error) reject(error);
                else resolve();
              });
            });
          }

          await new Promise<void>((resolve, reject) => {
            writer.end((error?: Error | null) => {
              if (error) reject(error);
              else resolve();
            });
          });
        } finally {
          reader.releaseLock();
        }

        return {
          cid,
          success: true,
          path: outputPath,
        };
      } catch (error) {
        lastError = error as Error;
        if (attempt < retries) {
          await new Promise((resolve) => setTimeout(resolve, 1000)); // Wait 1 second before retry
        }
      }
    }

    return {
      cid,
      success: false,
      error: lastError,
    };
  }

  private async processQueue(): Promise<void> {
    while (
      this.downloadQueue.length > 0 &&
      this.activeDownloads < this.maxConcurrent
    ) {
      const task = this.downloadQueue.shift();
      if (task) {
        this.activeDownloads++;
        task().finally(() => {
          this.activeDownloads--;
          this.processQueue();
        });
      }
    }
  }

  private async enqueueDownload(
    cid: string,
    outputPath: string
  ): Promise<DownloadResult> {
    return new Promise((resolve) => {
      const task = async () => {
        const result = await this.downloadFile(cid, outputPath);
        this.completedCount++;
        if (this.onProgress) {
          this.onProgress(this.completedCount, this.totalCount);
        }
        resolve(result);
      };
      this.downloadQueue.push(task);
      this.processQueue();
    });
  }

  async downloadBatch(
    assignments: ElephantAssignment[],
    downloadDir: string = './downloads',
    onProgress?: (completed: number, total: number) => void
  ): Promise<DownloadResult[]> {
    this.completedCount = 0;
    this.totalCount = assignments.length;
    this.onProgress = onProgress;

    const downloadPromises = assignments.map((assignment) => {
      const outputPath = `${downloadDir}/${assignment.cid}`;
      return this.enqueueDownload(assignment.cid, outputPath);
    });

    const results = await Promise.all(downloadPromises);

    // Reset counters
    this.completedCount = 0;
    this.totalCount = 0;
    this.onProgress = undefined;

    return results;
  }
}
