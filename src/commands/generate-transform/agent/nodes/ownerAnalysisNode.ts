import { AgentState, ChatModel } from '../state.js';
import { logger } from '../../../../utils/logger.js';
import { promptRegistry } from '../../prompts/langchain-registry.js';
import { createMinimalFsTools } from '../helpers/langchain-tools.js';
import { AgentExecutor, createToolCallingAgent } from 'langchain/agents';
import { invokeWithLocalRetry } from '../helpers/invoke-with-retry.js';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { formatPrompt } from '../utils.js';
import { promises as fs } from 'fs';
import path from 'path';

export async function ownerAnalysisNode(
  state: AgentState,
  chat: ChatModel
): Promise<Partial<AgentState>> {
  logger.info(`node_detail: owner_analysis msg: Preparing owner analysis`);

  const lcTools = createMinimalFsTools(state) as any;

  // Get the base template and format it with filename variables
  const baseTemplate = await promptRegistry.getPromptTemplate('owner-analysis');

  const templateVars = {
    input_html_file: state.filenames.INPUT_HTML,
    owner_data_file: state.filenames.OWNER_DATA,
    owner_script: state.filenames.OWNER_MAPPING_SCRIPT,
  };

  // Format the system prompt with our variables
  const formattedSystem = await formatPrompt(baseTemplate, templateVars);

  // Create a chat prompt template with the formatted system message
  const prompt = ChatPromptTemplate.fromMessages([
    ['system', formattedSystem],
    ['human', '{input}'],
    ['placeholder', '{agent_scratchpad}'],
  ]);

  const agent = createToolCallingAgent({
    llm: chat as any,
    tools: lcTools,
    prompt,
  } as any);

  const executor = new AgentExecutor({
    agent: agent as any,
    tools: lcTools,
    verbose: false,
    // Ensure non-streaming execution path
    streamRunnable: false,
  } as any);

  // Read input HTML file
  let inputHtmlContent = '';
  try {
    const inputHtmlPath = path.join(state.tempDir, state.filenames.INPUT_HTML);
    inputHtmlContent = await fs.readFile(inputHtmlPath, 'utf-8');
  } catch (err) {
    logger.warn(`Could not read input HTML: ${err}`);
  }

  // Prepare user message with file contents
  const userMessage = `Begin the owner analysis task.

Available file contents:

<input_html>
${inputHtmlContent || 'File not available'}
</input_html>

Use the provided file content above for analysis. You still have access to write_file and run_js tools for creating and executing scripts.`;

  // Execute the agent with file contents
  await invokeWithLocalRetry(() => executor.invoke({ input: userMessage }));

  return {
    logs: [
      {
        node: 'ownerAnalysis',
        timestamp: Date.now(),
        message: 'Owner analysis completed',
      },
    ],
  };
}
