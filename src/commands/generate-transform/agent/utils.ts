import { PromptTemplate } from '@langchain/core/prompts';
import { SystemMessage } from '@langchain/core/messages';
import { MemorySaver } from '@langchain/langgraph';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import type { StructuredToolInterface } from '@langchain/core/tools';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { RunnableConfig } from '@langchain/core/runnables';
import type { ChatModel } from './state.js';
import { invokeWithLocalRetry } from './helpers/invoke-with-retry.js';

export const MAX_ITERATIONS = 15;

export async function formatPrompt(
  template: PromptTemplate,
  variables: Record<string, string>
): Promise<string> {
  const allVars = (template.inputVariables ?? []) as string[];
  const missing = allVars.filter((v) => !(v in variables));
  if (missing.length > 0) {
    throw new Error(
      `Missing prompt variables: ${missing.join(', ')} for template: ${template.template?.slice(0, 40)}...`
    );
  }
  return template.format(variables);
}

export function isAgentRunnable(x: unknown): x is {
  invoke: (input: unknown, config?: RunnableConfig) => Promise<unknown>;
} {
  return (
    !!x &&
    typeof x === 'object' &&
    'invoke' in (x as Record<string, unknown>) &&
    typeof (x as Record<string, unknown>).invoke === 'function'
  );
}

export function ensureBaseChatModel(chat: ChatModel): BaseChatModel {
  if (typeof chat === 'function') {
    throw new Error('Unsupported ChatModel function for agent creation');
  }
  if (
    !chat ||
    typeof chat !== 'object' ||
    typeof (chat as Record<string, unknown>).invoke !== 'function'
  ) {
    throw new Error('ChatModel must be an object with invoke()');
  }
  return chat as unknown as BaseChatModel;
}

export async function buildAgent(
  llm: BaseChatModel,
  tools: StructuredToolInterface[],
  saver?: MemorySaver,
  prompt?: string
) {
  return createReactAgent({
    llm,
    tools,
    checkpointSaver: saver ?? new MemorySaver(),
    ...(prompt ? { stateModifier: new SystemMessage(prompt) } : {}),
  });
}

export async function invokeAgent(
  agent: unknown,
  userInput: string,
  config: RunnableConfig
): Promise<string> {
  if (!isAgentRunnable(agent)) {
    throw new Error('Invalid agent: missing invoke()');
  }
  const messages = [{ role: 'user', content: userInput } as const];

  const result: unknown = await invokeWithLocalRetry(() =>
    agent.invoke({ messages }, { ...config, recursionLimit: 500 })
  );

  if (typeof result === 'string') return result;
  if (result && typeof result === 'object') {
    const maybeMessages = (result as { messages?: unknown }).messages;
    if (Array.isArray(maybeMessages) && maybeMessages.length > 0) {
      const last = maybeMessages[maybeMessages.length - 1] as unknown;
      if (last && typeof last === 'object') {
        const content = (last as Record<string, unknown>).content;
        if (typeof content === 'string') return content;
        try {
          return JSON.stringify(content);
        } catch {
          return String(content);
        }
      }
    }
    if ('output' in (result as Record<string, unknown>)) {
      const out = (result as Record<string, unknown>).output;
      return String(out);
    }
  }
  try {
    return JSON.stringify(result);
  } catch {
    return String(result);
  }
}

export function extractFeedback(output: string): string {
  const feedbackPrefix =
    'You have preiously created all 3 scripts. Please review and fix any issues in the extraction scripts.';
  const actionMatch = output.match(/ACTION PLAN[:\s]*([\s\S]+?)(?:STATUS:|$)/i);
  if (actionMatch) {
    return `${feedbackPrefix} Fix these issues: ${actionMatch[1].trim()}`;
  }

  const rejectMatch = output.match(/REJECTED[:\s]*([\s\S]+?)$/i);
  if (rejectMatch) {
    return `${feedbackPrefix} ${rejectMatch[1].trim()}`;
  }

  return 'Please review and fix any issues in the extraction scripts';
}
