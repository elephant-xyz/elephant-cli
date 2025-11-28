// Main exports for the Elephant CLI library
export { generateTransform } from './commands.js';
export { transform } from './commands.js';
export { validate } from './commands.js';
export { hash } from './commands.js';
export { upload } from './commands.js';
export { submitToContract } from './commands.js';
export { checkGasPrice } from './commands.js';
export { prepare } from './prepare.js';

// Export types
export type {
  GenerateTransformOptions,
  GenerateTransformResult,
  TransformOptions,
  TransformResult,
  TransformFailureDetail,
  ValidateOptions,
  ValidateResult,
  HashOptions,
  HashResult,
  UploadOptions,
  UploadResult,
  SubmitToContractOptions,
  SubmitToContractResult,
  CheckGasPriceOptions,
  CheckGasPriceResult,
} from './commands.js';

export type { PrepareOptions } from './types.js';

// Export gas price types
export type { GasPriceInfo } from '../services/gas-price.service.js';
