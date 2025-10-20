/**
 * Multi-Request Flow Loader
 *
 * This module provides utilities for loading and validating multi-request flow
 * configurations from JSON files using Zod for schema validation.
 */

import { promises as fs } from 'fs';
import { z } from 'zod';
import { logger } from '../../utils/logger.js';
import { MultiRequestFlow } from './types.js';

/**
 * Zod schema for HTTP request headers
 */
const headersSchema = z
  .object({
    'content-type': z
      .enum([
        'application/json',
        'application/x-www-form-urlencoded',
        'text/xml',
      ])
      .nullable()
      .optional(),
  })
  .catchall(z.union([z.string(), z.null(), z.undefined()]))
  .optional();

/**
 * Zod schema for multiValueQueryString
 */
const multiValueQueryStringSchema = z
  .record(z.string(), z.array(z.string()))
  .optional();

/**
 * Base schema for HTTP request definition
 */
const httpRequestBaseSchema = z.object({
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH']),
  url: z
    .string()
    .min(1)
    .regex(/^https?:\/\//, {
      message: 'URL must start with http:// or https://',
    }),
  headers: headersSchema,
  multiValueQueryString: multiValueQueryStringSchema,
  json: z.union([z.record(z.unknown()), z.array(z.unknown())]).optional(),
  body: z.string().optional(),
});

/**
 * Refined schema with custom validation logic for complex rules
 */
const httpRequestSchema = httpRequestBaseSchema
  .refine(
    (data) => {
      // GET requests cannot have body, json, or headers
      if (data.method === 'GET') {
        return !data.body && !data.json && !data.headers;
      }
      return true;
    },
    {
      message: 'GET requests cannot have body, json, or headers',
    }
  )
  .refine(
    (data) => {
      // Cannot have both json and body
      return !(data.json !== undefined && data.body !== undefined);
    },
    {
      message: 'Cannot have both json and body fields',
    }
  )
  .refine(
    (data) => {
      // json requires application/json content-type
      if (data.json !== undefined) {
        return data.headers?.['content-type'] === 'application/json';
      }
      return true;
    },
    {
      message: 'json body requires content-type: application/json',
    }
  )
  .refine(
    (data) => {
      // body requires non-json content-type
      if (data.body !== undefined) {
        const contentType = data.headers?.['content-type'];
        return contentType && contentType !== 'application/json';
      }
      return true;
    },
    {
      message:
        'body field requires content-type header to be set (and not application/json)',
    }
  )
  .refine(
    (data) => {
      // POST/PUT/PATCH with application/json require json field
      if (['POST', 'PUT', 'PATCH'].includes(data.method)) {
        if (data.headers?.['content-type'] === 'application/json') {
          return data.json !== undefined;
        }
      }
      return true;
    },
    {
      message:
        'POST/PUT/PATCH with content-type: application/json requires json field',
    }
  )
  .refine(
    (data) => {
      // POST/PUT/PATCH with non-json content-type require body field
      if (['POST', 'PUT', 'PATCH'].includes(data.method)) {
        const contentType = data.headers?.['content-type'];
        if (contentType && contentType !== 'application/json') {
          return data.body !== undefined;
        }
      }
      return true;
    },
    {
      message: 'POST/PUT/PATCH with non-json content-type requires body field',
    }
  );

/**
 * Zod schema for named HTTP request
 */
const namedHttpRequestSchema = z.object({
  key: z.string().min(1, { message: 'Request key cannot be empty' }),
  request: httpRequestSchema,
});

/**
 * Zod schema for multi-request flow
 */
const multiRequestFlowSchema = z
  .object({
    requests: z
      .array(namedHttpRequestSchema)
      .min(1, { message: 'Multi-request flow must have at least one request' }),
  })
  .refine(
    (data) => {
      // Check for duplicate keys
      const keys = data.requests.map((r) => r.key);
      const uniqueKeys = new Set(keys);
      return keys.length === uniqueKeys.size;
    },
    (data) => {
      // Find the first duplicate key for error message
      const keys = data.requests.map((r) => r.key);
      const seen = new Set<string>();
      for (const key of keys) {
        if (seen.has(key)) {
          return {
            message: `Duplicate request key: "${key}"`,
          };
        }
        seen.add(key);
      }
      return { message: 'Duplicate request keys found' };
    }
  );

/**
 * Loads and validates a multi-request flow configuration from a JSON file.
 *
 * @param filePath - Path to the JSON file containing the flow configuration
 * @returns Validated multi-request flow configuration
 * @throws Error if file cannot be read or validation fails
 */
export async function loadMultiRequestFlow(
  filePath: string
): Promise<MultiRequestFlow> {
  logger.info(`Loading multi-request flow from: ${filePath}`);

  let content: string;
  try {
    content = await fs.readFile(filePath, 'utf-8');
  } catch (error) {
    throw new Error(
      `Failed to read multi-request flow file: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  let flow: unknown;
  try {
    flow = JSON.parse(content);
  } catch (error) {
    throw new Error(
      `Failed to parse multi-request flow JSON: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  if (typeof flow !== 'object' || flow === null) {
    throw new Error('Multi-request flow must be a JSON object');
  }

  // Validate using Zod schema
  const result = multiRequestFlowSchema.safeParse(flow);

  if (!result.success) {
    // Format Zod errors for better readability
    const errors = result.error.issues.map((issue) => {
      const path = issue.path.join('.');
      return path ? `${path}: ${issue.message}` : issue.message;
    });
    throw new Error(
      `Multi-request flow validation failed:\n  - ${errors.join('\n  - ')}`
    );
  }

  logger.info(
    `Successfully loaded multi-request flow with ${result.data.requests.length} request(s)`
  );

  return result.data;
}
