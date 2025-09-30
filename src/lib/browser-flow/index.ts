import { Workflow } from '../withBrowserFlow.js';
import { getTemplate, listTemplates } from './templates/index.js';
import { validateParameters, parseParameters } from './validator.js';
import { logger } from '../../utils/logger.js';
import { BrowserFlowParameters } from './types.js';

export interface BrowserFlowOptions {
  template?: string;
  parameters?: string;
}

export function createWorkflowFromTemplate(
  templateId: string,
  parametersJson: string,
  context: { requestId: string; url: string }
): Workflow | null {
  const template = getTemplate(templateId);
  if (!template) {
    logger.error(`Template not found: ${templateId}`);
    logger.info(`Available templates: ${listTemplates().join(', ')}`);
    return null;
  }

  const params = parseParameters(parametersJson);
  if (!params) {
    logger.error('Invalid parameters JSON format');
    return null;
  }

  const validation = validateParameters(template, params);
  if (!validation.valid) {
    logger.error('Parameter validation failed:');
    validation.errors?.forEach((error) => logger.error(`  - ${error}`));
    return null;
  }

  logger.info(`Using browser flow template: ${templateId}`);
  logger.debug(`Template parameters: ${JSON.stringify(params)}`);
  logger.debug(`Context URL: ${context.url}`);

  const compiledWorkflow = template.createWorkflow(
    params as BrowserFlowParameters,
    context
  );
  const propertSelector =
    '#wrapper > table > tbody > tr > td > div > table > tbody > tr:nth-child(2) > td > table > tbody > tr:nth-child(1) > td > table.resultstable > tbody > tr.hv > td:nth-child(2)';
  compiledWorkflow.states.wait_for_search_results.end = false;
  compiledWorkflow.states.wait_for_search_results.input = {
    selector: propertSelector,
  };
  compiledWorkflow.states.wait_for_search_results.next = 'wait_for_property';
  compiledWorkflow.states.wait_for_property = {
    type: 'wait_for_selector',
    input: {
      selector: propertSelector,
      timeout: 60000,
      visible: true,
    },
    next: 'click_property_button',
  };
  compiledWorkflow.states.click_property_button = {
    type: 'click',
    input: {
      selector: propertSelector,
    },
    next: 'wait_for_property_details_mykyta',
  };
  compiledWorkflow.states.wait_for_property_details_mykyta = {
    type: 'wait_for_selector',
    input: {
      selector: '#ownerDiv',
      timeout: 60000,
      visible: true,
    },
    end: true,
  };
  return compiledWorkflow;
}

export { getTemplate, listTemplates } from './templates/index.js';
export { validateParameters, parseParameters } from './validator.js';
export type {
  BrowserFlowTemplate,
  BrowserFlowParameters,
  BrowserFlowContext,
  ValidationResult,
  ParametersSchema,
  ParameterDefinition,
} from './types.js';
