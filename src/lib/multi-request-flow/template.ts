/**
 * Template Replacement Utilities
 *
 * This module provides utilities for replacing template variables (like {{=it.request_identifier}})
 * in HTTP request definitions with actual values using doT.js template engine.
 */

import dot from 'dot';
import { HttpRequestDefinition } from './types.js';

/**
 * Replaces template variables in a string using doT.js template engine.
 * Supports {{=it.request_identifier}} syntax (same as browser flows).
 *
 * @param template - String that may contain template variables
 * @param requestIdentifier - The actual request identifier value
 * @returns String with template variables replaced
 */
export function replaceInString(
  template: string,
  requestIdentifier: string
): string {
  if (template.includes('=it.')) {
    return dot.template(template)({ request_identifier: requestIdentifier });
  }
  return template;
}

/**
 * Recursively replaces template variables in JSON-compatible values.
 * Handles objects, arrays, strings, and primitive types.
 *
 * @param value - Any JSON-compatible value
 * @param requestIdentifier - The actual request identifier value
 * @returns Value with all template variables replaced
 */
export function replaceInValue(
  value: unknown,
  requestIdentifier: string
): unknown {
  if (typeof value === 'string') {
    return replaceInString(value, requestIdentifier);
  }

  if (Array.isArray(value)) {
    return value.map((item) => replaceInValue(item, requestIdentifier));
  }

  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      result[key] = replaceInValue(val, requestIdentifier);
    }
    return result;
  }

  return value;
}

/**
 * Replaces template variables in multiValueQueryString.
 *
 * @param mvqs - Multi-value query string object
 * @param requestIdentifier - The actual request identifier value
 * @returns New object with template variables replaced
 */
export function replaceInMultiValueQueryString(
  mvqs: Record<string, string[]>,
  requestIdentifier: string
): Record<string, string[]> {
  const result: Record<string, string[]> = {};

  for (const [key, values] of Object.entries(mvqs)) {
    result[key] = values.map((v) => replaceInString(v, requestIdentifier));
  }

  return result;
}

/**
 * Replaces template variables in headers object.
 *
 * @param headers - Headers object
 * @param requestIdentifier - The actual request identifier value
 * @returns New headers object with template variables replaced
 */
export function replaceInHeaders(
  headers: Record<string, string | null | undefined>,
  requestIdentifier: string
): Record<string, string | null | undefined> {
  const result: Record<string, string | null | undefined> = {};

  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === 'string') {
      result[key] = replaceInString(value, requestIdentifier);
    } else {
      result[key] = value;
    }
  }

  return result;
}

/**
 * Replaces all template variables in an HTTP request definition.
 * Creates a new request object with all template variables replaced.
 *
 * @param request - HTTP request definition that may contain template variables
 * @param requestIdentifier - The actual request identifier value to substitute
 * @returns New request definition with all template variables replaced
 */
export function replaceTemplateVariables(
  request: HttpRequestDefinition,
  requestIdentifier: string
): HttpRequestDefinition {
  const result: HttpRequestDefinition = {
    method: request.method,
    url: replaceInString(request.url, requestIdentifier),
  };

  if (request.headers) {
    result.headers = replaceInHeaders(request.headers, requestIdentifier);
  }

  if (request.multiValueQueryString) {
    result.multiValueQueryString = replaceInMultiValueQueryString(
      request.multiValueQueryString,
      requestIdentifier
    );
  }

  if (request.json !== undefined) {
    result.json = replaceInValue(request.json, requestIdentifier) as
      | Record<string, unknown>
      | unknown[];
  }

  if (request.body !== undefined) {
    result.body = replaceInString(request.body, requestIdentifier);
  }

  return result;
}
