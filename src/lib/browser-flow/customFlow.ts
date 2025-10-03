import { promises as fs } from 'fs';
import { z } from 'zod';
import { Workflow } from '../withBrowserFlow.js';
import { logger } from '../../utils/logger.js';

export interface CustomFlowValidationResult {
  valid: boolean;
  errors?: string[];
}

const waitUntilSchema = z.enum([
  'load',
  'domcontentloaded',
  'networkidle0',
  'networkidle2',
]);

const openPageInputSchema = z.object({
  url: z.string().min(1),
  timeout: z.number().optional(),
  wait_until: waitUntilSchema.optional(),
});

const waitForSelectorInputSchema = z.object({
  selector: z.string().min(1),
  timeout: z.number().optional(),
  visible: z.boolean().optional(),
  iframe_selector: z.string().optional(),
});

const clickInputSchema = z.object({
  selector: z.string().min(1),
  iframe_selector: z.string().optional(),
});

const typeInputSchema = z.object({
  selector: z.string().min(1),
  value: z.string(),
  delay: z.number().optional(),
  iframe_selector: z.string().optional(),
  clear: z.boolean().optional(),
});

const keyboardPressInputSchema = z.object({
  key: z.string().min(1),
});

const baseNodeSchema = z.object({
  next: z.string().optional(),
  result: z.string().optional(),
  end: z.boolean().optional(),
});

const openPageNodeSchema = baseNodeSchema.extend({
  type: z.literal('open_page'),
  input: openPageInputSchema,
});

const waitForSelectorNodeSchema = baseNodeSchema.extend({
  type: z.literal('wait_for_selector'),
  input: waitForSelectorInputSchema,
});

const clickNodeSchema = baseNodeSchema.extend({
  type: z.literal('click'),
  input: clickInputSchema,
});

const typeNodeSchema = baseNodeSchema.extend({
  type: z.literal('type'),
  input: typeInputSchema,
});

const keyboardPressNodeSchema = baseNodeSchema.extend({
  type: z.literal('keyboard_press'),
  input: keyboardPressInputSchema,
});

const nodeSchema = z.discriminatedUnion('type', [
  openPageNodeSchema,
  waitForSelectorNodeSchema,
  clickNodeSchema,
  typeNodeSchema,
  keyboardPressNodeSchema,
]);

const captureConfigSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('page') }),
  z.object({ type: z.literal('iframe'), selector: z.string().min(1) }),
]);

const workflowSchema = z.object({
  starts_at: z.string(),
  states: z.record(nodeSchema),
  capture: captureConfigSchema.optional(),
});

function validateStateReferences(workflow: {
  starts_at: string;
  states: Record<string, { next?: string }>;
}): string[] {
  const errors: string[] = [];
  const stateNames = Object.keys(workflow.states);

  if (stateNames.length === 0) {
    errors.push('states must contain at least one state');
  }

  if (!stateNames.includes(workflow.starts_at)) {
    errors.push(`starts_at references unknown state "${workflow.starts_at}"`);
  }

  for (const [stateName, node] of Object.entries(workflow.states)) {
    if (node.next && !stateNames.includes(node.next)) {
      errors.push(
        `State "${stateName}": next references unknown state "${node.next}"`
      );
    }
  }

  return errors;
}

export function validateCustomFlow(
  workflow: unknown
): CustomFlowValidationResult {
  const result = workflowSchema.safeParse(workflow);

  if (!result.success) {
    const errors = result.error.issues.map((issue) => {
      const path = issue.path.join('.');
      if (path) return `${path}: ${issue.message}`;
      return issue.message;
    });

    return { valid: false, errors };
  }

  const referenceErrors = validateStateReferences(result.data);
  if (referenceErrors.length > 0) {
    return { valid: false, errors: referenceErrors };
  }

  return { valid: true };
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
