import { AgentState, ChatModel } from '../state.js';
import { logger } from '../../../../utils/logger.js';
import { createMinimalFsTools } from '../helpers/langchain-tools.js';
import { promptRegistry } from '../../prompts/langchain-registry.js';
import { MemorySaver } from '@langchain/langgraph';
import { promises as fs } from 'fs';
import path from 'path';
import {
  MAX_ITERATIONS,
  formatPrompt,
  ensureBaseChatModel,
  buildAgent,
  invokeAgent,
  extractFeedback,
} from '../utils.js';

/**
 * Main structure extraction node with multi-agent conversation
 */
export async function structureExtractionNode(
  state: AgentState,
  chat: ChatModel
): Promise<Partial<AgentState>> {
  logger.info(
    'node: structure_extraction msg: Starting multi-agent extraction'
  );

  const tools = createMinimalFsTools(state);
  let iterations = 0;
  let isAccepted = false;

  const templateVars = {
    structure_schema: state.schemas?.structure,
    utility_schema: state.schemas?.utility,
    layout_schema: state.schemas?.layout,
    // Add filename variables
    input_file: state.filenames.INPUT_FILE,
    structure_data_file: state.filenames.STRUCTURE_DATA,
    utility_data_file: state.filenames.UTILITIES_DATA,
    layout_data_file: state.filenames.LAYOUT_DATA,
    structure_script: state.filenames.STRUCTURE_MAPPING_SCRIPT,
    utility_script: state.filenames.UTILITY_MAPPING_SCRIPT,
    layout_script: state.filenames.LAYOUT_MAPPING_SCRIPT,
    data_dir: state.filenames.DATA_DIR,
  };

  logger.info(
    `schemas available: ${Object.keys(state.schemas || {}).join(', ')}`
  );

  // Create separate thread IDs for each agent to maintain independent conversation histories
  const sessionId = Date.now();
  const generatorThreadId = `structure-generator-${sessionId}`;
  const evaluatorThreadId = `structure-evaluator-${sessionId}`;

  // Create separate memory instances for each agent
  // This ensures that generator and evaluator maintain independent conversation contexts
  const generatorMemory = new MemorySaver();
  const evaluatorMemory = new MemorySaver();

  // Ensure fresh templates (avoid stale cache while iterating locally)
  promptRegistry.clearCache();
  // Use LangChain APIs to apply variables to prompt templates
  const generatorTemplate = await promptRegistry.getPromptTemplate(
    'structure-generator'
  );
  const generatorSystem = await formatPrompt(generatorTemplate, templateVars);

  const evaluatorTemplate = await promptRegistry.getPromptTemplate(
    'structure-evaluator'
  );
  const evaluatorSystem = await formatPrompt(evaluatorTemplate, templateVars);

  const llm = ensureBaseChatModel(chat);

  // Build generator agent with its own memory
  const agentGenerator = await buildAgent(
    llm,
    tools,
    generatorMemory,
    generatorSystem
  );

  // Build evaluator agent with its own memory
  const agentEvaluator = await buildAgent(
    llm,
    [],
    evaluatorMemory,
    evaluatorSystem
  );

  // Create separate configs with unique thread IDs for each agent
  const generatorConfig = {
    configurable: { thread_id: generatorThreadId },
  } as const;
  const evaluatorConfig = {
    configurable: { thread_id: evaluatorThreadId },
  } as const;

  // Read input HTML file
  let inputFileContent = '';
  try {
    const inputFilePath = path.join(state.tempDir, state.filenames.INPUT_FILE);
    inputFileContent = await fs.readFile(inputFilePath, 'utf-8');
  } catch (err) {
    logger.warn(`Could not read input HTML: ${err}`);
  }

  // Prepare initial message with file contents
  const initialMessage = `Start by creating all scripts and processing all input files.

Available file contents:

<input_file>
${inputFileContent || 'File not available'}
</input_file>

Use the provided file content above for analysis. You still have access to write_file and run_js tools for creating and executing scripts.`;

  logger.info('agent: generator msg: Creating extraction scripts');
  logger.info(`generator thread_id: ${generatorThreadId}`);
  await invokeAgent(agentGenerator, initialMessage, generatorConfig);

  while (iterations < MAX_ITERATIONS && !isAccepted) {
    iterations++;
    logger.info(
      `agent: evaluator msg: Validating extraction (iteration ${iterations})`
    );
    logger.info(`evaluator thread_id: ${evaluatorThreadId}`);

    // Read result files for evaluator
    let structureDataContent = '';
    let utilityDataContent = '';
    let layoutDataContent = '';

    try {
      const structurePath = path.join(
        state.tempDir,
        state.filenames.STRUCTURE_DATA
      );
      structureDataContent = await fs.readFile(structurePath, 'utf-8');
    } catch {
      // File may not exist yet
    }

    try {
      const utilityPath = path.join(
        state.tempDir,
        state.filenames.UTILITIES_DATA
      );
      utilityDataContent = await fs.readFile(utilityPath, 'utf-8');
    } catch {
      // File may not exist yet
    }

    try {
      const layoutPath = path.join(state.tempDir, state.filenames.LAYOUT_DATA);
      layoutDataContent = await fs.readFile(layoutPath, 'utf-8');
    } catch {
      // File may not exist yet
    }

    const evalMessage =
      iterations === 1
        ? `Review and evaluate the extraction work. Check if required output files are properly created.

Available file contents for reference:

<input_file>
${inputFileContent || 'File not available'}
</input_file>

${
  structureDataContent
    ? `<structure_data>
${structureDataContent}
</structure_data>`
    : ''
}

${
  utilityDataContent
    ? `<utility_data>
${utilityDataContent}
</utility_data>`
    : ''
}

${
  layoutDataContent
    ? `<layout_data>
${layoutDataContent}
</layout_data>`
    : ''
}`
        : `Your previous comments were addressed. Check problematic files once again. Review and evaluate the extraction work.

Updated output files:

${
  structureDataContent
    ? `<structure_data>
${structureDataContent}
</structure_data>`
    : ''
}

${
  utilityDataContent
    ? `<utility_data>
${utilityDataContent}
</utility_data>`
    : ''
}

${
  layoutDataContent
    ? `<layout_data>
${layoutDataContent}
</layout_data>`
    : ''
}`;

    const evalResult = await invokeAgent(
      agentEvaluator,
      evalMessage,
      evaluatorConfig
    );

    isAccepted = evalResult.includes('STATUS: ACCEPTED');

    if (!isAccepted && iterations < MAX_ITERATIONS) {
      const feedback = extractFeedback(evalResult);
      logger.info(`agent: generator msg: Applying fixes - ${feedback}`);
      logger.info(
        `generator thread_id: ${generatorThreadId} (iteration ${iterations + 1})`
      );

      await invokeAgent(agentGenerator, feedback, generatorConfig);
    }
  }

  // Return updated state
  return {
    attempts: state.attempts + iterations,
    logs: [
      {
        node: 'structureExtraction',
        status: isAccepted ? 'ACCEPTED' : 'MAX_ITERATIONS',
        iterations,
        timestamp: Date.now(),
        message: `Structure extraction completed after ${iterations} iteration(s)`,
      },
    ],
  };
}
