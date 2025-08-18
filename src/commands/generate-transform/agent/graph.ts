import { StateGraph, START, END, MemorySaver } from '@langchain/langgraph';
import { RunnableConfig } from '@langchain/core/runnables';
import {
  AgentStateAnnotation,
  type AgentState,
  type ChatModel,
} from './state.js';
import { logger } from '../../../utils/logger.js';
import { ownerAnalysisNode } from './nodes/ownerAnalysisNode.js';
import { structureExtractionNode } from './nodes/structureExtractionNode.js';
import { extractionNode } from './nodes/extractionNode.js';

export type NodeFunction = (
  state: AgentState,
  config?: RunnableConfig
) => Promise<Partial<AgentState>>;

export type RetryPolicy = {
  maxAttempts: number;
  retryOn?: (error: unknown) => boolean;
};

/**
 * Build the agent graph with LangGraph StateGraph
 * @param retryPolicy - Retry policy for nodes
 * @returns Compiled graph ready for execution
 */
export function buildAgentGraph(retryPolicy: RetryPolicy) {
  const workflow = new StateGraph(AgentStateAnnotation)
    .addNode(
      'ownerAnalysis',
      async (state: AgentState, config?: RunnableConfig) => {
        logger.info('node_start: ownerAnalysis');
        const chat = config?.configurable?.chat_model as ChatModel;
        if (!chat) {
          throw new Error('Chat model not provided in config');
        }
        const result = await ownerAnalysisNode(state, chat);
        logger.info('node_end: ownerAnalysis');
        return result;
      },
      {
        retryPolicy: {
          maxAttempts: retryPolicy.maxAttempts,
          retryOn: retryPolicy.retryOn,
        },
      }
    )
    .addNode(
      'structureExtraction',
      async (state: AgentState, config?: RunnableConfig) => {
        logger.info('node_start: structureExtraction');
        const chat = config?.configurable?.chat_model as ChatModel;
        if (!chat) {
          throw new Error('Chat model not provided in config');
        }
        const result = await structureExtractionNode(state, chat);
        logger.info('node_end: structureExtraction');
        return result;
      },
      {
        retryPolicy: {
          maxAttempts: retryPolicy.maxAttempts,
          retryOn: retryPolicy.retryOn,
        },
      }
    )
    .addNode(
      'extraction',
      async (state: AgentState, config?: RunnableConfig) => {
        logger.info('node_start: extraction');
        const chat = config?.configurable?.chat_model as ChatModel;
        if (!chat) {
          throw new Error('Chat model not provided in config');
        }
        const result = await extractionNode(state, chat);
        logger.info('node_end: extraction');
        return result;
      },
      {
        retryPolicy: {
          maxAttempts: retryPolicy.maxAttempts,
          retryOn: retryPolicy.retryOn,
        },
      }
    )
    .addEdge(START, 'ownerAnalysis')
    .addEdge(START, 'structureExtraction')
    .addEdge('structureExtraction', 'extraction')
    .addEdge('ownerAnalysis', 'extraction')
    .addEdge('extraction', END);

  const checkpointer = new MemorySaver();
  return workflow.compile({ checkpointer });
}

/**
 * Run the three-node graph with the new LangGraph implementation
 * @param initial - Initial state
 * @param chat - Chat model to use
 * @param retry - Retry policy
 * @returns Final state after execution
 */
export async function runThreeNodeGraph(
  initial: AgentState,
  chat: ChatModel,
  retry: RetryPolicy
): Promise<AgentState> {
  const graph = buildAgentGraph(retry);

  const config: RunnableConfig = {
    configurable: {
      thread_id: `transform-${Date.now()}`,
      chat_model: chat,
    },
  };

  const finalState = await graph.invoke(initial, config);

  return finalState as AgentState;
}
