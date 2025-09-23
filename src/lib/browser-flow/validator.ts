import { z } from 'zod';
import { BrowserFlowTemplate, ValidationResult } from './types.js';

// Create Zod schema for the SEARCH_BY_PARCEL_ID template
const searchByParcelIdSchema = z.object({
  continue_button_selector: z.string().min(1).optional(),
  search_form_selector: z.string().min(1),
  search_result_selector: z.string().min(1),
});

// Map template IDs to their Zod schemas
const templateSchemas: Record<string, z.ZodSchema> = {
  SEARCH_BY_PARCEL_ID: searchByParcelIdSchema,
};

// Create a dynamic schema from the template's parametersSchema definition
// This is used for backwards compatibility with tests
function createDynamicSchema(template: BrowserFlowTemplate): z.ZodSchema {
  const shape: Record<string, z.ZodTypeAny> = {};
  const { properties, required } = template.parametersSchema;

  for (const [key, def] of Object.entries(properties)) {
    let fieldSchema: z.ZodTypeAny;

    switch (def.type) {
      case 'string':
        fieldSchema = z.string();
        if (def.minLength)
          fieldSchema = (fieldSchema as z.ZodString).min(def.minLength);
        if (def.maxLength)
          fieldSchema = (fieldSchema as z.ZodString).max(def.maxLength);
        if (def.pattern)
          fieldSchema = (fieldSchema as z.ZodString).regex(
            new RegExp(def.pattern)
          );
        break;
      case 'number':
        fieldSchema = z.number();
        break;
      case 'boolean':
        fieldSchema = z.boolean();
        break;
      default:
        fieldSchema = z.unknown();
    }

    // Make optional if not required
    if (!required.includes(key)) {
      fieldSchema = fieldSchema.optional();
    }

    shape[key] = fieldSchema;
  }

  return z.object(shape).strict(); // strict to detect unknown parameters
}

export function validateParameters(
  template: BrowserFlowTemplate,
  params: unknown
): ValidationResult {
  // Use predefined schema if available, otherwise create dynamic schema
  const schema = templateSchemas[template.id] || createDynamicSchema(template);

  const result = schema.safeParse(params);

  if (result.success) {
    return {
      valid: true,
    };
  }

  // Convert Zod errors to string array matching expected format
  const errors = result.error.issues.map((issue) => {
    // Handle required field errors
    if (issue.code === 'invalid_type' && issue.received === 'undefined') {
      const fieldName = issue.path[0];
      return `Missing required parameter: ${fieldName}`;
    }

    // Handle type mismatch errors
    if (issue.code === 'invalid_type') {
      const fieldName = issue.path[0];
      const expectedType = issue.expected;
      return `Parameter ${fieldName} must be a ${expectedType}`;
    }

    // Handle string length errors
    if (issue.code === 'too_small' && issue.type === 'string') {
      const fieldName = issue.path[0];
      return `Parameter ${fieldName} must be at least ${issue.minimum} characters long`;
    }

    if (issue.code === 'too_big' && issue.type === 'string') {
      const fieldName = issue.path[0];
      return `Parameter ${fieldName} must be at most ${issue.maximum} characters long`;
    }

    // Handle pattern errors
    if (issue.code === 'invalid_string' && issue.validation === 'regex') {
      const fieldName = issue.path[0];
      // Find the original pattern from the template
      const paramDef =
        template.parametersSchema.properties[fieldName as string];
      const pattern = paramDef?.pattern || 'pattern';
      return `Parameter ${fieldName} does not match required pattern: ${pattern}`;
    }

    // Handle unknown keys
    if (issue.code === 'unrecognized_keys') {
      const unknownKeys = (issue as any).keys;
      return unknownKeys
        .map((key: string) => `Unknown parameter: ${key}`)
        .join(', ');
    }

    // Default format
    const path = issue.path.join('.');
    if (path) {
      return `${path}: ${issue.message}`;
    }
    return issue.message;
  });

  // Split comma-separated errors into individual errors
  const expandedErrors: string[] = [];
  for (const error of errors) {
    if (error.includes('Unknown parameter:') && error.includes(',')) {
      expandedErrors.push(...error.split(', '));
    } else {
      expandedErrors.push(error);
    }
  }

  return {
    valid: false,
    errors: expandedErrors,
  };
}

export function parseParameters(jsonString: string): unknown {
  try {
    const parsed = JSON.parse(jsonString);
    // Return null for non-object values (arrays, primitives)
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}
