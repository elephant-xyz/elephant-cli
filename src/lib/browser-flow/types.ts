import { Workflow } from '../withBrowserFlow.js';

export interface BrowserFlowTemplate {
  id: string;
  name: string;
  description: string;
  parametersSchema: ParametersSchema;
  createWorkflow: (
    params: Record<string, any>,
    context?: Record<string, any>
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

export interface BrowserFlowParameters {
  [key: string]: any;
}

export interface ValidationResult {
  valid: boolean;
  errors?: string[];
}
