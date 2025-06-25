import { ValidateFunction, ErrorObject, Ajv } from 'ajv';
import addFormats from 'ajv-formats';
import { CID } from 'multiformats';
import { JSONSchema } from './schema-cache.service.js';

export interface ValidationError {
  path: string;
  message: string;
  keyword: string;
  params: any;
}

export interface ValidationResult {
  valid: boolean;
  errors?: ValidationError[];
}

export class JsonValidatorService {
  private ajv: Ajv;
  private validators: Map<string, ValidateFunction> = new Map();

  constructor() {
    this.ajv = new Ajv({ allErrors: true });
    addFormats(this.ajv);
    this.ajv.addFormat('cid', {
      type: 'string',
      validate: (value: string) => {
        try {
          CID.parse(value);
        } catch (error) {
          return false;
        }
        return true;
      },
    });
  }

  /**
   * Validate JSON data against a schema
   */
  validate(data: any, schema: JSONSchema): ValidationResult {
    try {
      // Get or compile validator
      const validator = this.getValidator(schema);

      // Validate the data
      const valid = validator(data);

      if (valid) {
        return { valid: true };
      } else {
        // Transform AJV errors to our format
        const errors = this.transformErrors(validator.errors || []);
        return { valid: false, errors };
      }
    } catch (error) {
      return {
        valid: false,
        errors: [
          {
            path: '',
            message: `Validation error: ${error instanceof Error ? error.message : String(error)}`,
            keyword: 'error',
            params: {},
          },
        ],
      };
    }
  }

  /**
   * Get or compile a validator for a schema
   */
  private getValidator(schema: JSONSchema): ValidateFunction {
    // Create a cache key from the schema
    const cacheKey = JSON.stringify(schema);

    // Check if we already have a compiled validator
    let validator = this.validators.get(cacheKey);

    if (!validator) {
      validator = this.ajv.compile(schema);
      this.validators.set(cacheKey, validator);

      if (!validator) {
        throw new Error('Failed to compile schema validator');
      }
    }

    if (!validator) {
      throw new Error('Failed to compile or retrieve validator');
    }
    return validator;
  }

  /**
   * Transform AJV errors to our format
   */
  private transformErrors(ajvErrors: ErrorObject[]): ValidationError[] {
    return ajvErrors.map((error) => ({
      path: error.instancePath || '/',
      message: error.message || 'Validation failed',
      keyword: error.keyword,
      params: error.params,
    }));
  }

  /**
   * Get a human-readable error message from validation errors
   */
  getErrorMessage(errors: ValidationError[]): string {
    if (!errors || errors.length === 0) {
      return 'Unknown validation error';
    }

    return errors
      .map((error) => {
        const path = error.path || 'root';
        return `${path}: ${error.message}`;
      })
      .join(', ');
  }

  /**
   * Check if a schema is valid
   */
  async isValidSchema(schema: any): Promise<boolean> {
    try {
      this.ajv.compile(schema);
      return true;
    } catch {
      return false;
    }
  }
}
