/**
 * Multi-Request Flow Loader
 *
 * This module provides utilities for loading and validating multi-request flow
 * configurations from JSON files.
 */

import { promises as fs } from 'fs';
import { logger } from '../../utils/logger.js';
import {
  MultiRequestFlow,
  NamedHttpRequest,
  HttpRequestDefinition,
} from './types.js';

/**
 * Validates that a value is a valid HTTP method.
 */
function isValidMethod(
  method: unknown
): method is 'GET' | 'POST' | 'PUT' | 'PATCH' {
  return (
    typeof method === 'string' &&
    ['GET', 'POST', 'PUT', 'PATCH'].includes(method)
  );
}

/**
 * Validates that a value is a valid content type.
 */
function isValidContentType(
  contentType: unknown
): contentType is
  | 'application/json'
  | 'application/x-www-form-urlencoded'
  | 'text/xml'
  | null {
  return (
    contentType === null ||
    (typeof contentType === 'string' &&
      [
        'application/json',
        'application/x-www-form-urlencoded',
        'text/xml',
      ].includes(contentType))
  );
}

/**
 * Validates that an HTTP request definition is well-formed according to schema rules.
 *
 * @param request - Request definition to validate
 * @throws Error if validation fails
 */
function validateHttpRequest(request: HttpRequestDefinition): void {
  if (!isValidMethod(request.method)) {
    throw new Error(
      `Invalid HTTP method: ${request.method}. Must be GET, POST, PUT, or PATCH.`
    );
  }

  if (!request.url || typeof request.url !== 'string') {
    throw new Error('Request URL is required and must be a string');
  }

  if (!request.url.match(/^https?:\/\//)) {
    throw new Error('Request URL must start with http:// or https://');
  }

  // Validate GET requests don't have body/json/headers
  if (request.method === 'GET') {
    if (request.body !== undefined) {
      throw new Error('GET requests cannot have a body');
    }
    if (request.json !== undefined) {
      throw new Error('GET requests cannot have a json body');
    }
    if (request.headers !== undefined) {
      throw new Error('GET requests cannot have headers');
    }
  }

  // Validate content-type header if present
  if (request.headers?.['content-type']) {
    const contentType = request.headers['content-type'];
    if (!isValidContentType(contentType)) {
      throw new Error(
        `Invalid content-type: ${contentType}. Must be application/json, application/x-www-form-urlencoded, text/xml, or null.`
      );
    }
  }

  // Validate json body requires application/json content-type
  if (request.json !== undefined) {
    if (!request.headers?.['content-type']) {
      throw new Error('json body requires content-type header to be set');
    }
    if (request.headers['content-type'] !== 'application/json') {
      throw new Error('json body requires content-type: application/json');
    }
    if (request.body !== undefined) {
      throw new Error('Cannot have both json and body fields');
    }
  }

  // Validate body requires non-json content-type
  if (request.body !== undefined) {
    if (!request.headers?.['content-type']) {
      throw new Error('body field requires content-type header to be set');
    }
    if (request.headers['content-type'] === 'application/json') {
      throw new Error(
        'body field cannot be used with content-type: application/json. Use json field instead.'
      );
    }
    if (request.json !== undefined) {
      throw new Error('Cannot have both body and json fields');
    }
  }

  // Validate POST/PUT/PATCH require either body or json
  if (['POST', 'PUT', 'PATCH'].includes(request.method)) {
    if (request.headers?.['content-type'] === 'application/json') {
      if (request.json === undefined) {
        throw new Error(
          `${request.method} request with content-type: application/json requires json field`
        );
      }
    } else if (request.headers?.['content-type']) {
      if (request.body === undefined) {
        throw new Error(
          `${request.method} request with content-type: ${request.headers['content-type']} requires body field`
        );
      }
    }
  }
}

/**
 * Validates that a named HTTP request is well-formed.
 *
 * @param namedRequest - Named request to validate
 * @throws Error if validation fails
 */
function validateNamedRequest(namedRequest: NamedHttpRequest): void {
  if (!namedRequest.key || typeof namedRequest.key !== 'string') {
    throw new Error('Each request must have a non-empty "key" field');
  }

  if (!namedRequest.request || typeof namedRequest.request !== 'object') {
    throw new Error(
      `Request "${namedRequest.key}" must have a "request" object`
    );
  }

  validateHttpRequest(namedRequest.request);
}

/**
 * Validates that a multi-request flow configuration is well-formed.
 *
 * @param flow - Flow configuration to validate
 * @throws Error if validation fails
 */
function validateMultiRequestFlow(flow: MultiRequestFlow): void {
  if (!flow.requests || !Array.isArray(flow.requests)) {
    throw new Error('Multi-request flow must have a "requests" array');
  }

  if (flow.requests.length === 0) {
    throw new Error('Multi-request flow must have at least one request');
  }

  const keys = new Set<string>();
  for (const namedRequest of flow.requests) {
    validateNamedRequest(namedRequest);

    if (keys.has(namedRequest.key)) {
      throw new Error(`Duplicate request key: "${namedRequest.key}"`);
    }
    keys.add(namedRequest.key);
  }
}

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

  validateMultiRequestFlow(flow as MultiRequestFlow);

  logger.info(
    `Successfully loaded multi-request flow with ${(flow as MultiRequestFlow).requests.length} request(s)`
  );

  return flow as MultiRequestFlow;
}
