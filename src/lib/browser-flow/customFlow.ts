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

const selectorRaceOptionSchema = z.object({
  selector: z.string().min(1),
  label: z.string().min(1),
  timeout: z.number().optional(),
});

const waitForSelectorRaceInputSchema = z.object({
  selectors: z.array(selectorRaceOptionSchema).min(1),
  visible: z.boolean().optional(),
  iframe_selector: z.string().optional(),
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
  continue_on_timeout: z.boolean().optional(),
  next_on_timeout: z.string().optional(),
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

const waitForSelectorRaceNodeSchema = z.object({
  type: z.literal('wait_for_selector_race'),
  input: waitForSelectorRaceInputSchema,
  next_map: z.record(z.string()),
  validate_winner: z
    .record(
      z.object({
        check_selector: z.string().min(1),
        if_exists_goto: z.string().min(1),
      })
    )
    .optional(),
  result: z.string().optional(),
  end: z.boolean().optional(),
});

const nodeSchema = z.discriminatedUnion('type', [
  openPageNodeSchema,
  waitForSelectorNodeSchema,
  waitForSelectorRaceNodeSchema,
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
  states: Record<
    string,
    {
      next?: string;
      next_on_timeout?: string;
      next_map?: Record<string, string>;
      validate_winner?: Record<string, { if_exists_goto: string }>;
    }
  >;
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

    if (node.next_on_timeout && !stateNames.includes(node.next_on_timeout)) {
      errors.push(
        `State "${stateName}": next_on_timeout references unknown state "${node.next_on_timeout}"`
      );
    }

    if (node.next_map) {
      for (const [label, targetState] of Object.entries(node.next_map)) {
        if (!stateNames.includes(targetState)) {
          errors.push(
            `State "${stateName}": next_map["${label}"] references unknown state "${targetState}"`
          );
        }
      }
    }

    if (node.validate_winner) {
      for (const [label, config] of Object.entries(node.validate_winner)) {
        if (!stateNames.includes(config.if_exists_goto)) {
          errors.push(
            `State "${stateName}": validate_winner["${label}"].if_exists_goto references unknown state "${config.if_exists_goto}"`
          );
        }
      }
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
