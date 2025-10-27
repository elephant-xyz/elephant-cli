/**
 * Multi-Request Flow Types
 *
 * This module defines the type system for multi-request flows, which allow
 * fetching property data through a sequence of HTTP requests instead of
 * a single request or browser automation.
 */

/**
 * HTTP request definition with support for various content types and methods.
 * This type represents a single HTTP request that will be executed as part
 * of a multi-request flow.
 */
export type HttpRequestDefinition = {
  /** HTTP method for the request */
  method: 'GET' | 'POST' | 'PUT' | 'PATCH';
  /** The URL endpoint (may contain {{request_identifier}} template variable) */
  url: string;
  /** Optional headers for the request */
  headers?: {
    'content-type'?:
      | 'application/json'
      | 'application/x-www-form-urlencoded'
      | 'text/xml'
      | null;
    [key: string]: string | null | undefined;
  };
  /** Multi-value query string parameters (may contain {{request_identifier}}) */
  multiValueQueryString?: Record<string, string[]>;
  /** JSON body for application/json requests (may contain {{request_identifier}} in nested strings) */
  json?: Record<string, unknown> | unknown[];
  /** String body for non-JSON requests (may contain {{request_identifier}}) */
  body?: string;
};

/**
 * A named HTTP request with a unique key identifier.
 * The key will be used as the property name in the final combined output.
 */
export type NamedHttpRequest = {
  /** Unique identifier for this request (used as key in output) */
  key: string;
  /** The HTTP request definition */
  request: HttpRequestDefinition;
};

/**
 * Multi-request flow configuration.
 * Defines a sequence of HTTP requests to execute for fetching property data.
 */
export type MultiRequestFlow = {
  /** Array of named HTTP requests to execute in sequence */
  requests: NamedHttpRequest[];
};

/**
 * Response data from a single HTTP request execution.
 */
export type HttpRequestResponse = {
  /** The original request definition with template variables resolved */
  source_http_request: HttpRequestDefinition;
  /** The response data (parsed JSON object/array or string content) */
  response: Record<string, unknown> | unknown[] | string;
};

/**
 * Combined output from executing a multi-request flow.
 * Each key corresponds to a request key, and the value contains
 * the request details and response data.
 */
export type MultiRequestFlowOutput = Record<string, HttpRequestResponse>;

/**
 * Result of executing a multi-request flow, including content and type.
 */
export type MultiRequestFlowResult = {
  /** The combined JSON output as a string */
  content: string;
  /** Always 'json' for multi-request flows */
  type: 'json';
};
