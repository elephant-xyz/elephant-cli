import { logger } from './logger.js';

/**
 * Token bucket rate limiter for controlling API request rates.
 * Ensures requests don't exceed the specified rate limit.
 */
export class RateLimiter {
  private tokens: number;
  private readonly maxTokens: number;
  private readonly refillRate: number; // tokens per millisecond
  private lastRefill: number;
  private readonly minInterval: number; // minimum interval between requests in ms

  /**
   * Create a new rate limiter
   * @param requestsPerMinute Maximum number of requests allowed per minute
   */
  constructor(requestsPerMinute: number) {
    this.maxTokens = requestsPerMinute;
    this.tokens = this.maxTokens;
    this.refillRate = requestsPerMinute / 60000; // convert to tokens per ms
    this.minInterval = 60000 / requestsPerMinute; // minimum ms between requests
    this.lastRefill = Date.now();

    logger.debug(
      `RateLimiter initialized: ${requestsPerMinute} requests/min, ${this.minInterval.toFixed(2)}ms min interval`
    );
  }

  /**
   * Wait until a request can be made within the rate limit
   * @returns Promise that resolves when the request can proceed
   */
  async waitForToken(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRefill = now - this.lastRefill;

    // Refill tokens based on time elapsed
    const tokensToAdd = timeSinceLastRefill * this.refillRate;

    this.tokens = Math.min(this.tokens + tokensToAdd, this.maxTokens);
    this.lastRefill = now;

    if (this.tokens >= 1) {
      // We have a token available
      this.tokens -= 1;
      logger.debug(
        `RateLimiter: Token consumed, ${Math.floor(this.tokens)} tokens remaining`
      );
      return;
    }

    // Calculate how long to wait for the next token
    const waitTime = Math.ceil((1 - this.tokens) / this.refillRate);

    logger.debug(
      `RateLimiter: Waiting ${waitTime}ms for next token (${this.tokens.toFixed(2)} tokens available)`
    );

    await new Promise((resolve) => setTimeout(resolve, waitTime));

    // After waiting, consume the token that should now be available
    // The token counter already reflects the state before waiting, so we just need to consume 1 token
    this.tokens = Math.max(0, this.tokens + 1 - 1); // Added the waited token, then consumed it
    this.lastRefill = Date.now();
  }

  /**
   * Get current token count (for debugging/monitoring)
   */
  getAvailableTokens(): number {
    const now = Date.now();
    const timeSinceLastRefill = now - this.lastRefill;
    const tokensToAdd = Math.min(
      timeSinceLastRefill * this.refillRate,
      this.maxTokens - this.tokens
    );

    return Math.min(this.tokens + tokensToAdd, this.maxTokens);
  }
}
