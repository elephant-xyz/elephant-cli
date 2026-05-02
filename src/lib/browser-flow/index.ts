import { Workflow } from '../withBrowserFlow.js';
import { getTemplate, listTemplates } from './templates/index.js';
import { validateParameters, parseParameters } from './validator.js';
import { logger } from '../../utils/logger.js';
import { BrowserFlowParameters } from './types.js';
import { validateCustomFlow } from './customFlow.js';

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

  const workflow = template.createWorkflow(
    params as BrowserFlowParameters,
    context
  );
  const workflowValidation = validateCustomFlow(workflow);
  if (!workflowValidation.valid) {
    logger.error('Generated browser flow validation failed:');
    workflowValidation.errors?.forEach((error) => logger.error(`  - ${error}`));
    return null;
  }

  return workflow;
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
