import path from 'path';
import { fileURLToPath } from 'url';

export const NER_MODELS = {
  MONEY_DATE: {
    remote: 'zencrazycat/ner-bert-base-cased-ontonotesv5-englishv4-onnx',
    envVar: 'MODEL_MONEY_DATE',
  },
  PERSON_ORG_LOCATION: {
    remote: 'Xenova/bert-base-NER-uncased',
    envVar: 'MODEL_PER_ORG_LOC',
  },
} as const;

function getPackageRoot(): string {
  const currentFileUrl = import.meta.url;
  const currentFilePath = fileURLToPath(currentFileUrl);
  const currentDir = path.dirname(currentFilePath);

  // From dist/lib/nlp/model-config.js, go up 3 levels to package root
  // dist/lib/nlp -> dist/lib -> dist -> package-root
  return path.resolve(currentDir, '..', '..', '..');
}

export function getModelCacheDir(): string {
  const cacheDir =
    process.env.TRANSFORMERSJS_CACHE_DIR ||
    path.join(getPackageRoot(), '.cache', 'transformers');
  return cacheDir;
}

export function getLocalModelDir(
  modelType: 'MONEY_DATE' | 'PERSON_ORG_LOCATION'
): string | undefined {
  const envVarMap = {
    MONEY_DATE: 'MONEYDATE_LOCAL',
    PERSON_ORG_LOCATION: 'PERORGLOCAL_LOCAL',
  };
  return process.env[envVarMap[modelType]];
}

export function getRemoteModelId(
  modelType: 'MONEY_DATE' | 'PERSON_ORG_LOCATION'
): string {
  const model = NER_MODELS[modelType];
  return process.env[model.envVar] || model.remote;
}
