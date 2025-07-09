import { ValidateFunction, ErrorObject, Ajv } from 'ajv';
import addFormats from 'ajv-formats';
import { CID } from 'multiformats';
import * as raw_codec from 'multiformats/codecs/raw';
import { sha256 } from 'multiformats/hashes/sha2';
import { promises as fsPromises } from 'fs';
import path from 'path';
import { JSONSchema } from './schema-cache.service.js';
import { IPFSService } from './ipfs.service.js';
import { logger } from '../utils/logger.js';

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
      strict: false, // Allow draft-07 schemas
      validateSchema: false, // Don't validate the schema itself
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
            const decimalPlaces = value
              .toFixed(10)
              .replace(/\.?0+$/, '')
              .split('.')[1];
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
      // Root schema should not be a CID link itself
      if (this.isCIDLinkSchema(schema)) {
        return {
          valid: false,
          errors: [
            {
              path: '',
              message:
                'Root schema cannot be a CID link. CID links are only allowed within schema properties.',
              keyword: 'error',
              params: {},
            },
          ],
        };
      }

      // Resolve any CID references in the schema first and create a map of which schema parts allow CID resolution
      const cidAllowedMap = new Map<string, boolean>();
      const resolvedSchema = await this.resolveCIDSchemasAndTrackPaths(
        schema,
        cidAllowedMap
      );

      // Resolve CID pointers in data if present, but only where schema allows it
      const resolvedData = await this.resolveCIDPointers(
        data,
        currentFilePath,
        resolvedSchema,
        cidAllowedMap
      );

      logger.debug(`resolved data type: ${typeof resolvedData}`);

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
   * Resolve CID references in schemas and track which paths allow CID pointers
   * Replaces { type: 'string', cid: '...' } with the actual schema from IPFS
   */
  private async resolveCIDSchemasAndTrackPaths(
    schema: any,
    cidAllowedMap: Map<string, boolean>,
    currentPath: string = ''
  ): Promise<any> {
    if (!schema || typeof schema !== 'object') {
      return schema;
    }

    // Check if this schema node has a 'cid' property (along with type)
    if (this.isCIDLinkSchema(schema)) {
      try {
        // Mark this path as allowing CID pointers
        cidAllowedMap.set(currentPath, true);

        // Load the schema from the CID
        const loadedSchema = await this.loadSchemaFromCID(schema.cid);

        // If the original schema allows multiple types (e.g., ['string', 'null']),
        // we need to create a schema that combines the loaded schema with the null option
        if (
          Array.isArray(schema.type) &&
          schema.type.includes('null') &&
          schema.type.length > 1
        ) {
          // First, recursively resolve any CID references within the loaded schema
          const resolvedLoadedSchema =
            await this.resolveCIDSchemasAndTrackPaths(
              loadedSchema,
              cidAllowedMap,
              currentPath
            );

          // Create an anyOf schema that allows null or the resolved loaded schema
          return {
            anyOf: [{ type: 'null' }, resolvedLoadedSchema],
          };
        } else {
          // Single type or only string type, use the loaded schema as-is
          // Recursively resolve any CID references within the loaded schema
          return await this.resolveCIDSchemasAndTrackPaths(
            loadedSchema,
            cidAllowedMap,
            currentPath
          );
        }
      } catch (error) {
        throw new Error(
          `Failed to resolve schema CID: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    // Handle arrays
    if (Array.isArray(schema)) {
      return Promise.all(
        schema.map((item, _index) =>
          this.resolveCIDSchemasAndTrackPaths(
            item,
            cidAllowedMap,
            currentPath ? `${currentPath}[]` : '[]'
          )
        )
      );
    }

    // Recursively process object properties
    const resolved: any = {};
    for (const key in schema) {
      if (Object.prototype.hasOwnProperty.call(schema, key)) {
        // Special handling for 'properties' - we want to track paths within the properties
        if (key === 'properties' && typeof schema[key] === 'object') {
          resolved[key] = {};
          for (const propKey in schema[key]) {
            const propPath = currentPath
              ? `${currentPath}.${propKey}`
              : propKey;
            resolved[key][propKey] = await this.resolveCIDSchemasAndTrackPaths(
              schema[key][propKey],
              cidAllowedMap,
              propPath
            );
          }
        } else if (key === 'items') {
          // Special handling for array items
          const itemsPath = currentPath ? `${currentPath}[]` : '[]';
          resolved[key] = await this.resolveCIDSchemasAndTrackPaths(
            schema[key],
            cidAllowedMap,
            itemsPath
          );
        } else {
          // For other properties, don't change the path
          resolved[key] = await this.resolveCIDSchemasAndTrackPaths(
            schema[key],
            cidAllowedMap,
            currentPath
          );
        }
      }
    }
    return resolved;
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
    if (this.isCIDLinkSchema(schema)) {
      try {
        // Load the schema from the CID
        const loadedSchema = await this.loadSchemaFromCID(schema.cid);

        // If the original schema allows multiple types (e.g., ['string', 'null']),
        // we need to create a schema that combines the loaded schema with the null option
        if (
          Array.isArray(schema.type) &&
          schema.type.includes('null') &&
          schema.type.length > 1
        ) {
          // Create an anyOf schema that allows null or the loaded schema
          const combinedSchema = {
            anyOf: [{ type: 'null' }, loadedSchema],
          };
          // Recursively resolve any CID references within the combined schema
          return await this.resolveCIDSchemas(combinedSchema);
        } else {
          // Single type or only string type, use the loaded schema as-is
          // Recursively resolve any CID references within the loaded schema
          return await this.resolveCIDSchemas(loadedSchema);
        }
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
   * Only resolves pointers where the corresponding schema part is a CID link
   * @param data The data to resolve pointers in
   * @param currentFilePath Optional path of the file containing this data (for relative path resolution)
   * @param schema The schema corresponding to this data part
   * @param cidAllowedMap Map of which schema paths allow CID resolution
   * @param currentPath Current path in the data structure
   */
  private async resolveCIDPointers(
    data: any,
    currentFilePath?: string,
    schema?: any,
    cidAllowedMap?: Map<string, boolean>,
    currentPath: string = ''
  ): Promise<any> {
    if (!data || typeof data !== 'object' || data === null) {
      return data;
    }

    // Check if this is a pointer object
    if (
      Object.prototype.hasOwnProperty.call(data, '/') &&
      typeof data['/'] === 'string' &&
      Object.keys(data).length === 1
    ) {
      const pointerValue = data['/'];

      // Check if the current path allows CID links
      let allowsCID = cidAllowedMap?.get(currentPath) || false;

      // If schema is an anyOf, check if any of the options allow CID resolution
      if (!allowsCID && schema && schema.anyOf && Array.isArray(schema.anyOf)) {
        allowsCID = schema.anyOf.some(
          (option: any) =>
            option.type !== 'null' &&
            (option.type === 'object' || option.properties || !option.type)
        );
      }

      if (!allowsCID) {
        // Schema doesn't allow CID links, return the pointer as-is
        return data;
      }

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
            return await this.resolveCIDPointers(
              parsed,
              currentFilePath,
              schema,
              cidAllowedMap,
              currentPath
            );
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

        let filePath: string;
        let fileContent: string;
        try {
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

          fileContent = await fsPromises.readFile(filePath, 'utf-8');
        } catch (fileError) {
          throw new Error(
            `Failed to resolve pointer - not a valid CID or accessible file path: ${pointerValue}`
          );
        }

        // Try to parse as JSON
        let parsed;
        try {
          parsed = JSON.parse(fileContent);
        } catch {
          return fileContent;
        }
        return await this.resolveCIDPointers(
          parsed,
          currentFilePath,
          schema,
          cidAllowedMap,
          currentPath
        );
      }
    }

    // Recursively resolve CID pointers in arrays
    if (Array.isArray(data)) {
      logger.debug(`Found an array: ${JSON.stringify(data)}`);
      const itemSchema = schema && schema.items ? schema.items : undefined;
      const arrayResults = await Promise.all(
        data.map((item, _index) => {
          try {
            const itemPath = currentPath ? `${currentPath}[]` : '[]';
            return this.resolveCIDPointers(
              item,
              currentFilePath,
              itemSchema,
              cidAllowedMap,
              itemPath
            );
          } catch (error) {
            throw new Error(`Failed to resolve CID pointer in array: ${error}`);
          }
        })
      );
      logger.debug(`Resolved array: ${JSON.stringify(arrayResults)}`);
      return arrayResults;
    }

    // Recursively resolve CID pointers in objects
    const resolved: any = {};
    for (const key in data) {
      if (typeof data[key] === 'object' && data[key] !== null) {
        let propertySchema =
          schema && schema.properties && schema.properties[key]
            ? schema.properties[key]
            : undefined;

        // If schema is an anyOf and we don't have a property schema, check anyOf options
        if (
          !propertySchema &&
          schema &&
          schema.anyOf &&
          Array.isArray(schema.anyOf)
        ) {
          for (const option of schema.anyOf) {
            if (option.properties && option.properties[key]) {
              propertySchema = option.properties[key];
              break;
            }
          }
        }

        const propertyPath = currentPath ? `${currentPath}.${key}` : key;
        resolved[key] = await this.resolveCIDPointers(
          data[key],
          currentFilePath,
          propertySchema,
          cidAllowedMap,
          propertyPath
        );
      } else {
        resolved[key] = data[key];
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
      message: this.enhanceErrorMessage(error),
      keyword: error.keyword,
      params: error.params,
    }));
  }

  /**
   * Enhance error messages with detailed format descriptions
   */
  private enhanceErrorMessage(error: ErrorObject): string {
    const baseMessage = error.message || 'Validation failed';

    // Enhanced format error messages
    if (error.keyword === 'format' && error.params?.format) {
      const format = error.params.format;

      switch (format) {
        case 'date':
          return 'must be a valid ISO date in YYYY-MM-DD format';
        case 'date-time':
          return 'must be a valid ISO date-time in YYYY-MM-DDTHH:mm:ss.sssZ format';
        case 'time':
          return 'must be a valid ISO time in HH:mm:ss format';
        case 'email':
          return 'must be a valid email address';
        case 'hostname':
          return 'must be a valid hostname';
        case 'ipv4':
          return 'must be a valid IPv4 address';
        case 'ipv6':
          return 'must be a valid IPv6 address';
        case 'uri':
          return 'must be a valid URI starting with http:// or https://';
        case 'uri-reference':
          return 'must be a valid URI reference';
        case 'iri':
          return 'must be a valid IRI (Internationalized Resource Identifier)';
        case 'iri-reference':
          return 'must be a valid IRI reference';
        case 'uuid':
          return 'must be a valid UUID';
        case 'json-pointer':
          return 'must be a valid JSON Pointer';
        case 'relative-json-pointer':
          return 'must be a valid relative JSON Pointer';
        case 'regex':
          return 'must be a valid regular expression';
        case 'cid':
          return 'must be a valid IPFS Content Identifier (CID)';
        case 'currency':
          return 'must be a positive number with at most 2 decimal places';
        case 'ipfs_uri':
          return 'must be a valid IPFS URI in format ipfs://[CID] with CIDv1 using raw codec and sha256';
        case 'rate_percent':
          return 'must be a percentage rate with exactly 3 decimal places (e.g., "12.345")';
        default:
          return `must match format "${format}"`;
      }
    }

    // Enhanced error messages for other common validation errors
    if (error.keyword === 'required' && error.params?.missingProperty) {
      return `missing required property '${error.params.missingProperty}'`;
    } else if (
      error.keyword === 'additionalProperties' &&
      error.params?.additionalProperty
    ) {
      return `unexpected property '${error.params.additionalProperty}'`;
    } else if (error.keyword === 'type' && error.params?.type) {
      return `must be ${error.params.type}`;
    } else if (error.keyword === 'enum' && error.params?.allowedValues) {
      return `must be one of: ${error.params.allowedValues.join(', ')}`;
    }

    return baseMessage;
  }

  /**
   * Get a human-readable error message from validation errors
   */
  getErrorMessages(errors: ValidationError[]): string[] {
    if (!errors || errors.length === 0) {
      return ['Unknown validation error'];
    }

    return errors.map((error) => {
      const path = error.path || 'root';
      const message = error.message || 'Validation failed';

      return `${path}: ${message}`;
    });
  }

  /**
   * Check if a schema allows CID links (has type: 'string' and cid property)
   */
  private isCIDLinkSchema(schema: any): boolean {
    if (
      !schema ||
      typeof schema !== 'object' ||
      !schema.cid ||
      typeof schema.cid !== 'string'
    ) {
      return false;
    }

    // Handle both single type and array of types
    if (schema.type === 'string') {
      return true;
    }

    // Handle array of types (e.g., ['string', 'null'])
    if (Array.isArray(schema.type) && schema.type.includes('string')) {
      return true;
    }

    return false;
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
