#!/usr/bin/env node

/**
 * Prefetch NER models for offline use
 * This script downloads and caches the required NER models during installation
 * Can be skipped in CI by setting NO_PREFETCH=1
 */

import { pipeline, env } from '@xenova/transformers';
import { existsSync, mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Check if we should skip prefetch
if (process.env.NO_PREFETCH === '1') {
  console.log('[INFO] Skipping model prefetch (NO_PREFETCH=1)');
  process.exit(0);
}

// Model configurations
const MODELS = {
  MONEY_DATE: process.env.MODEL_MONEY_DATE || 'zencrazycat/ner-bert-base-cased-ontonotesv5-englishv4-onnx',
  PERSON_ORG_LOCATION: process.env.MODEL_PER_ORG_LOC || 'Xenova/bert-base-NER-uncased',
};

// Set cache directory
const cacheDir = process.env.TRANSFORMERSJS_CACHE_DIR || path.join(process.cwd(), '.cache', 'transformers');
env.cacheDir = cacheDir;
env.allowRemoteModels = true;

// Ensure cache directory exists
if (!existsSync(cacheDir)) {
  mkdirSync(cacheDir, { recursive: true });
}

async function prefetchModel(modelId, name) {
  console.log(`\n[INFO] Downloading ${name} model: ${modelId}`);
  console.log(`[INFO] Cache directory: ${cacheDir}`);

  try {
    const startTime = Date.now();

    // Create pipeline - this will download and cache the model
    const nerPipeline = await pipeline('token-classification', modelId);

    // Test with a simple sentence to ensure model works
    await nerPipeline('Test sentence');

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[SUCCESS] ${name} model cached successfully (${elapsed}s)`);

    return true;
  } catch (error) {
    console.error(`[ERROR] Failed to download ${name} model:`, error.message);
    console.error('[INFO] The model will be downloaded on first use instead.');
    return false;
  }
}

async function main() {
  console.log('='.repeat(60));
  console.log('NER Models Prefetch');
  console.log('='.repeat(60));
  console.log('\n[INFO] This will download models for offline use.');
  console.log('[INFO] This may take a few minutes depending on your connection.\n');

  const results = await Promise.allSettled([
    prefetchModel(MODELS.MONEY_DATE, 'Money/Date'),
    prefetchModel(MODELS.PERSON_ORG_LOCATION, 'Person/Org/Location'),
  ]);

  const allSucceeded = results.every(r => r.status === 'fulfilled' && r.value === true);

  console.log('\n' + '='.repeat(60));

  if (allSucceeded) {
    console.log('[SUCCESS] All models downloaded and cached successfully!');
    console.log('\n[INFO] Models are stored in:', cacheDir);
  } else {
    console.log('[WARNING] Some models failed to download.');
    console.log('[INFO] They will be downloaded automatically on first use.');
  }

  console.log('='.repeat(60) + '\n');
}

main().catch((error) => {
  console.error('[ERROR] Prefetch failed:', error);
  console.log('[INFO] Models will be downloaded on first use instead.');
  process.exit(0); // Don't fail installation
});
