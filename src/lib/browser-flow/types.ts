import { Workflow } from '../withBrowserFlow.js';

// Define the expected context properties for browser flow
export interface BrowserFlowContext {
  url: string;
  requestId?: string;
  [key: string]: any; // Allow additional context properties
}

// Define the browser flow parameters more specifically
export interface BrowserFlowParameters {
  [key: string]: string | number | boolean | undefined;
}

export interface BrowserFlowTemplate {
  id: string;
  name: string;
  description: string;
  parametersSchema: ParametersSchema;
  createWorkflow: (
    params: BrowserFlowParameters,
    context?: BrowserFlowContext
  ) => Workflow;
}

export interface ParametersSchema {
  type: 'object';
  properties: Record<string, ParameterDefinition>;
  required: string[];
}

export interface ParameterDefinition {
  type: 'string' | 'number' | 'boolean';
  description: string;
  default?: any;
  pattern?: string;
  minLength?: number;
  maxLength?: number;
}

export interface ValidationResult {
  valid: boolean;
  errors?: string[];
}
