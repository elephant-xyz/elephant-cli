import path from 'path';
import { promises as fs } from 'fs';
import { AgentState, ChatModel } from '../state.js';
import { logger } from '../../../../utils/logger.js';
import { createMinimalFsTools } from '../helpers/langchain-tools.js';
import { promptRegistry } from '../../prompts/langchain-registry.js';
import { MemorySaver } from '@langchain/langgraph';
import { PromptTemplate } from '@langchain/core/prompts';
import {
  MAX_ITERATIONS,
  formatPrompt,
  ensureBaseChatModel,
  buildAgent,
  invokeAgent,
  extractFeedback,
} from '../utils.js';

/**
 * Main extraction node with multi-agent conversation
 */
export async function extractionNode(
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
    property_schema: state.schemas?.property,
    address_schema: state.schemas?.address,
    lot_schema: state.schemas?.lot,
    tax_schema: state.schemas?.tax,
    flood_schema: state.schemas?.flood_storm_information,
    sales_history: state.schemas?.sales_history,
    person_schema: state.schemas?.person,
    company_schema: state.schemas?.company,
    deed_schema: state.schemas?.deed,
    file_schema: state.schemas?.file,
    // Add filename variables
    input_file: state.filenames.INPUT_FILE,
    address_file: state.filenames.ADDRESS,
    parcel_file: state.filenames.PARCEL,
    utilities_data_file: state.filenames.UTILITIES_DATA,
    layout_data_file: state.filenames.LAYOUT_DATA,
    data_extractor_script: state.filenames.DATA_EXTRACTOR_SCRIPT,
    data_dir: state.filenames.DATA_DIR,
    owner_data_file: state.filenames.OWNER_DATA,
    deed_data_file: state.filenames.OUTPUT_DEED_PREFIX,
    data_dictionary: state.dataDictionaryContent || '',
  };

  logger.info(
    `schemas available: ${Object.keys(state.schemas || {}).join(', ')}`
  );

  // Create separate thread IDs for each agent to maintain independent conversation histories
  const sessionId = Date.now();
  const generatorThreadId = `extraction-generator-${sessionId}`;
  const evaluatorThreadId = `extraction-evaluator-${sessionId}`;

  // Create separate memory instances for each agent
  // This ensures that generator and evaluator maintain independent conversation contexts
  const generatorMemory = new MemorySaver();
  const evaluatorMemory = new MemorySaver();

  promptRegistry.clearCache();

  const generatorTemplate = await promptRegistry.getPromptTemplate(
    'extraction-generator'
  );
  const generatorSystem = await formatPrompt(
    generatorTemplate as unknown as PromptTemplate,
    templateVars
  );

  const evaluatorTemplate = await promptRegistry.getPromptTemplate(
    'extraction-evaluator'
  );
  const evaluatorSystem = await formatPrompt(
    evaluatorTemplate as unknown as PromptTemplate,
    templateVars
  );

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
    tools,
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

  let inputFileContent = '';
  let addressContent = '';
  let parcelContent = '';

  const inputFilePath = path.join(state.tempDir, state.filenames.INPUT_FILE);
  inputFileContent = await fs.readFile(inputFilePath, 'utf-8');

  const addressPath = path.join(state.tempDir, state.filenames.ADDRESS);
  addressContent = await fs.readFile(addressPath, 'utf-8');

  const parcelPath = path.join(state.tempDir, state.filenames.PARCEL);
  parcelContent = await fs.readFile(parcelPath, 'utf-8');

  let utilitiesDataContent = '';
  let layoutDataContent = '';
  let ownerDataContent = '';
  let structureDataContent = '';

  try {
    const utilitiesDataPath = path.join(
      state.tempDir,
      state.filenames.UTILITIES_DATA
    );
    utilitiesDataContent = await fs.readFile(utilitiesDataPath, 'utf-8');
  } catch (error) {
    logger.warn(
      `Utilities data file not found: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  try {
    const layoutDataPath = path.join(
      state.tempDir,
      state.filenames.LAYOUT_DATA
    );
    layoutDataContent = await fs.readFile(layoutDataPath, 'utf-8');
  } catch (error) {
    logger.warn(
      `Layout data file not found: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  try {
    ownerDataContent = await fs.readFile(
      path.join(state.tempDir, state.filenames.OWNER_DATA),
      'utf-8'
    );
  } catch (error) {
    logger.warn(
      `Owner data file not found: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  try {
    structureDataContent = await fs.readFile(
      path.join(state.tempDir, state.filenames.STRUCTURE_DATA),
      'utf-8'
    );
  } catch (error) {
    logger.warn(
      `Structure data file not found: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  // Prepare initial message with all file contents
  const initialMessage = `Start by creating the extraction script and processing all input files. Make sure to extract all sales-taxes-owners data.

Available file contents:

<input_file>
${inputFileContent || 'File not available'}
</input_file>

<address>
${addressContent || 'File not available'}
</address>

<parcel>
${parcelContent || 'File not available'}
</parcel>


${
  utilitiesDataContent
    ? `<utilities_data>
${utilitiesDataContent}
</utilities_data>`
    : ''
}

${
  layoutDataContent
    ? `<layout_data>
${layoutDataContent}
</layout_data>`
    : ''
}

${
  structureDataContent
    ? `<structure_data>
${structureDataContent}
</structure_data>`
    : ''
}

<owner_data>
${ownerDataContent || 'File not available'}
</owner_data>
Use the provided file contents above for analysis. You still have access to write_file and run_js tools for creating and executing scripts.`;

  logger.info('agent: generator msg: Creating extraction scripts');
  logger.info(`generator thread_id: ${generatorThreadId}`);
  await invokeAgent(agentGenerator, initialMessage, generatorConfig);

  while (iterations < MAX_ITERATIONS && !isAccepted) {
    iterations++;
    logger.info(
      `agent: evaluator msg: Validating extraction (iteration ${iterations})`
    );
    logger.info(`evaluator thread_id: ${evaluatorThreadId}`);

    // Read all files from the data directory for evaluator
    const dataFiles: Record<string, string> = {};
    const dataDir = path.join(state.tempDir, state.filenames.DATA_DIR);

    try {
      const files = await fs.readdir(dataDir);
      // Read all JSON files from the data directory
      for (const file of files) {
        if (file.endsWith('.json')) {
          try {
            const filePath = path.join(dataDir, file);
            const content = await fs.readFile(filePath, 'utf-8');
            dataFiles[file] = content;
          } catch (err) {
            logger.warn(`Could not read ${file}: ${err}`);
          }
        }
      }
    } catch (err) {
      logger.warn(`Could not read data directory: ${err}`);
    }

    const evalMessage =
      iterations === 1
        ? `Review and evaluate the extraction work. Check if all required output files are properly created.

Available input file contents:

<input_file>
${inputFileContent || 'File not available'}
</input_file>

<address>
${addressContent || 'File not available'}
</address>

<parcel>
${parcelContent || 'File not available'}
</parcel>

${
  utilitiesDataContent
    ? `<utilities_data>
${utilitiesDataContent}
</utilities_data>`
    : ''
}

${
  layoutDataContent
    ? `<layout_data>
${layoutDataContent}
</layout_data>`
    : ''
}

Read output files from ${state.filenames.DATA_DIR}:
`
        : `Your previous comments were addressed. Check problematic files once again. Review and evaluate the extraction work.

Use \`read_file\` to check updated output files from ${state.filenames.DATA_DIR}:
`;

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
