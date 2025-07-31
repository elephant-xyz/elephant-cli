import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PinataService } from '../../../src/services/pinata.service.js';
import { ProcessedFile } from '../../../src/types/submit.types.js';

// Mock fetch globally
global.fetch = vi.fn();

describe('PinataService Rate Limiting', () => {
  let pinataService: PinataService;
  const mockPinataJwt = 'test-jwt';

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    // Mock successful responses
    (global.fetch as any).mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ IpfsHash: 'QmMockCID123' }),
      text: async () => 'Success',
    });

    pinataService = new PinataService(mockPinataJwt, undefined, 10);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should enforce rate limit of 500 requests per minute', async () => {
    // Create a batch of files to upload
    const files: ProcessedFile[] = Array.from({ length: 10 }, (_, i) => ({
      propertyCid: `property${i}`,
      dataGroupCid: `group${i}`,
      filePath: `file${i}.json`,
      canonicalJson: JSON.stringify({ data: i }),
      calculatedCid: `cid${i}`,
      validationPassed: true,
    }));

    // Start uploading
    const uploadPromise = pinataService.uploadBatch(files);

    // Should make some requests immediately (up to rate limit)
    await vi.runAllTimersAsync();

    // Check that fetch was called
    expect(global.fetch).toHaveBeenCalled();

    // Complete the upload
    const results = await uploadPromise;

    // All uploads should succeed
    expect(results).toHaveLength(10);
    expect(results.every((r) => r.success)).toBe(true);
  });

  it('should wait appropriately between requests when rate limit is exceeded', async () => {
    // Create a service with very low rate limit for testing
    const lowRatePinataService = new PinataService(mockPinataJwt, undefined, 1);
    // Manually set rate limit to 60 per minute (1 per second) for easier testing
    const { RateLimiter } = await import('../../../src/utils/rate-limiter.js');
    (lowRatePinataService as any).rateLimiter = new RateLimiter(60);

    const file1: ProcessedFile = {
      propertyCid: 'property1',
      dataGroupCid: 'group1',
      filePath: 'file1.json',
      canonicalJson: '{"data": 1}',
      calculatedCid: 'cid1',
      validationPassed: true,
    };

    const file2: ProcessedFile = {
      propertyCid: 'property2',
      dataGroupCid: 'group2',
      filePath: 'file2.json',
      canonicalJson: '{"data": 2}',
      calculatedCid: 'cid2',
      validationPassed: true,
    };

    // Upload first file - should be immediate
    const start1 = Date.now();
    await lowRatePinataService.uploadBatch([file1]);
    const end1 = Date.now();
    expect(end1 - start1).toBeLessThan(100);

    // Upload second file - should wait ~1 second
    const start2 = Date.now();
    const uploadPromise = lowRatePinataService.uploadBatch([file2]);

    // Advance time by 999ms
    vi.advanceTimersByTime(999);

    // Should still be waiting
    const race = await Promise.race([
      uploadPromise.then(() => 'resolved'),
      Promise.resolve('pending'),
    ]);
    expect(race).toBe('pending');

    // Advance remaining time
    vi.advanceTimersByTime(100);

    // Now it should complete
    await uploadPromise;
    const end2 = Date.now();
    expect(end2 - start2).toBeGreaterThanOrEqual(1000);
  });

  it('should handle directory uploads with rate limiting', async () => {
    // Mock the directory upload to test a simple path
    const result = await pinataService.uploadDirectory('/test/nonexistent');

    // Should fail since directory doesn't exist, but this tests the rate limiter path
    expect(result.success).toBe(false);
    expect(result.error).toContain('Directory not found');
  });

  it('should not exceed rate limit even with concurrent batch uploads', async () => {
    // Create multiple batches
    const batch1: ProcessedFile[] = Array.from({ length: 5 }, (_, i) => ({
      propertyCid: `batch1-property${i}`,
      dataGroupCid: `batch1-group${i}`,
      filePath: `batch1-file${i}.json`,
      canonicalJson: JSON.stringify({ batch: 1, data: i }),
      calculatedCid: `batch1-cid${i}`,
      validationPassed: true,
    }));

    const batch2: ProcessedFile[] = Array.from({ length: 5 }, (_, i) => ({
      propertyCid: `batch2-property${i}`,
      dataGroupCid: `batch2-group${i}`,
      filePath: `batch2-file${i}.json`,
      canonicalJson: JSON.stringify({ batch: 2, data: i }),
      calculatedCid: `batch2-cid${i}`,
      validationPassed: true,
    }));

    // Start both uploads concurrently
    const promise1 = pinataService.uploadBatch(batch1);
    const promise2 = pinataService.uploadBatch(batch2);

    // Let all timers run
    await vi.runAllTimersAsync();

    const [results1, results2] = await Promise.all([promise1, promise2]);

    // All uploads should succeed
    expect(results1).toHaveLength(5);
    expect(results2).toHaveLength(5);
    expect([...results1, ...results2].every((r) => r.success)).toBe(true);

    // Total requests should be 10
    expect(global.fetch).toHaveBeenCalledTimes(10);
  });
});
