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

const captureConfigV2Schema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('page') }).strict(),
  z.object({ type: z.literal('iframe'), selector: z.string().min(1) }).strict(),
]);

const captureHtmlInputV2Schema = z
  .object({
    name: z
      .string()
      .regex(
        /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
        'capture name must be lowercase kebab-case'
      )
      .refine((name) => name !== 'default', {
        message: 'capture name "default" is reserved',
      }),
    target: captureConfigV2Schema.optional(),
  })
  .strict();

const captureSourceUrlInputV2Schema = z
  .object({
    target: captureConfigV2Schema.optional(),
  })
  .strict();

const v2BaseNodeSchema = z
  .object({
    next: z.string().optional(),
    result: z.string().optional(),
    end: z.boolean().optional(),
  })
  .strict();

const openPageNodeV2Schema = v2BaseNodeSchema.extend({
  type: z.literal('open_page'),
  input: openPageInputSchema.strict(),
});

const waitForSelectorNodeV2Schema = v2BaseNodeSchema.extend({
  type: z.literal('wait_for_selector'),
  input: waitForSelectorInputSchema.strict(),
  continue_on_timeout: z.boolean().optional(),
  next_on_timeout: z.string().optional(),
});

const clickNodeV2Schema = v2BaseNodeSchema.extend({
  type: z.literal('click'),
  input: clickInputSchema.strict(),
});

const typeNodeV2Schema = v2BaseNodeSchema.extend({
  type: z.literal('type'),
  input: typeInputSchema.strict(),
});

const keyboardPressNodeV2Schema = v2BaseNodeSchema.extend({
  type: z.literal('keyboard_press'),
  input: keyboardPressInputSchema.strict(),
});

const waitForSelectorRaceNodeV2Schema = z
  .object({
    type: z.literal('wait_for_selector_race'),
    input: waitForSelectorRaceInputSchema.strict(),
    next_map: z.record(z.string()),
    validate_winner: z
      .record(
        z
          .object({
            check_selector: z.string().min(1),
            if_exists_goto: z.string().min(1),
          })
          .strict()
      )
      .optional(),
    result: z.string().optional(),
    end: z.boolean().optional(),
  })
  .strict();

const captureHtmlNodeV2Schema = z
  .object({
    type: z.literal('capture_html'),
    input: captureHtmlInputV2Schema,
    next: z.string().optional(),
    end: z.boolean().optional(),
  })
  .strict();

const captureSourceUrlNodeV2Schema = z
  .object({
    type: z.literal('capture_source_url'),
    input: captureSourceUrlInputV2Schema,
    next: z.string().optional(),
    end: z.boolean().optional(),
  })
  .strict();

const nodeV2Schema = z.discriminatedUnion('type', [
  openPageNodeV2Schema,
  waitForSelectorNodeV2Schema,
  waitForSelectorRaceNodeV2Schema,
  clickNodeV2Schema,
  typeNodeV2Schema,
  keyboardPressNodeV2Schema,
  captureHtmlNodeV2Schema,
  captureSourceUrlNodeV2Schema,
]);

const workflowV1Schema = z.object({
  version: z.literal(1).optional(),
  starts_at: z.string(),
  states: z.record(nodeSchema),
  capture: captureConfigSchema.optional(),
});

const workflowV2Schema = z
  .object({
    version: z.literal(2),
    starts_at: z.string(),
    states: z.record(nodeV2Schema),
  })
  .strict();

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
  const versionResult = z
    .object({ version: z.union([z.literal(1), z.literal(2)]).optional() })
    .passthrough()
    .safeParse(workflow);

  if (!versionResult.success) {
    return {
      valid: false,
      errors: versionResult.error.issues.map((issue) => {
        const path = issue.path.join('.');
        if (path) return `${path}: ${issue.message}`;
        return issue.message;
      }),
    };
  }

  const version = versionResult.data.version ?? 1;
  const result = (
    version === 2 ? workflowV2Schema : workflowV1Schema
  ).safeParse(workflow);

  if (!result.success) {
    const errors = result.error.issues.map((issue) => {
      const path = issue.path.join('.');
      if (path) return `${path}: ${issue.message}`;
      return issue.message;
    });

    return { valid: false, errors };
  }

  const referenceErrors = validateStateReferences(result.data);
  const captureErrors =
    version === 2 ? validateV2CaptureRules(result.data) : [];
  const errors = [...referenceErrors, ...captureErrors];
  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true };
}

function validateV2CaptureRules(workflow: {
  states: Record<string, { type: string; input?: unknown }>;
}): string[] {
  const errors: string[] = [];
  const captureStates = Object.entries(workflow.states).filter(
    ([, state]) => state.type === 'capture_html'
  );
  const sourceStates = Object.entries(workflow.states).filter(
    ([, state]) => state.type === 'capture_source_url'
  );
  const names = new Map<string, string>();

  for (const [stateName, state] of captureStates) {
    const input = state.input as { name?: string } | undefined;
    const name = input?.name;
    if (!name) continue;
    const existing = names.get(name);
    if (existing) {
      errors.push(
        `Duplicate capture name "${name}" used by states "${existing}" and "${stateName}"`
      );
    }
    names.set(name, stateName);
  }

  if (sourceStates.length > 1) {
    errors.push(
      `Workflow version 2 must contain at most one capture_source_url state, found [${sourceStates.map(([name]) => `"${name}"`).join(', ')}]`
    );
  }

  if (captureStates.length > 0 && sourceStates.length === 0) {
    errors.push(
      `Workflow version 2 has capture_html states [${captureStates.map(([name]) => `"${name}"`).join(', ')}] but no capture_source_url state`
    );
  }

  return errors;
}

export async function loadCustomFlow(filePath: string): Promise<Workflow> {
  logger.info(`Loading custom browser flow from: ${filePath}`);

  const content = await fs.readFile(filePath, 'utf-8');
  const workflow: unknown = JSON.parse(content);

  const validation = validateCustomFlow(workflow);
  if (!validation.valid) {
    logger.error('Custom browser flow validation failed:');
    validation.errors?.forEach((error) => logger.error(`  - ${error}`));
    throw new Error(
      `Invalid custom browser flow definition: ${validation.errors?.join('; ')}`
    );
  }

  logger.info('Custom browser flow loaded and validated successfully');
  return workflow as Workflow;
}
