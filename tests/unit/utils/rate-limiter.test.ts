import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RateLimiter } from '../../../src/utils/rate-limiter.js';

describe('RateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should allow requests up to the rate limit immediately', async () => {
    const limiter = new RateLimiter(500); // 500 requests per minute

    const startTime = Date.now();

    // Should be able to make 5 requests immediately
    for (let i = 0; i < 5; i++) {
      await limiter.waitForToken();
    }

    const endTime = Date.now();
    expect(endTime - startTime).toBe(0); // No delay for initial requests
  });

  it('should enforce rate limit for burst requests', async () => {
    const limiter = new RateLimiter(60); // 60 requests per minute = 1 per second

    // First request should be immediate
    await limiter.waitForToken();

    // Check tokens are depleted
    expect(Math.floor(limiter.getAvailableTokens())).toBe(59);

    // Second request should wait since we need to wait 1000ms for next token
    const startTime = Date.now();
    const waitPromise = limiter.waitForToken();

    // Fast-forward time by 999ms (not quite 1 second)
    vi.advanceTimersByTime(999);

    // Check promise hasn't resolved yet
    const race = await Promise.race([
      waitPromise.then(() => 'resolved'),
      Promise.resolve('pending'),
    ]);
    expect(race).toBe('pending');

    // Fast-forward the remaining time needed
    vi.advanceTimersByTime(100); // Give a bit extra to ensure it resolves

    // Now it should resolve
    await waitPromise;
    const endTime = Date.now();
    expect(endTime - startTime).toBeGreaterThanOrEqual(1000);
  });

  it('should correctly calculate available tokens', async () => {
    const limiter = new RateLimiter(500); // 500 requests per minute

    // Initially should have full tokens
    expect(limiter.getAvailableTokens()).toBe(500);

    // Use a token
    await limiter.waitForToken();
    expect(Math.floor(limiter.getAvailableTokens())).toBe(499);

    // Fast-forward 120ms (time for 1 token to regenerate at 500/min rate)
    vi.advanceTimersByTime(120);
    expect(Math.floor(limiter.getAvailableTokens())).toBe(500);
  });

  it('should handle rate limit of 500 requests per minute correctly', async () => {
    const limiter = new RateLimiter(500);

    // Use all 500 tokens
    for (let i = 0; i < 500; i++) {
      await limiter.waitForToken();
    }

    // 501st request should have to wait
    const waitStart = Date.now();
    const waitPromise = limiter.waitForToken();

    // Should need to wait ~120ms for next token (60000ms / 500 = 120ms)
    vi.advanceTimersByTime(119);
    await Promise.resolve();

    // Should still be waiting
    let resolved = false;
    waitPromise.then(() => {
      resolved = true;
    });
    await Promise.resolve();
    expect(resolved).toBe(false);

    // Advance remaining time
    vi.advanceTimersByTime(1);
    await waitPromise;

    const waitEnd = Date.now();
    expect(waitEnd - waitStart).toBeGreaterThanOrEqual(120);
  });

  it('should accumulate tokens over time up to max', async () => {
    const limiter = new RateLimiter(60); // 60 per minute = 1 per second

    // Use all tokens
    for (let i = 0; i < 60; i++) {
      await limiter.waitForToken();
    }

    expect(Math.floor(limiter.getAvailableTokens())).toBe(0);

    // Wait 30 seconds
    vi.advanceTimersByTime(30000);

    // Should have accumulated 30 tokens
    expect(Math.floor(limiter.getAvailableTokens())).toBe(30);

    // Wait another 40 seconds (total 70 seconds)
    vi.advanceTimersByTime(40000);

    // Should be capped at max tokens (60)
    expect(limiter.getAvailableTokens()).toBe(60);
  });
});
