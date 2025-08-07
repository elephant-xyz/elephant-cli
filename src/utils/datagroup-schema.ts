export interface DataGroupSchemaValidation {
  valid: boolean;
  error?: string;
}

/**
 * Validate that a schema is a valid Elephant data group schema.
 * Rules:
 * - Must be an object schema (type: 'object')
 * - Must have exactly two properties: 'label' and 'relationships'
 */
export function isValidDataGroupSchema(
  schema: unknown
): DataGroupSchemaValidation {
  if (!schema || typeof schema !== 'object') {
    return { valid: false, error: 'Schema must be a valid JSON object' };
  }

  const s = schema as Record<string, unknown>;

  if (s.type !== 'object') {
    return {
      valid: false,
      error: 'Data group schema must describe an object (type: "object")',
    };
  }

  if (typeof s.properties !== 'object' || s.properties === null) {
    return {
      valid: false,
      error: 'Data group schema must have a "properties" object',
    };
  }

  const properties = s.properties as Record<string, unknown>;

  if (!Object.prototype.hasOwnProperty.call(properties, 'label')) {
    return {
      valid: false,
      error: 'Data group schema must have a "label" property',
    };
  }

  if (!Object.prototype.hasOwnProperty.call(properties, 'relationships')) {
    return {
      valid: false,
      error: 'Data group schema must have a "relationships" property',
    };
  }

  if (Object.keys(properties).length !== 2) {
    return {
      valid: false,
      error:
        'Data group schema must have exactly 2 properties: "label" and "relationships"',
    };
  }

  return { valid: true };
}
