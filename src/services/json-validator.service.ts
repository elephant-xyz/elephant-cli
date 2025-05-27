import Ajv, { ValidateFunction, ErrorObject } from 'ajv';
import addFormats from 'ajv-formats';
import { JSONSchema } from './schema-cache.service';

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
  private validators: Map<string, ValidateFunction>;

  constructor() {
    // Initialize AJV with draft-07 support
    this.ajv = new Ajv({
      strict: false,  // Allow draft-07 schemas
      allErrors: true, // Report all errors, not just the first one
      verbose: true,   // Include data in errors
      validateFormats: true
    });

    // Add format validators (date, time, email, etc.)
    addFormats(this.ajv);

    // Cache compiled validators for reuse
    this.validators = new Map();
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
        errors: [{
          path: '',
          message: `Validation error: ${error instanceof Error ? error.message : String(error)}`,
          keyword: 'error',
          params: {}
        }]
      };
    }
  }

  /**
   * Validate a batch of JSON data against the same schema
   */
  async validateBatch(dataArray: any[], schema: JSONSchema): Promise<ValidationResult[]> {
    // Get compiled validator for reuse across all items
    const validator = this.getValidator(schema);
    
    // Process all validations synchronously
    return dataArray.map(data => {
      const valid = validator(data);
      
      if (valid) {
        return { valid: true };
      } else {
        const errors = this.transformErrors(validator.errors || []);
        return { valid: false, errors };
      }
    });
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
      // Compile the schema
      validator = this.ajv.compile(schema);
      this.validators.set(cacheKey, validator);
    }
    
    return validator;
  }

  /**
   * Transform AJV errors to our format
   */
  private transformErrors(ajvErrors: ErrorObject[]): ValidationError[] {
    return ajvErrors.map(error => ({
      path: error.instancePath || '/',
      message: error.message || 'Validation failed',
      keyword: error.keyword,
      params: error.params
    }));
  }

  /**
   * Add a custom format validator
   */
  addFormat(name: string, format: string | RegExp | ((data: string) => boolean)): void {
    this.ajv.addFormat(name, format);
  }

  /**
   * Add a custom keyword validator
   */
  addKeyword(keyword: string, definition: any): void {
    this.ajv.addKeyword({
      keyword,
      ...definition
    });
  }

  /**
   * Clear the validator cache
   */
  clearCache(): void {
    this.validators.clear();
  }

  /**
   * Get a human-readable error message from validation errors
   */
  getErrorMessage(errors: ValidationError[]): string {
    if (!errors || errors.length === 0) {
      return 'Unknown validation error';
    }

    return errors
      .map(error => {
        const path = error.path || 'root';
        return `${path}: ${error.message}`;
      })
      .join(', ');
  }

  /**
   * Check if a schema is valid
   */
  isValidSchema(schema: any): boolean {
    try {
      this.ajv.compile(schema);
      return true;
    } catch {
      return false;
    }
  }
}