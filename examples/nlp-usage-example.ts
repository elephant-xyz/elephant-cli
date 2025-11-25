/**
 * Example: Using NER models in Elephant CLI
 *
 * This example shows how to use the configured NER models
 * to extract entities from text.
 */

import { pipeline } from '@xenova/transformers';
import {
  configureTransformersJS,
  getModelCacheDir,
  getRemoteModelId,
  getLocalModelDir,
} from '../src/lib/nlp/index.js';

async function extractEntities(text: string) {
  console.log('Configuring NER models...\n');

  // Configure Money/Date model
  const moneyDateConfig = configureTransformersJS({
    localModelDir: getLocalModelDir('MONEY_DATE'),
    modelIdRemote: getRemoteModelId('MONEY_DATE'),
    cacheDir: getModelCacheDir(),
    preferLocal: true,
  });

  console.log(`Money/Date model: ${moneyDateConfig.modelId} (${moneyDateConfig.mode})`);

  // Configure Person/Org/Location model
  const perOrgLocConfig = configureTransformersJS({
    localModelDir: getLocalModelDir('PERSON_ORG_LOCATION'),
    modelIdRemote: getRemoteModelId('PERSON_ORG_LOCATION'),
    cacheDir: getModelCacheDir(),
    preferLocal: true,
  });

  console.log(`Person/Org/Location model: ${perOrgLocConfig.modelId} (${perOrgLocConfig.mode})\n`);

  // Create pipelines
  console.log('Loading pipelines...\n');
  const nerMoney = await pipeline('token-classification', moneyDateConfig.modelId);
  const nerEntities = await pipeline('token-classification', perOrgLocConfig.modelId);

  // Run entity extraction
  console.log('Extracting entities...\n');
  console.log('Input text:', text);
  console.log('\n---\n');

  const moneyResults = await nerMoney(text);
  const entityResults = await nerEntities(text);

  console.log('Money/Date entities:');
  console.log(JSON.stringify(moneyResults, null, 2));
  console.log('\nPerson/Org/Location entities:');
  console.log(JSON.stringify(entityResults, null, 2));
}

// Example usage
const sampleText = 'John Smith works at Microsoft in Seattle. The company earned $50,000 in revenue on January 15, 2024.';

extractEntities(sampleText).catch(console.error);
