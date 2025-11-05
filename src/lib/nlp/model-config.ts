import path from 'path';

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

export function getModelCacheDir(): string {
  const cacheDir =
    process.env.TRANSFORMERSJS_CACHE_DIR ||
    path.join(process.cwd(), '.cache', 'transformers');
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
