import { env } from '@xenova/transformers';
import { existsSync, statSync } from 'fs';
import path from 'path';

export interface ModelConfig {
  localModelDir?: string;
  modelIdRemote: string;
  preferLocal?: boolean;
  cacheDir?: string;
}

export interface ResolvedModel {
  modelId: string;
  mode: 'local' | 'remote';
}

function looksLikeModelDir(absDir: string): boolean {
  const tok = path.join(absDir, 'tokenizer.json');
  const onnxDir = path.join(absDir, 'onnx');
  const q = path.join(onnxDir, 'model_quantized.onnx');
  const m = path.join(onnxDir, 'model.onnx');
  try {
    return (
      statSync(tok).isFile() && (statSync(q).isFile() || statSync(m).isFile())
    );
  } catch {
    return false;
  }
}

export function configureTransformersJS(config: ModelConfig): ResolvedModel {
  const { localModelDir, modelIdRemote, preferLocal = true, cacheDir } = config;

  if (cacheDir) {
    env.cacheDir = cacheDir;
  }

  if (preferLocal && localModelDir) {
    const abs = path.resolve(localModelDir);
    if (looksLikeModelDir(abs)) {
      const parts = abs.split(path.sep);
      const idx = parts.lastIndexOf('models');
      const parent =
        idx !== -1
          ? parts.slice(0, idx + 1).join(path.sep)
          : path.resolve(abs, '..');
      const relId = path.relative(parent, abs).split(path.sep).join('/');

      env.allowRemoteModels = false;
      env.localModelPath = parent;
      return { modelId: relId, mode: 'local' };
    }
  }

  env.allowRemoteModels = true;
  return { modelId: modelIdRemote, mode: 'remote' };
}
