import { ValidateFunction, ErrorObject, Ajv } from 'ajv';
import addFormats from 'ajv-formats';
import { CID } from 'multiformats';
import * as raw_codec from 'multiformats/codecs/raw';
import { sha256 } from 'multiformats/hashes/sha2';
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
    // Add default formats first
    addFormats.default(this.ajv);
    // Then setup our custom formats (which may override some defaults)
    this.setupCustomFormats();
  }

  private setupCustomFormats(): void {
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

    // Custom currency format (only positive numbers with max 2 decimal places)
    this.ajv.addFormat('currency', {
      type: 'number',
      validate: (value: number): boolean => {
        // Check if it's a valid number
        if (typeof value !== 'number' || isNaN(value) || !isFinite(value)) {
          return false;
        }
        
        // Must be greater than zero
        if (value <= 0) {
          return false;
        }
        
        // Convert to string to check decimal places
        const valueStr = value.toString();
        const parts = valueStr.split('.');
        
        // If there's a decimal part, it should have at most 2 digits
        if (parts.length === 2) {
          // Handle scientific notation (e.g., 1e-10)
          if (valueStr.includes('e') || valueStr.includes('E')) {
            // Convert from scientific notation and check decimal places
            const decimalPlaces = value.toFixed(10).replace(/\.?0+$/, '').split('.')[1];
            return !decimalPlaces || decimalPlaces.length <= 2;
          }
          return parts[1].length <= 2;
        }
        
        // No decimal part is valid
        return parts.length === 1;
      },
    });

    // Custom IPFS URI format
    this.ajv.addFormat('ipfs_uri', {
      type: 'string',
      validate: (value: string): boolean => {
        const ipfsUriPattern = /^ipfs:\/\/[A-Za-z0-9]{46,59}$/;
        if (!ipfsUriPattern.test(value)) {
          return false;
        }

        // Extract CID from URI and validate it
        const cidString = value.substring(7); // Remove 'ipfs://'
        try {
          const cid = CID.parse(cidString);

          // For CIDv1, check if it uses raw codec (0x55) and sha256
          if (cid.version === 0) {
            return false;
          }
          // raw codec is 0x55
          const isRawCodec = cid.code === raw_codec.code;
          // sha2-256 is 0x12
          const isSha256 = cid.multihash.code === sha256.code;

          return isRawCodec && isSha256;
        } catch {
          return false;
        }
      },
    });

    // Custom rate percent format (exactly 3 decimal places)
    this.ajv.addFormat('rate_percent', {
      type: 'string',
      validate: (value: string): boolean => {
        const ratePattern = /^\d+\.\d{3}$/;
        return ratePattern.test(value);
      },
    });

    // The 'date' format from ajv-formats already validates ISO format (YYYY-MM-DD)
    // No need to override it since we want ISO format validation

    // Override the default 'uri' format to match our specific pattern
    this.ajv.addFormat('uri', {
      type: 'string',
      validate: (value: string): boolean => {
        // Our specific URI pattern
        // Note: In Unicode mode (which AJV uses), we need to be careful with escapes in character classes
        // Updated to support optional user@ part
        const uriPattern =
          /^https?:\/\/([\w-]+@)?[\w-]+(\.[\w-]+)+([\w\-.,@?^=%&:/~+#]*[\w\-@?^=%&/~+#])?$/;
        return uriPattern.test(value);
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
        // Load the schema from the CID
        const loadedSchema = await this.loadSchemaFromCID(schema.cid);
        // Recursively resolve any CID references within the loaded schema
        return await this.resolveCIDSchemas(loadedSchema);
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
        resolved[key] = await this.resolveCIDPointers(
          data[key],
          currentFilePath
        );
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
      // Schema has already been resolved by resolveCIDSchemas, compile directly
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
