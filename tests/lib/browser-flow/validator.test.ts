import { describe, it, expect } from 'vitest';
import {
  validateParameters,
  parseParameters,
} from '../../../src/lib/browser-flow/validator.js';
import { BrowserFlowTemplate } from '../../../src/lib/browser-flow/types.js';

describe('Browser Flow Validator', () => {
  const mockTemplate: BrowserFlowTemplate = {
    id: 'TEST_TEMPLATE',
    name: 'Test Template',
    description: 'Test template for validation',
    parametersSchema: {
      type: 'object',
      properties: {
        required_string: {
          type: 'string',
          description: 'Required string parameter',
          minLength: 1,
        },
        optional_string: {
          type: 'string',
          description: 'Optional string parameter',
          minLength: 5,
          maxLength: 10,
        },
        number_param: {
          type: 'number',
          description: 'Number parameter',
        },
        pattern_param: {
          type: 'string',
          description: 'Pattern parameter',
          pattern: '^[A-Z]+$',
        },
      },
      required: ['required_string'],
    },
    createWorkflow: () => ({
      starts_at: 'test',
      states: {},
    }),
  };

  describe('validateParameters', () => {
    it('should validate valid parameters', () => {
      const params = {
        required_string: 'test',
        optional_string: 'hello',
        number_param: 42,
      };

      const result = validateParameters(mockTemplate, params);
      expect(result.valid).toBe(true);
      expect(result.errors).toBeUndefined();
    });

    it('should detect missing required parameters', () => {
      const params = {
        optional_string: 'hello',
      };

      const result = validateParameters(mockTemplate, params);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        'Missing required parameter: required_string'
      );
    });

    it('should detect type mismatches', () => {
      const params = {
        required_string: 123,
        number_param: 'not a number',
      };

      const result = validateParameters(mockTemplate, params);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        'Parameter required_string must be a string'
      );
      expect(result.errors).toContain(
        'Parameter number_param must be a number'
      );
    });

    it('should validate string length constraints', () => {
      const params = {
        required_string: 'test',
        optional_string: 'ab',
      };

      const result = validateParameters(mockTemplate, params);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        'Parameter optional_string must be at least 5 characters long'
      );
    });

    it('should validate pattern constraints', () => {
      const params = {
        required_string: 'test',
        pattern_param: 'lowercase',
      };

      const result = validateParameters(mockTemplate, params);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        'Parameter pattern_param does not match required pattern: ^[A-Z]+$'
      );
    });

    it('should detect unknown parameters', () => {
      const params = {
        required_string: 'test',
        unknown_param: 'value',
      };

      const result = validateParameters(mockTemplate, params);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Unknown parameter: unknown_param');
    });
  });

  describe('parseParameters', () => {
    it('should parse valid JSON', () => {
      const json = '{"key": "value", "number": 42}';
      const result = parseParameters(json);
      expect(result).toEqual({ key: 'value', number: 42 });
    });

    it('should return null for invalid JSON', () => {
      const json = '{invalid json}';
      const result = parseParameters(json);
      expect(result).toBeNull();
    });

    it('should return null for non-object JSON', () => {
      const json = '"string"';
      const result = parseParameters(json);
      expect(result).toBeNull();
    });

    it('should return null for array JSON', () => {
      const json = '[1, 2, 3]';
      const result = parseParameters(json);
      expect(result).toBeNull();
    });
  });
});
