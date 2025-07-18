import { EIP1474Transaction } from '../types/submit.types.js';
import {
  ApiSubmissionRequest,
  ApiSubmissionResponse,
} from '../types/submit.types.js';
import { logger } from '../utils/logger.js';

export class ApiSubmissionService {
  private domain: string;
  private apiKey: string;
  private oracleKeyId: string;
  private baseUrl: string;
  private maxRetries: number = 3;
  private retryDelay: number = 1000; // 1 second

  constructor(domain: string, apiKey: string, oracleKeyId: string) {
    this.domain = domain;
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
          const apiError = new Error(
            `API request failed with status ${response.status}: ${errorText}`
          );
          // Mark as non-retryable API error
          (apiError as any).isApiError = true;
          throw apiError;
        }

        const result: ApiSubmissionResponse = await response.json();

        if (!result.transaction_hash) {
          const validationError = new Error(
            'API response missing transaction_hash'
          );
          // Mark as non-retryable validation error
          (validationError as any).isApiError = true;
          throw validationError;
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
        if ((error as any).isApiError) {
          throw error;
        }

        if (attempt < this.maxRetries - 1) {
          const delay = this.retryDelay * Math.pow(2, attempt); // Exponential backoff
          logger.info(`Retrying in ${delay / 1000}s...`);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    const errorMsg = `Failed to submit batch ${batchIndex + 1} after ${this.maxRetries} attempts: ${
      lastError?.message || 'Unknown error'
    }`;
    logger.error(errorMsg);
    throw new Error(errorMsg);
  }
}
