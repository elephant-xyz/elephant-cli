import { ValidateFunction, ErrorObject, Ajv, KeywordDefinition } from 'ajv';
import addFormats from 'ajv-formats';
import { CID } from 'multiformats';
import { JSONSchema } from './schema-cache.service.js';
import { IPFSService } from './ipfs.service.js';

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
  private ipfsService: IPFSService;
  private schemaCache: Map<string, JSONSchema> = new Map();

  constructor(ipfsService: IPFSService) {
    this.ipfsService = ipfsService;
    this.ajv = new Ajv({ allErrors: true, loadSchema: this.loadSchemaFromCID.bind(this) });
    addFormats.default(this.ajv);
    this.setupCIDCustomizations();
  }

  private setupCIDCustomizations(): void {
    // Custom keyword for 'cid' type that embeds schema from IPFS
    const cidKeyword: KeywordDefinition = {
      keyword: 'cid',
      type: 'object',
      schemaType: 'string',
      async: true,
      compile: (cidValue: string) => {
        return async (data: any): Promise<boolean> => {
          try {
            const schema = await this.loadSchemaFromCID(cidValue);
            const validator = this.ajv.compile(schema);
            return validator(data) as boolean;
          } catch (error) {
            return false;
          }
        };
      }
    };

    this.ajv.addKeyword(cidKeyword);

    // Enhanced CID format validation
    this.ajv.addFormat('cid', {
      type: 'string',
      validate: (value: string): boolean => {
        try {
          CID.parse(value);
          return true;
        } catch {
          return false;
        }
      }
    });
  }

  private async loadSchemaFromCID(cidStr: string): Promise<JSONSchema> {
    // Check cache first
    if (this.schemaCache.has(cidStr)) {
      return this.schemaCache.get(cidStr)!;
    }

    try {
      // Validate CID format
      const cid = CID.parse(cidStr);
      
      // Fetch schema content from IPFS
      const buffer = await this.ipfsService.fetchContent(cidStr);
      const schemaText = buffer.toString('utf-8');
      const schema = JSON.parse(schemaText) as JSONSchema;

      // Validate that it's a valid JSON schema
      if (!await this.isValidSchema(schema)) {
        throw new Error(`Invalid JSON schema fetched from CID: ${cidStr}`);
      }

      // Cache the schema
      this.schemaCache.set(cidStr, schema);
      
      return schema;
    } catch (error) {
      throw new Error(`Failed to load schema from CID ${cidStr}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Validate JSON data against a schema
   */
  async validate(data: any, schema: JSONSchema): Promise<ValidationResult> {
    try {
      // Get or compile validator
      const validator = await this.getValidator(schema);

      // Validate the data (handle both sync and async validators)
      const result = validator(data);
      const valid = typeof result === 'object' && result !== null && 'then' in result ? await result : result;

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
  private async getValidator(schema: JSONSchema): Promise<ValidateFunction> {
    // Create a cache key from the schema
    const cacheKey = JSON.stringify(schema);

    // Check if we already have a compiled validator
    let validator = this.validators.get(cacheKey);

    if (!validator) {
      // Handle async schema loading if needed
      const processedSchema = await this.processSchemaReferences(schema);
      validator = this.ajv.compile(processedSchema);
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
   * Process schema references and resolve CID-based schemas
   */
  private async processSchemaReferences(schema: JSONSchema): Promise<JSONSchema> {
    // Deep clone to avoid modifying the original
    const processedSchema = JSON.parse(JSON.stringify(schema));
    
    // Recursively process the schema to find and resolve CID references
    await this.processSchemaNode(processedSchema);
    
    return processedSchema;
  }

  /**
   * Recursively process schema nodes to resolve CID references
   */
  private async processSchemaNode(node: any): Promise<void> {
    if (!node || typeof node !== 'object') {
      return;
    }

    // Handle CID type declarations
    if (node.type === 'cid' && typeof node.cid === 'string') {
      // Replace with embedded schema from IPFS
      const embeddedSchema = await this.loadSchemaFromCID(node.cid);
      Object.assign(node, embeddedSchema);
      delete node.cid; // Remove the CID reference
    }

    // Handle CID format declarations  
    if (node.type === 'string' && node.format === 'cid' && typeof node.value === 'string') {
      // Replace with embedded schema from IPFS
      const embeddedSchema = await this.loadSchemaFromCID(node.value);
      Object.assign(node, embeddedSchema);
      delete node.value; // Remove the CID reference
      delete node.format; // Remove the format
    }

    // Recursively process all object properties
    for (const key in node) {
      if (node.hasOwnProperty(key)) {
        await this.processSchemaNode(node[key]);
      }
    }

    // Handle arrays
    if (Array.isArray(node)) {
      for (const item of node) {
        await this.processSchemaNode(item);
      }
    }
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
