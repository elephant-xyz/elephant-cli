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
import { dataGroupExtractionNode } from './nodes/dataGroupExtractionNode.js';

export type NodeFunction = (
  state: AgentState,
  config?: RunnableConfig
) => Promise<Partial<AgentState>>;

export type RetryPolicy = {
  maxAttempts: number;
  retryOn?: (error: unknown) => boolean;
};

export type GraphNodeName =
  | 'ownerAnalysis'
  | 'structureExtraction'
  | 'extraction';

export type GraphProgressEvent =
  | { type: 'node_start'; name: GraphNodeName }
  | { type: 'node_end'; name: GraphNodeName };

export type GraphProgressCallback = (event: GraphProgressEvent) => void;

/**
 * Build the agent graph with LangGraph StateGraph
 * @param retryPolicy - Retry policy for nodes
 * @returns Compiled graph ready for execution
 */
export type GraphNodesControl = { owner?: boolean; structure?: boolean; dataGroupOnly?: boolean };

export function buildAgentGraph(
  retryPolicy: RetryPolicy,
  onProgress?: GraphProgressCallback,
  nodes?: GraphNodesControl
) {
  const withCommon =
    <N extends GraphNodeName>(
      name: N,
      fn: (state: AgentState, chat: ChatModel) => Promise<Partial<AgentState>>
    ) =>
    async (
      state: AgentState,
      config?: RunnableConfig
    ): Promise<Partial<AgentState>> => {
      // Conditionally skip owner/structure nodes
      if (name === 'ownerAnalysis' && nodes?.owner === false) {
        logger.info('node_skip: ownerAnalysis');
        return {};
      }
      if (name === 'structureExtraction' && nodes?.structure === false) {
        logger.info('node_skip: structureExtraction');
        return {};
      }
      logger.info(`node_start: ${name}`);
      onProgress?.({ type: 'node_start', name });
      const chat = config?.configurable?.chat_model as ChatModel;
      if (!chat) {
        throw new Error('Chat model not provided in config');
      }
      const result = await fn(state, chat);
      logger.info(`node_end: ${name}`);
      onProgress?.({ type: 'node_end', name });
      return result;
    };

  const workflow = new StateGraph(AgentStateAnnotation)
    .addNode('ownerAnalysis', withCommon('ownerAnalysis', ownerAnalysisNode), {
      retryPolicy: {
        maxAttempts: retryPolicy.maxAttempts,
        retryOn: retryPolicy.retryOn,
      },
    })
    .addNode(
      'structureExtraction',
      withCommon('structureExtraction', structureExtractionNode),
      {
        retryPolicy: {
          maxAttempts: retryPolicy.maxAttempts,
          retryOn: retryPolicy.retryOn,
        },
      }
    )
    .addNode(
      'extraction',
      withCommon(
        'extraction',
        nodes?.dataGroupOnly === true ? dataGroupExtractionNode : extractionNode
      ),
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
  retry: RetryPolicy,
  onProgress?: GraphProgressCallback,
  nodes?: GraphNodesControl
): Promise<AgentState> {
  const graph = buildAgentGraph(retry, onProgress, nodes);

  const config: RunnableConfig = {
    configurable: {
      thread_id: `transform-${Date.now()}`,
      chat_model: chat,
    },
  };

  const finalState = await graph.invoke(initial, config);

  return finalState as AgentState;
}
