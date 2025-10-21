import { describe, it, expect } from 'vitest';

describe('transform - source_http_request preservation logic', () => {
  /**
   * This function mimics the logic in transform/index.ts lines 574-581
   * for determining whether to overwrite source_http_request
   */
  function shouldPreserveSourceHttpRequest(existingValue: any): boolean {
    return !(
      !existingValue ||
      existingValue === null ||
      (typeof existingValue === 'object' &&
        Object.keys(existingValue).length === 0)
    );
  }

  describe('shouldPreserveSourceHttpRequest logic', () => {
    it('returns false for undefined (should overwrite)', () => {
      expect(shouldPreserveSourceHttpRequest(undefined)).toBe(false);
    });

    it('returns false for null (should overwrite)', () => {
      expect(shouldPreserveSourceHttpRequest(null)).toBe(false);
    });

    it('returns false for empty object (should overwrite)', () => {
      expect(shouldPreserveSourceHttpRequest({})).toBe(false);
    });

    it('returns true for valid source_http_request with url (should preserve)', () => {
      const validRequest = {
        method: 'GET',
        url: 'https://example.com/api',
        multiValueQueryString: { id: ['123'] },
      };
      expect(shouldPreserveSourceHttpRequest(validRequest)).toBe(true);
    });

    it('returns true for source_http_request with POST and json body (should preserve)', () => {
      const validRequest = {
        method: 'POST',
        url: 'https://example.com/api',
        headers: {
          'content-type': 'application/json',
        },
        json: {
          parid: '123',
        },
      };
      expect(shouldPreserveSourceHttpRequest(validRequest)).toBe(true);
    });

    it('returns true for source_http_request with minimal valid fields (should preserve)', () => {
      const validRequest = {
        method: 'GET',
        url: 'https://example.com/api',
      };
      expect(shouldPreserveSourceHttpRequest(validRequest)).toBe(true);
    });

    it('returns true for source_http_request with only url field (should preserve)', () => {
      const validRequest = {
        url: 'https://example.com/api',
      };
      expect(shouldPreserveSourceHttpRequest(validRequest)).toBe(true);
    });

    it('returns true for source_http_request with multiValueQueryString (should preserve)', () => {
      const validRequest = {
        method: 'GET',
        url: 'https://example.com/api',
        multiValueQueryString: {
          parid: ['123'],
          type: ['property', 'land'],
        },
      };
      expect(shouldPreserveSourceHttpRequest(validRequest)).toBe(true);
    });

    it('returns false for falsy string (should overwrite)', () => {
      expect(shouldPreserveSourceHttpRequest('')).toBe(false);
    });

    it('returns false for zero (should overwrite)', () => {
      expect(shouldPreserveSourceHttpRequest(0)).toBe(false);
    });

    it('returns true for non-empty string (edge case - should preserve)', () => {
      // This is an edge case - if someone set source_http_request to a string,
      // we preserve it rather than overwriting
      expect(shouldPreserveSourceHttpRequest('some value')).toBe(true);
    });

    it('returns true for array (edge case - should preserve)', () => {
      // Edge case - arrays are preserved (though not expected)
      expect(shouldPreserveSourceHttpRequest([1, 2, 3])).toBe(true);
    });
  });

  describe('transformation scenarios', () => {
    it('scenario: transformation script provides source_http_request', () => {
      const seedValue = {
        method: 'GET',
        url: 'https://example.com/search',
        multiValueQueryString: { id: ['123'] },
      };

      const scriptValue = {
        method: 'POST',
        url: 'https://example.com/api/owner',
        multiValueQueryString: { parid: ['123'] },
      };

      // Script provided a value, so we should preserve it
      expect(shouldPreserveSourceHttpRequest(scriptValue)).toBe(true);

      // The result should be the script value (not seed value)
      const result = shouldPreserveSourceHttpRequest(scriptValue)
        ? scriptValue
        : seedValue;
      expect(result).toEqual(scriptValue);
    });

    it('scenario: transformation script omits source_http_request', () => {
      const seedValue = {
        method: 'GET',
        url: 'https://example.com/search',
        multiValueQueryString: {},
      };

      const scriptValue = undefined;

      // Script didn't provide a value, so we should use seed
      expect(shouldPreserveSourceHttpRequest(scriptValue)).toBe(false);

      const result = shouldPreserveSourceHttpRequest(scriptValue)
        ? scriptValue
        : seedValue;
      expect(result).toEqual(seedValue);
    });

    it('scenario: transformation script sets null explicitly', () => {
      const seedValue = {
        method: 'GET',
        url: 'https://example.com/search',
        multiValueQueryString: {},
      };

      const scriptValue = null;

      // Script set null, so we should use seed
      expect(shouldPreserveSourceHttpRequest(scriptValue)).toBe(false);

      const result = shouldPreserveSourceHttpRequest(scriptValue)
        ? scriptValue
        : seedValue;
      expect(result).toEqual(seedValue);
    });

    it('scenario: transformation script sets empty object', () => {
      const seedValue = {
        method: 'GET',
        url: 'https://example.com/search',
        multiValueQueryString: {},
      };

      const scriptValue = {};

      // Script set empty object, so we should use seed
      expect(shouldPreserveSourceHttpRequest(scriptValue)).toBe(false);

      const result = shouldPreserveSourceHttpRequest(scriptValue)
        ? scriptValue
        : seedValue;
      expect(result).toEqual(seedValue);
    });

    it('scenario: multi-request flow with different endpoints per class', () => {
      const seedValue = {
        method: 'GET',
        url: 'https://example.com/search',
        multiValueQueryString: {},
      };

      const ownerValue = {
        method: 'POST',
        url: 'https://example.com/api/owner',
        multiValueQueryString: { parid: ['123'] },
      };

      const salesValue = {
        method: 'GET',
        url: 'https://example.com/api/sales',
        multiValueQueryString: { parid: ['123'] },
      };

      const taxValue = {
        method: 'GET',
        url: 'https://example.com/api/tax',
        multiValueQueryString: { parid: ['123'] },
      };

      // All script values should be preserved
      expect(shouldPreserveSourceHttpRequest(ownerValue)).toBe(true);
      expect(shouldPreserveSourceHttpRequest(salesValue)).toBe(true);
      expect(shouldPreserveSourceHttpRequest(taxValue)).toBe(true);

      // Each should keep its own value
      expect(
        shouldPreserveSourceHttpRequest(ownerValue) ? ownerValue : seedValue
      ).toEqual(ownerValue);
      expect(
        shouldPreserveSourceHttpRequest(salesValue) ? salesValue : seedValue
      ).toEqual(salesValue);
      expect(
        shouldPreserveSourceHttpRequest(taxValue) ? taxValue : seedValue
      ).toEqual(taxValue);
    });
  });
});
