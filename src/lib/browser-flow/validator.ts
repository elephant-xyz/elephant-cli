import {
  BrowserFlowTemplate,
  ValidationResult,
  BrowserFlowParameters,
} from './types.js';

export function validateParameters(
  template: BrowserFlowTemplate,
  params: BrowserFlowParameters
): ValidationResult {
  const errors: string[] = [];
  const { properties, required } = template.parametersSchema;

  // Check required parameters
  for (const requiredParam of required) {
    if (!(requiredParam in params) || params[requiredParam] === undefined) {
      errors.push(`Missing required parameter: ${requiredParam}`);
    }
  }

  // Validate each parameter
  for (const [key, value] of Object.entries(params)) {
    const schema = properties[key];
    if (!schema) {
      errors.push(`Unknown parameter: ${key}`);
      continue;
    }

    // Type validation
    if (schema.type === 'string' && typeof value !== 'string') {
      errors.push(`Parameter ${key} must be a string`);
      continue;
    }
    if (schema.type === 'number' && typeof value !== 'number') {
      errors.push(`Parameter ${key} must be a number`);
      continue;
    }
    if (schema.type === 'boolean' && typeof value !== 'boolean') {
      errors.push(`Parameter ${key} must be a boolean`);
      continue;
    }

    // String-specific validations
    if (schema.type === 'string' && typeof value === 'string') {
      if (schema.minLength && value.length < schema.minLength) {
        errors.push(
          `Parameter ${key} must be at least ${schema.minLength} characters long`
        );
      }
      if (schema.maxLength && value.length > schema.maxLength) {
        errors.push(
          `Parameter ${key} must be at most ${schema.maxLength} characters long`
        );
      }
      if (schema.pattern) {
        const regex = new RegExp(schema.pattern);
        if (!regex.test(value)) {
          errors.push(
            `Parameter ${key} does not match required pattern: ${schema.pattern}`
          );
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors: errors.length > 0 ? errors : undefined,
  };
}

export function parseParameters(
  jsonString: string
): BrowserFlowParameters | null {
  try {
    const parsed = JSON.parse(jsonString);
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
