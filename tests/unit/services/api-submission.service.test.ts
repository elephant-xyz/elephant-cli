import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApiSubmissionService } from '../../../src/services/api-submission.service.js';
import { EIP1474Transaction } from '../../../src/types/submit.types.js';

// Mock fetch globally
global.fetch = vi.fn();

describe('ApiSubmissionService', () => {
  let service: ApiSubmissionService;
  const mockDomain = 'oracles.staircaseapi.com';
  const mockApiKey = 'test-api-key';
  const mockOracleKeyId = '550e8400-e29b-41d4-a716-446655440000';

  beforeEach(() => {
    vi.clearAllMocks();
    service = new ApiSubmissionService(mockDomain, mockApiKey, mockOracleKeyId);
  });

  describe('constructor', () => {
    it('should add https:// prefix if not provided', () => {
      const service1 = new ApiSubmissionService(
        'example.com',
        mockApiKey,
        mockOracleKeyId
      );
      expect(service1['baseUrl']).toBe('https://example.com');
    });

    it('should upgrade http to https', () => {
      const service2 = new ApiSubmissionService(
        'http://example.com',
        mockApiKey,
        mockOracleKeyId
      );
      expect(service2['baseUrl']).toBe('https://example.com');
    });

    it('should keep https:// if already provided', () => {
      const service3 = new ApiSubmissionService(
        'https://example.com',
        mockApiKey,
        mockOracleKeyId
      );
      expect(service3['baseUrl']).toBe('https://example.com');
    });
  });

  describe('submitTransaction', () => {
    const mockUnsignedTx: EIP1474Transaction = {
      from: '0x1234567890123456789012345678901234567890',
      to: '0x0987654321098765432109876543210987654321',
      gas: '0x5208',
      value: '0x0',
      data: '0x',
      nonce: '0x0',
      type: '0x2',
      maxFeePerGas: '0x59682f00',
      maxPriorityFeePerGas: '0x3b9aca00',
    };

    it('should successfully submit a transaction', async () => {
      const mockResponse = { transaction_hash: '0xabcdef1234567890' };
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await service.submitTransaction(mockUnsignedTx, 0);

      expect(result).toEqual(mockResponse);
      expect(global.fetch).toHaveBeenCalledWith(
        'https://oracles.staircaseapi.com/oracles/submit-data',
        {
          method: 'POST',
          headers: {
            'x-api-key': mockApiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            oracle_key_id: mockOracleKeyId,
            unsigned_transaction: [mockUnsignedTx],
          }),
        }
      );
    });

    it('should retry on failure', async () => {
      vi.useFakeTimers();
      (global.fetch as any)
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ transaction_hash: '0xabcdef1234567890' }),
        });

      const promise = service.submitTransaction(mockUnsignedTx, 0);

      // Advance timer for first retry delay (1 second)
      await vi.advanceTimersByTimeAsync(1000);

      const result = await promise;

      expect(result.transaction_hash).toBe('0xabcdef1234567890');
      expect(global.fetch).toHaveBeenCalledTimes(2);
      vi.useRealTimers();
    });

    it('should throw after max retries', async () => {
      vi.useFakeTimers();
      (global.fetch as any).mockRejectedValue(new Error('Network error'));

      const promise = service
        .submitTransaction(mockUnsignedTx, 0)
        .catch((e) => e);

      // Advance timers for all retry delays
      for (let i = 0; i < 6; i++) {
        await vi.advanceTimersByTimeAsync(1000 * Math.pow(2, i));
      }

      const error = await promise;
      expect(error).toBeInstanceOf(Error);
      expect(error.message).toBe(
        'Failed to submit batch 1 after 7 attempts: Network error'
      );

      expect(global.fetch).toHaveBeenCalledTimes(7);
      vi.useRealTimers();
    });

    it('should handle API error responses', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => 'Bad Request: Invalid oracle key',
      });

      await expect(
        service.submitTransaction(mockUnsignedTx, 0)
      ).rejects.toThrow(
        'API request failed with status 400: Bad Request: Invalid oracle key'
      );
    });

    it('should handle missing transaction_hash in response', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({}), // Missing transaction_hash
      });

      await expect(
        service.submitTransaction(mockUnsignedTx, 0)
      ).rejects.toThrow('API response missing transaction_hash');
    });
  });
});
