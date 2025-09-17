import path from 'path';
import { promises as fs } from 'fs';
import { AgentState, ChatModel } from '../state.js';
import { logger } from '../../../../utils/logger.js';
import { createMinimalFsTools } from '../helpers/langchain-tools.js';
import { MemorySaver } from '@langchain/langgraph';
import { ensureBaseChatModel, buildAgent, invokeAgent } from '../utils.js';
import { promptRegistry } from '../../prompts/langchain-registry.js';
import { PromptTemplate } from '@langchain/core/prompts';

export async function dataGroupExtractionNode(
  state: AgentState,
  chat: ChatModel
): Promise<Partial<AgentState>> {
  logger.info('node: data_group_extraction msg: Starting data-group driven extraction');

  const tools = createMinimalFsTools(state);
  const llm = ensureBaseChatModel(chat);
  const memory = new MemorySaver();
  const system = await buildSystemPrompt(state);
  const agent = await buildAgent(llm, tools, memory, system);

  const threadId = `data-group-extractor-${Date.now()}`;
  await invokeAgent(agent, 'Begin.', { configurable: { thread_id: threadId } });

  return { attempts: state.attempts + 1 };
}

async function buildSystemPrompt(state: AgentState): Promise<string> {
  const inputFilePath = path.join(state.tempDir, state.filenames.INPUT_FILE);
  const inputHtml = await fs.readFile(inputFilePath, 'utf-8');

  const schemaEntries = Object.entries(state.schemas || {});
  const schemasBlock = schemaEntries
    .map(([name, json]) => `SCHEMA ${name}:
${json}
`)
    .join('\n');

  // Detect the data group CID and title from schemas map
  const CID_RE = /\bbafk[\w]+\b/i;
  let dgCid = '';
  let dgTitle = '';
  for (const [key, json] of schemaEntries) {
    try {
      if (!CID_RE.test(key)) continue;
      const obj = JSON.parse(json);
      const props = obj?.properties;
      if (
        obj?.type === 'object' &&
        props &&
        typeof props === 'object' &&
        'label' in props &&
        'relationships' in props
      ) {
        dgCid = key;
        dgTitle = typeof obj?.title === 'string' ? obj.title : '';
        break;
      }
    } catch {}
  }

  const dataDir = state.filenames.DATA_DIR;
  const tpl = await promptRegistry.getPromptTemplate('data-group-extractor');
  const rendered = await tpl.format({
    input_file: state.filenames.INPUT_FILE,
    input_html: inputHtml,
    data_dir: dataDir,
    schemas_block: schemasBlock,
    data_group_cid: dgCid,
    data_group_title: dgTitle,
  } as Record<string, unknown>);
  return rendered;
}


