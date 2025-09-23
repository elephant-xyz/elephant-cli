import { promises as fs } from 'fs';
import path from 'path';

export type PromptKey =
  | 'system-rules'
  | 'owner-analysis'
  | 'structure-generator'
  | 'structure-evaluator'
  | 'script-assembly'
  | 'error-fix';

export async function loadPrompt(
  key: PromptKey,
  vars: Record<string, string> = {}
): Promise<string> {
  const file = path.join(
    path.dirname(new URL(import.meta.url).pathname),
    `${key}.md`
  );
  const content = await fs.readFile(file, 'utf-8');
  return interpolate(content, vars);
}

function interpolate(src: string, vars: Record<string, string>): string {
  return src.replace(/\{\{(\w+)\}\}/g, (_, k) => (k in vars ? vars[k] : ''));
}
