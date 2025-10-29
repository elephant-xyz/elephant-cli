/**
 * Multi-Request Flow Executor
 *
 * This module executes a multi-request flow by making a sequence of HTTP requests
 * and combining their responses into a single JSON output.
 */

import { logger } from '../../utils/logger.js';
import {
  HttpRequestDefinition,
  HttpRequestResponse,
  MultiRequestFlow,
  MultiRequestFlowOutput,
  MultiRequestFlowResult,
} from './types.js';
import { replaceTemplateVariables } from './template.js';
import { constructUrl, executeFetch } from '../common.js';

/**
 * Attempts to parse a string as JSON. Returns the parsed object/array on success,
 * or the original string if parsing fails.
 *
 * @param content - String content to parse
 * @returns Parsed JSON or original string
 */
function tryParseJson(
  content: string
): Record<string, unknown> | unknown[] | string {
  try {
    const parsed = JSON.parse(content);
    if (typeof parsed === 'object' && parsed !== null) {
      return parsed;
    }
    return content;
  } catch {
    return content;
  }
}

/**
 * Executes a single HTTP request and returns the response data.
 *
 * @param request - HTTP request definition with template variables already replaced
 * @returns Response data (parsed JSON or string)
 */
async function executeRequest(
  request: HttpRequestDefinition
): Promise<Record<string, unknown> | unknown[] | string> {
  const url = constructUrl(request);
  logger.info(`Executing ${request.method} request to: ${url}`);

  const headers: Record<string, string> = {};
  if (request.headers) {
    for (const [key, value] of Object.entries(request.headers)) {
      if (value !== null && value !== undefined) {
        headers[key] = value;
      }
    }
  }

  let body: string | undefined;
  if (request.method !== 'GET') {
    if (request.json !== undefined) {
      body = JSON.stringify(request.json);
      if (!headers['content-type']) {
        headers['content-type'] = 'application/json';
      }
    } else if (request.body !== undefined) {
      body = request.body;
    }
  }

  const { responseText } = await executeFetch(
    url,
    request.method,
    headers,
    body
  );

  return tryParseJson(responseText);
}

/**
 * Normalizes an HTTP request by extracting query parameters from the URL
 * and placing them in the multiValueQueryString object with URL-encoded values.
 *
 * @param request - HTTP request definition
 * @returns Normalized request with URL-encoded query params in multiValueQueryString
 */
function normalizeRequest(
  request: HttpRequestDefinition
): HttpRequestDefinition {
  const url = new URL(request.url);
  const result: HttpRequestDefinition = {
    method: request.method,
    url: `${url.origin}${url.pathname}`,
  };

  if (request.headers) {
    result.headers = request.headers;
  }

  if (request.json !== undefined) {
    result.json = request.json;
  }

  if (request.body !== undefined) {
    result.body = request.body;
  }

  const queryParams: Record<string, string[]> = {};

  if (url.search) {
    for (const [key, value] of url.searchParams.entries()) {
      const encodedValue = encodeURIComponent(value);
      if (!queryParams[key]) {
        queryParams[key] = [];
      }
      queryParams[key].push(encodedValue);
    }
  }

  if (request.multiValueQueryString) {
    for (const [key, values] of Object.entries(request.multiValueQueryString)) {
      const encodedValues = values.map((v) => encodeURIComponent(v));
      if (!queryParams[key]) {
        queryParams[key] = [];
      }
      queryParams[key].push(...encodedValues);
    }
  }

  if (Object.keys(queryParams).length > 0) {
    result.multiValueQueryString = queryParams;
  }

  return result;
}

/**
 * Executes a multi-request flow by making all defined HTTP requests in parallel
 * and combining their responses into a single JSON output.
 *
 * @param flow - Multi-request flow configuration
 * @param requestIdentifier - The request identifier to substitute in templates
 * @returns Combined output with all request responses
 */
export async function executeMultiRequestFlow(
  flow: MultiRequestFlow,
  requestIdentifier: string
): Promise<MultiRequestFlowResult> {
  logger.info(
    `Starting multi-request flow with ${flow.requests.length} request(s)`
  );
  logger.info(`Request identifier: ${requestIdentifier}`);

  const requestPromises = flow.requests.map(async (namedRequest) => {
    logger.info(`Processing request: ${namedRequest.key}`);

    const resolvedRequest = replaceTemplateVariables(
      namedRequest.request,
      requestIdentifier
    );

    const responseData = await executeRequest(resolvedRequest);

    const normalizedRequest = normalizeRequest(resolvedRequest);

    const httpResponse: HttpRequestResponse = {
      source_http_request: normalizedRequest,
      response: responseData,
    };

    logger.info(`Successfully completed request: ${namedRequest.key}`);

    return { key: namedRequest.key, response: httpResponse };
  });

  const results = await Promise.all(requestPromises);

  const output: MultiRequestFlowOutput = {};
  for (const result of results) {
    output[result.key] = result.response;
  }

  logger.info('Multi-request flow completed successfully');

  return {
    content: JSON.stringify(output, null, 2),
    type: 'json',
  };
}
