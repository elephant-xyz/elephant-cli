import { Annotation } from '@langchain/langgraph';
import { promises as fs } from 'fs';
import path from 'path';
import { loadPrompt, type PromptKey } from '../prompts/registry.js';
import { logger } from '../../../utils/logger.js';
import { FilenameKey } from '../config/filenames.js';

export type ScriptItem = {
  path: string;
  content: string;
  hash: string;
  role: 'owner' | 'structure' | 'layout' | 'utility' | 'assembly' | 'helper';
};

export const AgentStateAnnotation = Annotation.Root({
  tempDir: Annotation<string>,
  inputPaths: Annotation<{
    address: string;
    parcel: string;
    input: string;
    priorScriptsDir?: string;
    priorErrorsPath?: string;
  }>,
  filenames: Annotation<Record<FilenameKey, string>>,
  generatedScripts: Annotation<ScriptItem[]>({
    reducer: (current: ScriptItem[], update: ScriptItem[]) =>
      current.concat(update),
    default: () => [],
  }),
  attempts: Annotation<number>({
    reducer: (current: number, update: number) => current + update,
    default: () => 0,
  }),
  logs: Annotation<Record<string, unknown>[]>({
    reducer: (
      current: Record<string, unknown>[],
      update: Record<string, unknown>[]
    ) => current.concat(update),
    default: () => [],
  }),
  schemas: Annotation<Record<string, string>>,
  dataDictionaryContent: Annotation<string | undefined>,
});

// Export the state type for use in nodes
export type AgentState = typeof AgentStateAnnotation.State;

export type ChatModel =
  | ((prompt: string) => Promise<string>)
  | { invoke: (input: string) => Promise<unknown> };

export async function callChat(
  chat: ChatModel,
  prompt: string
): Promise<string> {
  if (typeof chat === 'function') {
    return await chat(prompt);
  }
  const result = await chat.invoke(prompt);
  if (typeof result === 'string') return result;
  if (
    result &&
    typeof result === 'object' &&
    'content' in (result as Record<string, unknown>)
  ) {
    const content = (result as Record<string, unknown>)['content'];
    if (typeof content === 'string') return content;
    try {
      return JSON.stringify(content);
    } catch {
      return String(content);
    }
  }
  try {
    return JSON.stringify(result);
  } catch {
    return String(result);
  }
}

export async function buildPriorContext(state: AgentState): Promise<string> {
  const chunks: string[] = [];
  const { priorScriptsDir, priorErrorsPath } = state.inputPaths;
  if (priorScriptsDir) {
    chunks.push(
      `Previous scripts found in ${priorScriptsDir}. Please review and improve them based on the errors.`
    );
    try {
      const entries = await fs.readdir(priorScriptsDir, {
        withFileTypes: true,
      });
      for (const ent of entries) {
        if (!ent.isFile() || !/\.js$/i.test(ent.name)) continue;
        const abs = path.join(priorScriptsDir, ent.name);
        const content = await fs.readFile(abs, 'utf-8');
        chunks.push(`FILE ${ent.name}:
${content}
`);
      }
    } catch {
      logger.warn(`Unable to read ${priorScriptsDir}`);
    }
  }
  if (priorErrorsPath) {
    try {
      const csv = await fs.readFile(priorErrorsPath, 'utf-8');
      chunks.push(`Validation errors CSV (${priorErrorsPath}):\n${csv}`);
    } catch {
      logger.warn(`Unable to read ${priorErrorsPath}`);
    }
  }
  return chunks.length ? `\n\n# Prior Context\n${chunks.join('\n\n')}` : '';
}

export async function renderSimplePrompt(
  key: PromptKey,
  state: AgentState
): Promise<string> {
  const [task, prior] = await Promise.all([
    loadPrompt(key),
    buildPriorContext(state),
  ]);
  const parts = [task.trim(), prior.trim()].filter(Boolean);
  return parts.join('\n\n');
}
