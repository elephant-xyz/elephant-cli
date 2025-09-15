// Main exports for the Elephant CLI library
export { transform } from './commands.js';
export { validate } from './commands.js';
export { hash } from './commands.js';
export { upload } from './commands.js';
export { submitToContract } from './commands.js';
export { prepare } from './prepare.js';

// Export types
export type {
  TransformOptions,
  TransformResult,
  ValidateOptions,
  ValidateResult,
  HashOptions,
  HashResult,
  UploadOptions,
  UploadResult,
  SubmitToContractOptions,
  SubmitToContractResult,
} from './commands.js';

export type { PrepareOptions } from './types.js';
