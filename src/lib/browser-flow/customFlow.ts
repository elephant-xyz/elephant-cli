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

const captureConfigSchema = z.union([
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

      // Top-level type errors
      if (issue.code === 'invalid_type' && !path) {
        return 'Workflow must be an object';
      }

      // Missing required fields at top level
      if (
        issue.code === 'invalid_type' &&
        issue.received === 'undefined' &&
        (path === 'starts_at' || path === 'states')
      ) {
        return `${path} must be ${path === 'starts_at' ? 'a string' : 'an object'}`;
      }

      // State-level validation errors
      if (path.startsWith('states.')) {
        const pathParts = issue.path;
        const stateName = pathParts[1] as string;

        if (issue.code === 'invalid_union_discriminator') {
          return `State "${stateName}": type must be one of: open_page, wait_for_selector, click, type, keyboard_press`;
        }

        // Input field validation
        if (pathParts.length >= 4 && pathParts[2] === 'input') {
          const fieldName = pathParts[3];

          if (issue.code === 'too_small' && issue.type === 'string') {
            return `State "${stateName}": ${fieldName} must be a non-empty string`;
          }

          // Check if field has min length requirement in schema
          if (issue.code === 'invalid_type' && issue.expected === 'string') {
            // Fields like 'selector' and 'key' have .min(1), so use non-empty
            // Fields like 'value' don't have .min(1), so just use 'string'
            const fieldsWithMinLength = ['selector', 'key'];
            if (fieldsWithMinLength.includes(fieldName as string)) {
              return `State "${stateName}": ${fieldName} must be a non-empty string`;
            }
            return `State "${stateName}": ${fieldName} must be a ${issue.expected}`;
          }

          if (issue.code === 'invalid_type') {
            return `State "${stateName}": ${fieldName} must be a ${issue.expected}`;
          }
        }

        // Node-level validation
        if (
          issue.code === 'invalid_type' &&
          issue.received === 'undefined' &&
          pathParts.length === 3
        ) {
          return `State "${stateName}": ${pathParts[2]} is required`;
        }

        if (issue.code === 'invalid_type' && pathParts.length === 3) {
          return `State "${stateName}": ${pathParts[2]} must be a ${issue.expected}`;
        }
      }

      // Capture config validation
      if (path === 'capture' || path.startsWith('capture.')) {
        if (issue.code === 'invalid_union') {
          // Check unionErrors for missing selector in iframe type
          const zodIssue = issue as any;
          if (zodIssue.unionErrors) {
            // Check if the actual type value is 'iframe'
            const workflowObj = workflow as any;
            const captureType = workflowObj?.capture?.type;

            const hasMissingSelectorError = zodIssue.unionErrors.some(
              (unionErr: any) =>
                unionErr.issues?.some(
                  (innerIssue: any) =>
                    innerIssue.path.length >= 2 &&
                    innerIssue.path[0] === 'capture' &&
                    innerIssue.path[1] === 'selector' &&
                    innerIssue.code === 'invalid_type' &&
                    innerIssue.received === 'undefined'
                )
            );

            // Only report missing selector if type is actually 'iframe'
            if (hasMissingSelectorError && captureType === 'iframe') {
              return 'capture.selector must be a non-empty string when type is "iframe"';
            }
          }
          return 'capture.type must be either "page" or "iframe"';
        }

        if (
          issue.code === 'invalid_type' &&
          issue.received === 'undefined' &&
          path === 'capture.selector'
        ) {
          return 'capture.selector must be a non-empty string when type is "iframe"';
        }

        if (issue.code === 'too_small' && path === 'capture.selector') {
          return 'capture.selector must be a non-empty string when type is "iframe"';
        }
      }

      // Generic type validation
      if (issue.code === 'invalid_type' && issue.received === 'undefined') {
        return `${path} is required`;
      }

      if (issue.code === 'too_small' && issue.type === 'string') {
        return `${path} must be a non-empty string`;
      }

      if (issue.code === 'invalid_type') {
        return `${path} must be a ${issue.expected}`;
      }

      if (issue.code === 'invalid_enum_value') {
        const options = issue.options.join(', ');
        return `${path} must be one of: ${options}`;
      }

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
