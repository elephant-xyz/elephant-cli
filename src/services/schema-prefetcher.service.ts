import { FileScannerService } from './file-scanner.service.js';
import { SchemaCacheService } from './schema-cache.service.js';
import { SimpleProgress } from '../utils/simple-progress.js';
import { logger } from '../utils/logger.js';

export class SchemaPrefetcherService {
  async prefetch(
    inputDir: string,
    fileScannerService: FileScannerService,
    schemaCacheService: SchemaCacheService,
    progress?: SimpleProgress
  ): Promise<void> {
    logger.info('Discovering all unique schema CIDs...');
    const allDataGroupCids =
      await fileScannerService.getAllDataGroupCids(inputDir);
    const uniqueSchemaCidsArray = Array.from(allDataGroupCids);
    logger.info(
      `Found ${uniqueSchemaCidsArray.length} unique schema CIDs to pre-fetch.`
    );

    if (uniqueSchemaCidsArray.length === 0) return;

    const schemaProgress = new SimpleProgress(
      uniqueSchemaCidsArray.length,
      'Fetching Schemas'
    );
    schemaProgress.start();

    let prefetchedCount = 0;
    let failedCount = 0;

    for (const schemaCid of uniqueSchemaCidsArray) {
      let fetchSuccess = false;
      try {
        await schemaCacheService.getSchema(schemaCid);
        prefetchedCount++;
        fetchSuccess = true;
      } catch (error) {
        logger.warn(
          `Error pre-fetching schema ${schemaCid}: ${error instanceof Error ? error.message : String(error)}. It will be attempted again during processing.`
        );
        failedCount++;
      }
      schemaProgress.increment(fetchSuccess ? 'processed' : 'errors');
    }

    schemaProgress.stop();
    logger.info(
      `Schema pre-fetching complete: ${prefetchedCount} successful, ${failedCount} failed/not found.`
    );
  }
}
