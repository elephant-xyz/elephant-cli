import { env } from 'process';

export interface GenerateTransformConfig {
  modelName: string;
  temperature: number;
  nodeTimeoutMs: number;
  recursionLimit: number;
  retryMaxAttempts: number;
  maxStreamingEvents: number;
  hangInactivityMs: number;
}

export const defaultGenerateTransformConfig: GenerateTransformConfig = {
  modelName: env.MODEL_NAME || 'gpt-5',
  temperature: Number(env.TEMPERATURE || 1),
  nodeTimeoutMs: Number(env.NODE_TIMEOUT_MS || 60000),
  recursionLimit: Number(env.RECURSION_LIMIT || 500),
  retryMaxAttempts: Number(env.RETRY_MAX_ATTEMPTS || 3),
  maxStreamingEvents: Number(env.MAX_STREAMING_EVENTS || 5000),
  hangInactivityMs: Number(env.HANG_INACTIVITY_MS || 120000),
};

export type RequiredInputPaths = {
  unnormalizedPath: string;
  seedPath: string;
  htmlPath: string;
};
