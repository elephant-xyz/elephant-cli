import { promises as fs } from 'fs';
import { Workflow } from '../withBrowserFlow.js';
import { logger } from '../../utils/logger.js';

export interface CustomFlowValidationResult {
  valid: boolean;
  errors?: string[];
}

function isValidWaitUntil(value: unknown): boolean {
  const validValues = [
    'load',
    'domcontentloaded',
    'networkidle0',
    'networkidle2',
  ];
  return typeof value === 'string' && validValues.includes(value);
}

function isValidNodeType(value: unknown): boolean {
  const validTypes = [
    'open_page',
    'wait_for_selector',
    'click',
    'type',
    'keyboard_press',
  ];
  return typeof value === 'string' && validTypes.includes(value);
}

function validateOpenPageInput(input: unknown): string[] {
  const errors: string[] = [];
  if (!input || typeof input !== 'object') {
    errors.push('open_page input must be an object');
    return errors;
  }

  const inputObj = input as Record<string, unknown>;

  if (typeof inputObj.url !== 'string' || inputObj.url.length === 0) {
    errors.push('open_page input.url must be a non-empty string');
  }

  if (inputObj.timeout !== undefined && typeof inputObj.timeout !== 'number') {
    errors.push('open_page input.timeout must be a number');
  }

  if (
    inputObj.wait_until !== undefined &&
    !isValidWaitUntil(inputObj.wait_until)
  ) {
    errors.push(
      'open_page input.wait_until must be one of: load, domcontentloaded, networkidle0, networkidle2'
    );
  }

  return errors;
}

function validateWaitForSelectorInput(input: unknown): string[] {
  const errors: string[] = [];
  if (!input || typeof input !== 'object') {
    errors.push('wait_for_selector input must be an object');
    return errors;
  }

  const inputObj = input as Record<string, unknown>;

  if (typeof inputObj.selector !== 'string' || inputObj.selector.length === 0) {
    errors.push('wait_for_selector input.selector must be a non-empty string');
  }

  if (inputObj.timeout !== undefined && typeof inputObj.timeout !== 'number') {
    errors.push('wait_for_selector input.timeout must be a number');
  }

  if (inputObj.visible !== undefined && typeof inputObj.visible !== 'boolean') {
    errors.push('wait_for_selector input.visible must be a boolean');
  }

  if (
    inputObj.iframe_selector !== undefined &&
    typeof inputObj.iframe_selector !== 'string'
  ) {
    errors.push('wait_for_selector input.iframe_selector must be a string');
  }

  return errors;
}

function validateClickInput(input: unknown): string[] {
  const errors: string[] = [];
  if (!input || typeof input !== 'object') {
    errors.push('click input must be an object');
    return errors;
  }

  const inputObj = input as Record<string, unknown>;

  if (typeof inputObj.selector !== 'string' || inputObj.selector.length === 0) {
    errors.push('click input.selector must be a non-empty string');
  }

  if (
    inputObj.iframe_selector !== undefined &&
    typeof inputObj.iframe_selector !== 'string'
  ) {
    errors.push('click input.iframe_selector must be a string');
  }

  return errors;
}

function validateTypeInput(input: unknown): string[] {
  const errors: string[] = [];
  if (!input || typeof input !== 'object') {
    errors.push('type input must be an object');
    return errors;
  }

  const inputObj = input as Record<string, unknown>;

  if (typeof inputObj.selector !== 'string' || inputObj.selector.length === 0) {
    errors.push('type input.selector must be a non-empty string');
  }

  if (typeof inputObj.value !== 'string') {
    errors.push('type input.value must be a string');
  }

  if (inputObj.delay !== undefined && typeof inputObj.delay !== 'number') {
    errors.push('type input.delay must be a number');
  }

  if (
    inputObj.iframe_selector !== undefined &&
    typeof inputObj.iframe_selector !== 'string'
  ) {
    errors.push('type input.iframe_selector must be a string');
  }

  return errors;
}

function validateKeyboardPressInput(input: unknown): string[] {
  const errors: string[] = [];
  if (!input || typeof input !== 'object') {
    errors.push('keyboard_press input must be an object');
    return errors;
  }

  const inputObj = input as Record<string, unknown>;

  if (typeof inputObj.key !== 'string' || inputObj.key.length === 0) {
    errors.push('keyboard_press input.key must be a non-empty string');
  }

  return errors;
}

