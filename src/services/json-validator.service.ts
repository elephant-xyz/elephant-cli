import { ValidateFunction, ErrorObject, Ajv } from 'ajv';
import addFormats from 'ajv-formats';
import { CID } from 'multiformats';
import { promises as fsPromises } from 'fs';
import path from 'path';
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
  private baseDirectory?: string;

  constructor(ipfsService: IPFSService, baseDirectory?: string) {
    this.ipfsService = ipfsService;
    this.baseDirectory = baseDirectory;
    this.ajv = new Ajv({
      allErrors: true,
      loadSchema: this.loadSchemaFromCID.bind(this),
    });
    addFormats.default(this.ajv);
    this.setupCIDCustomizations();
  }

  private setupCIDCustomizations(): void {
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
      },
    });
  }

  private async loadSchemaFromCID(cidStr: string): Promise<JSONSchema> {
    // Check cache first
    if (this.schemaCache.has(cidStr)) {
      return this.schemaCache.get(cidStr)!;
    }

    try {
      // Validate CID format
      CID.parse(cidStr);

      // Fetch schema content from IPFS
      const buffer = await this.ipfsService.fetchContent(cidStr);
      const schemaText = buffer.toString('utf-8');
      const schema = JSON.parse(schemaText) as JSONSchema;

      // Don't validate here because the schema might contain nested CID references
      // Validation will happen after all CID references are resolved

      // Cache the schema
      this.schemaCache.set(cidStr, schema);

      return schema;
    } catch (error) {
      throw new Error(
        `Failed to load schema from CID ${cidStr}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Validate JSON data against a schema
   * @param data The data to validate
   * @param schema The schema to validate against
   * @param currentFilePath Optional path of the file containing this data (for relative path resolution)
   */
  async validate(
    data: any,
    schema: JSONSchema,
    currentFilePath?: string
  ): Promise<ValidationResult> {
    try {
      // Resolve CID pointers in data if present
      const resolvedData = await this.resolveCIDPointers(data, currentFilePath);

      // Also resolve any CID references in the schema
      const resolvedSchema = await this.resolveCIDSchemas(schema);

      // Get or compile validator
      const validator = await this.getValidator(resolvedSchema);

      // Validate the data (handle both sync and async validators)
      const result = validator(resolvedData);
      const valid =
        typeof result === 'object' && result !== null && 'then' in result
          ? await result
          : result;

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
   * Resolve CID references in schemas
   * Replaces { type: 'string', cid: '...' } with the actual schema from IPFS
   */
  private async resolveCIDSchemas(schema: any): Promise<any> {
    if (!schema || typeof schema !== 'object') {
      return schema;
    }

    // Check if this schema node has a 'cid' property (along with type)
    if (schema.cid && typeof schema.cid === 'string' && schema.type) {
      try {
        // Load and return the schema from the CID
        return await this.loadSchemaFromCID(schema.cid);
      } catch (error) {
        throw new Error(
          `Failed to resolve schema CID: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    // Handle arrays
    if (Array.isArray(schema)) {
      return Promise.all(schema.map((item) => this.resolveCIDSchemas(item)));
    }

    // Recursively process object properties
    const resolved: any = {};
    for (const key in schema) {
      if (Object.prototype.hasOwnProperty.call(schema, key)) {
        resolved[key] = await this.resolveCIDSchemas(schema[key]);
      }
    }
    return resolved;
  }

  /**
   * Resolve CID pointers in data
   * Handles {"/": <cid>} pattern by fetching content from IPFS
   * Handles {"/": <relative_file_path>} pattern by reading from local filesystem
   * @param data The data to resolve pointers in
   * @param currentFilePath Optional path of the file containing this data (for relative path resolution)
   */
  private async resolveCIDPointers(
    data: any,
    currentFilePath?: string
  ): Promise<any> {
    if (!data || typeof data !== 'object') {
      return data;
    }

    // Check if this is a pointer object
    if (
      Object.prototype.hasOwnProperty.call(data, '/') &&
      typeof data['/'] === 'string' &&
      Object.keys(data).length === 1
    ) {
      const pointerValue = data['/'];

      // Check for empty string
      if (!pointerValue) {
        throw new Error(
          'Failed to resolve pointer - empty string is not a valid CID or file path'
        );
      }

      // Try to parse as CID first
      let isCID = false;
      try {
        CID.parse(pointerValue);
        isCID = true;
      } catch {
        // Not a valid CID
      }

      if (isCID) {
        // It's a valid CID, fetch from IPFS
        try {
          const contentBuffer =
            await this.ipfsService.fetchContent(pointerValue);
          const contentText = contentBuffer.toString('utf-8');

          // Try to parse as JSON
          try {
            const parsed = JSON.parse(contentText);
            // Recursively resolve any nested CID pointers
            return await this.resolveCIDPointers(parsed, currentFilePath);
          } catch {
            // Return as string if not valid JSON
            return contentText;
          }
        } catch (error) {
          throw new Error(
            `Failed to resolve CID pointer: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      } else {
        // Not a valid CID, try as file path
        if (!this.baseDirectory && !pointerValue.startsWith('/')) {
          throw new Error(
            `Failed to resolve pointer - not a valid CID and no base directory provided for relative path: ${pointerValue}`
          );
        }

        try {
          let filePath: string;

          // Handle absolute paths (starting with /)
          if (pointerValue.startsWith('/')) {
            filePath = pointerValue;
          } else {
            // Handle relative paths
            // First try relative to current file (if provided)
            if (currentFilePath) {
              const currentDir = path.dirname(currentFilePath);
              filePath = path.join(currentDir, pointerValue);
            } else if (this.baseDirectory) {
              // Fallback to base directory
              filePath = path.join(this.baseDirectory, pointerValue);
            } else {
              throw new Error(
                `No context provided for relative path: ${pointerValue}`
              );
            }
          }

          const fileContent = await fsPromises.readFile(filePath, 'utf-8');

          // Try to parse as JSON
          try {
            const parsed = JSON.parse(fileContent);
            // Recursively resolve any nested CID pointers
            return await this.resolveCIDPointers(parsed, currentFilePath);
          } catch {
            // Return as string if not valid JSON
            return fileContent;
          }
        } catch (fileError) {
          throw new Error(
            `Failed to resolve pointer - not a valid CID or accessible file path: ${pointerValue}`
          );
        }
      }
    }

    // Recursively resolve CID pointers in arrays
    if (Array.isArray(data)) {
      return Promise.all(
        data.map((item) => this.resolveCIDPointers(item, currentFilePath))
      );
    }

    // Recursively resolve CID pointers in objects
    const resolved: any = {};
    for (const key in data) {
      if (Object.prototype.hasOwnProperty.call(data, key)) {
        resolved[key] = await this.resolveCIDPointers(data[key], currentFilePath);
      }
    }
    return resolved;
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
  private async processSchemaReferences(
    schema: JSONSchema
  ): Promise<JSONSchema> {
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

    // Handle CID schema references: {"type": "string", "cid": <cid_value>}
    if (node.type === 'string' && typeof node.cid === 'string') {
      // Replace with embedded schema from IPFS
      const embeddedSchema = await this.loadSchemaFromCID(node.cid);
      Object.assign(node, embeddedSchema);
      delete node.cid; // Remove the CID reference
    }

    // Recursively process all object properties
    for (const key in node) {
      if (Object.prototype.hasOwnProperty.call(node, key)) {
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
