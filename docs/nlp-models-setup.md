# NLP Models Setup

This document explains how the NER (Named Entity Recognition) models are configured and managed in the Elephant CLI.

## Overview

The CLI uses two NER models for entity extraction:

1. **Money/Date Model**: `zencrazycat/ner-bert-base-cased-ontonotesv5-englishv4-onnx`
   - Extracts: MONEY, DATE, CARDINAL entities

2. **Person/Org/Location Model**: `Xenova/bert-base-NER-uncased`
   - Extracts: PERSON, ORGANIZATION, LOCATION entities

## Installation Process

During `npm install`, the `postinstall` script automatically:

1. Downloads both models from HuggingFace
2. Caches them locally in `.cache/transformers/`
3. Converts them to ONNX format if needed (handled by @xenova/transformers)

## Configuration

### Environment Variables

You can customize model behavior using these environment variables:

- `MODEL_MONEY_DATE`: Override the Money/Date model ID (default: `zencrazycat/ner-bert-base-cased-ontonotesv5-englishv4-onnx`)
- `MODEL_PER_ORG_LOC`: Override the Person/Org/Location model ID (default: `Xenova/bert-base-NER-uncased`)
- `TRANSFORMERSJS_CACHE_DIR`: Custom cache directory (default: `.cache/transformers`)
- `NO_PREFETCH`: Set to `1` to skip model prefetch during installation (useful for CI)

### Local Models (Optional)

You can use local model files instead of downloading from HuggingFace:

- `MONEYDATE_LOCAL`: Path to local Money/Date model directory
- `PERORGLOCAL_LOCAL`: Path to local Person/Org/Location model directory

Local model directory structure:
```
model-directory/
├── tokenizer.json
├── tokenizer_config.json
├── config.json
├── special_tokens_map.json
├── vocab.txt
└── onnx/
    └── model_quantized.onnx  (or model.onnx)
```

## Usage in Code

```typescript
import { pipeline, env } from '@xenova/transformers';
import {
  configureTransformersJS,
  getModelCacheDir,
  getRemoteModelId,
  getLocalModelDir,
} from '../lib/nlp';

// Configure Money/Date model
const moneyDateConfig = configureTransformersJS({
  localModelDir: getLocalModelDir('MONEY_DATE'),
  modelIdRemote: getRemoteModelId('MONEY_DATE'),
  cacheDir: getModelCacheDir(),
});

// Configure Person/Org/Location model
const perOrgLocConfig = configureTransformersJS({
  localModelDir: getLocalModelDir('PERSON_ORG_LOCATION'),
  modelIdRemote: getRemoteModelId('PERSON_ORG_LOCATION'),
  cacheDir: getModelCacheDir(),
});

// Create pipelines
const nerMoney = await pipeline('token-classification', moneyDateConfig.modelId);
const nerEntities = await pipeline('token-classification', perOrgLocConfig.modelId);
```

## Custom ONNX Models

The Money/Date model (`zencrazycat/ner-bert-base-cased-ontonotesv5-englishv4-onnx`) is already published with ONNX format and ready to use.

If you need to publish your own custom model:

1. **Convert the model to ONNX format** (see the conversion script in `tmp/nlp-testing-js/`)
2. **Publish to HuggingFace**:
   ```bash
   # Install HF CLI
   pip install huggingface_hub

   # Login
   huggingface-cli login

   # Create a new repo
   huggingface-cli repo create your-org/your-model-name-onnx

   # Upload your converted model
   cd path/to/your/model
   huggingface-cli upload your-org/your-model-name-onnx . .
   ```

3. **Update the model ID**:
   - Set `MODEL_MONEY_DATE` environment variable to your published model
   - Or update `NER_MODELS.MONEY_DATE.remote` in [src/lib/nlp/model-config.ts](../src/lib/nlp/model-config.ts)

### Pinning Model Versions

For production, pin specific commits:

```typescript
// In model-config.ts
export const NER_MODELS = {
  MONEY_DATE: {
    remote: 'your-org/ner-bert-base-cased-ontonotesv5-englishv4-onnx@<commit-sha>',
    envVar: 'MODEL_MONEY_DATE',
  },
  // ...
};
```

## Troubleshooting

### Models not downloading during install

If models fail to download during `npm install`:
- Check your internet connection
- The models will be automatically downloaded on first use
- Use `NO_PREFETCH=1` to skip prefetch and download on demand

### Model cache size

The models are ~200-400MB each. Cached in `.cache/transformers/`:
- Add `.cache/` to `.gitignore` (already done)
- For Docker: mount a volume or use multi-stage builds

### CI/CD

To skip model download in CI:
```bash
NO_PREFETCH=1 npm install
```

### Offline usage

After first successful install:
1. Models are cached locally
2. Can work offline if `.cache/transformers/` exists
3. Set `preferLocal: true` in `configureTransformersJS()` to enforce local-only mode

## Architecture

### File Structure

```
src/lib/nlp/
├── model-config.ts       # Model IDs and configuration
├── model-resolver.ts     # Local/remote model resolution logic
└── index.ts             # Public exports

scripts/
└── prefetch-models.js    # Postinstall script for model download
```

### Resolution Flow

1. Check environment variables for custom model IDs
2. Check local model directories (if provided)
3. Validate local model structure (tokenizer.json, onnx/model.onnx)
4. Fall back to remote model from HuggingFace
5. Cache downloaded models in `.cache/transformers/`

## References

- [@xenova/transformers](https://www.npmjs.com/package/@xenova/transformers) - Transformers.js library
- [HuggingFace Model Hub](https://huggingface.co/models) - Model repository
- [ONNX Runtime](https://onnxruntime.ai/) - Model execution runtime
