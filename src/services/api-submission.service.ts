import { EIP1474Transaction } from '../types/submit.types.js';
import {
  ApiSubmissionRequest,
  ApiSubmissionResponse,
} from '../types/submit.types.js';
import { logger } from '../utils/logger.js';
import { ApiError, NetworkError } from '../utils/errors.js';

export class ApiSubmissionService {
  private apiKey: string;
  private oracleKeyId: string;
  private baseUrl: string;
  private maxRetries: number = 7;
  private retryDelay: number = 1000; // 1 second

  constructor(domain: string, apiKey: string, oracleKeyId: string) {
    this.apiKey = apiKey;
    this.oracleKeyId = oracleKeyId;

    // Ensure domain has https:// prefix
    if (!domain.startsWith('http://') && !domain.startsWith('https://')) {
      this.baseUrl = `https://${domain}`;
    } else if (domain.startsWith('http://')) {
      // Force HTTPS for security
      logger.warn('HTTP domain provided, upgrading to HTTPS for security');
      this.baseUrl = domain.replace('http://', 'https://');
    } else {
      this.baseUrl = domain;
    }

    logger.technical(
      `API Submission Service initialized with domain: ${this.baseUrl}`
    );
  }

  /**
   * Detects if an error is related to nonce issues
   */
  private isNonceError(errorText: string): boolean {
    const lowerText = errorText.toLowerCase();
    return (
      lowerText.includes('nonce') ||
      lowerText.includes('nonce too low') ||
      lowerText.includes('nonce too high') ||
      lowerText.includes('nonce has already been used') ||
      lowerText.includes('replacement transaction underpriced')
    );
  }

  /**
   * Submit an unsigned transaction to the centralized API
   */
  async submitTransaction(
    unsignedTransaction: EIP1474Transaction,
    batchIndex: number
  ): Promise<ApiSubmissionResponse> {
    const url = `${this.baseUrl}/oracles/submit-data`;

    const requestBody: ApiSubmissionRequest = {
      oracle_key_id: this.oracleKeyId,
      unsigned_transaction: [unsignedTransaction], // API expects an array
    };

    logger.info(`Submitting batch ${batchIndex + 1} to API...`);
    logger.technical(`API URL: ${url}`);

    let lastError: Error | undefined;

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'x-api-key': this.apiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
          const errorText = await response.text();
          const isNonceError = this.isNonceError(errorText);
          throw new ApiError(
            `API request failed with status ${response.status}: ${errorText}`,
            response.status,
            isNonceError // Nonce errors are retryable
          );
        }

        const result: ApiSubmissionResponse = await response.json();

        if (!result.transaction_hash) {
          throw new ApiError(
            'API response missing transaction_hash',
            undefined,
            false // Validation errors are not retryable
          );
        }
        logger.success(
          `Batch ${batchIndex + 1} submitted successfully. Transaction hash: ${result.transaction_hash}`
        );

        return result;
      } catch (error) {
        lastError = error as Error;
        logger.warn(
          `API submission attempt ${attempt + 1} failed: ${lastError.message}`
        );

        // Don't retry API errors (4xx, 5xx responses) or validation errors
        if (error instanceof ApiError && !error.isRetryable) {
          throw error;
        }

        if (attempt < this.maxRetries - 1) {
          const isNonceError = this.isNonceError(lastError.message);
          const baseDelay = isNonceError ? 5000 : this.retryDelay; // 5s for nonce errors, 1s for others
          const delay = baseDelay * Math.pow(2, attempt); // Exponential backoff
          logger.info(
            `Retrying in ${delay / 1000}s${isNonceError ? ' (nonce error detected)' : ''}...`
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    const errorMsg = `Failed to submit batch ${batchIndex + 1} after ${this.maxRetries} attempts: ${
      lastError?.message || 'Unknown error'
    }`;
    logger.error(errorMsg);
    throw new NetworkError(errorMsg, false); // Network errors after all retries are not retryable
  }
}