function validateNode(
  stateName: string,
  node: unknown,
  allStateNames: string[]
): string[] {
  const errors: string[] = [];

  if (!node || typeof node !== 'object') {
    errors.push(`State "${stateName}": node must be an object`);
    return errors;
  }

  const nodeObj = node as Record<string, unknown>;

  if (!isValidNodeType(nodeObj.type)) {
    errors.push(
      `type must be one of: open_page, wait_for_selector, click, type, keyboard_press`
    );
    return errors;
  }

  if (!nodeObj.input) {
    errors.push(`input is required`);
  }

  const type = nodeObj.type as string;
  switch (type) {
    case 'open_page':
      errors.push(...validateOpenPageInput(nodeObj.input));
      break;
    case 'wait_for_selector':
      errors.push(...validateWaitForSelectorInput(nodeObj.input));
      break;
    case 'click':
      errors.push(...validateClickInput(nodeObj.input));
      break;
    case 'type':
      errors.push(...validateTypeInput(nodeObj.input));
      break;
    case 'keyboard_press':
      errors.push(...validateKeyboardPressInput(nodeObj.input));
      break;
  }

  if (nodeObj.next !== undefined) {
    if (typeof nodeObj.next !== 'string') {
      errors.push(`next must be a string`);
    }
    if (
      typeof nodeObj.next === 'string' &&
      !allStateNames.includes(nodeObj.next)
    ) {
      errors.push(`next references unknown state "${nodeObj.next}"`);
    }
  }

  if (nodeObj.result !== undefined && typeof nodeObj.result !== 'string') {
    errors.push(`result must be a string`);
  }

  if (nodeObj.end !== undefined && typeof nodeObj.end !== 'boolean') {
    errors.push(`end must be a boolean`);
  }

  return errors;
}

function validateCaptureConfig(capture: unknown): string[] {
  const errors: string[] = [];

  if (!capture) return errors;

  if (typeof capture !== 'object') {
    errors.push('capture must be an object');
    return errors;
  }

  const captureObj = capture as Record<string, unknown>;

  if (typeof captureObj.type !== 'string') {
    errors.push('capture.type must be a string');
    return errors;
  }

  if (captureObj.type !== 'page' && captureObj.type !== 'iframe') {
    errors.push('capture.type must be either "page" or "iframe"');
  }

  if (captureObj.type === 'iframe') {
    if (
      typeof captureObj.selector !== 'string' ||
      captureObj.selector.length === 0
    ) {
      errors.push(
        'capture.selector must be a non-empty string when type is "iframe"'
      );
    }
  }

  return errors;
}

export function validateCustomFlow(
  workflow: unknown
): CustomFlowValidationResult {
  const errors: string[] = [];

  if (!workflow || typeof workflow !== 'object') {
    return {
      valid: false,
      errors: ['Workflow must be an object'],
    };
  }

  const workflowObj = workflow as Record<string, unknown>;

  if (typeof workflowObj.starts_at !== 'string') {
    errors.push('starts_at must be a string');
  }

  if (!workflowObj.states || typeof workflowObj.states !== 'object') {
    errors.push('states must be an object');
    return { valid: false, errors };
  }

  const states = workflowObj.states as Record<string, unknown>;
  const stateNames = Object.keys(states);

  if (stateNames.length === 0) {
    errors.push('states must contain at least one state');
  }

  if (
    typeof workflowObj.starts_at === 'string' &&
    !stateNames.includes(workflowObj.starts_at)
  ) {
    errors.push(
      `starts_at references unknown state "${workflowObj.starts_at}"`
    );
  }

  for (const [stateName, node] of Object.entries(states)) {
    const nodeErrors = validateNode(stateName, node, stateNames);
    errors.push(...nodeErrors.map((err) => `State "${stateName}": ${err}`));
  }

  if (workflowObj.capture !== undefined) {
    errors.push(...validateCaptureConfig(workflowObj.capture));
  }

  return {
    valid: errors.length === 0,
    errors: errors.length > 0 ? errors : undefined,
  };
}

export async function loadCustomFlow(filePath: string): Promise<Workflow> {
  logger.info(`Loading custom browser flow from: ${filePath}`);

  const content = await fs.readFile(filePath, 'utf-8');
  const workflow: unknown = JSON.parse(content);

  const validation = validateCustomFlow(workflow);
  if (!validation.valid) {
    logger.error('Custom browser flow validation failed:');
    validation.errors?.forEach((error) => logger.error(`  - ${error}`));
    throw new Error('Invalid custom browser flow definition');
  }

  logger.info('Custom browser flow loaded and validated successfully');
  return workflow as Workflow;
}
