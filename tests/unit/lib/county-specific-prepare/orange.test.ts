import { describe, it, expect, afterEach, vi } from 'vitest';
import { fetchOrangeCountyData } from '../../../../src/lib/county-specific-prepare/orange.js';

// Minimal fetch stub matching the shape orange.ts consumes: { ok, status, json }.
// Every PRC/QuickSearch endpoint is answered so the fetcher runs end-to-end;
// only the QuickSearch behavior is varied per test.
type QuickSearchHandler = (pid: string) => {
  ok: boolean;
  status: number;
  body: unknown;
};

function makeFetch(quickSearch: QuickSearchHandler) {
  return vi.fn(async (url: string) => {
    if (url.includes('GetSearchInfoByParcel')) {
      const pid = new URL(url).searchParams.get('pid') ?? '';
      const { ok, status, body } = quickSearch(pid);
      return { ok, status, json: async () => body } as unknown as Response;
    }
    // GetPRCTotalTaxes paginates until taxYear === 0.
    if (url.includes('GetPRCTotalTaxes')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ taxYear: 0 }),
      } as unknown as Response;
    }
    // GetPRCNonAdValorem and all other endpoints stop/accept on an empty array.
    return {
      ok: true,
      status: 200,
      json: async () => [],
    } as unknown as Response;
  });
}

describe('fetchOrangeCountyData', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('parcel id zero-padding', () => {
    it('left-pads a 14-digit seed id to 15 digits before QuickSearch', async () => {
      const mockFetch = makeFetch(() => ({
        ok: true,
        status: 200,
        body: [{ parcelId: 'CANON-1' }],
      }));
      global.fetch = mockFetch as unknown as typeof fetch;

      await fetchOrangeCountyData('12027000000001'); // 14 digits

      const quickSearchCall = mockFetch.mock.calls.find(([u]) =>
        String(u).includes('GetSearchInfoByParcel')
      );
      expect(quickSearchCall).toBeDefined();
      expect(String(quickSearchCall![0])).toContain('pid=012027000000001');
    });

    it('leaves an already-15-digit id unchanged', async () => {
      const mockFetch = makeFetch(() => ({
        ok: true,
        status: 200,
        body: [{ parcelId: 'CANON-1' }],
      }));
      global.fetch = mockFetch as unknown as typeof fetch;

      await fetchOrangeCountyData('012027000000001'); // 15 digits

      const quickSearchCall = mockFetch.mock.calls.find(([u]) =>
        String(u).includes('GetSearchInfoByParcel')
      );
      expect(String(quickSearchCall![0])).toContain('pid=012027000000001');
    });

    it('strips dashes/non-digits then pads', async () => {
      const mockFetch = makeFetch(() => ({
        ok: true,
        status: 200,
        body: [{ parcelId: 'CANON-1' }],
      }));
      global.fetch = mockFetch as unknown as typeof fetch;

      await fetchOrangeCountyData('12-027-000000001'); // dashes + 14 digits

      const quickSearchCall = mockFetch.mock.calls.find(([u]) =>
        String(u).includes('GetSearchInfoByParcel')
      );
      expect(String(quickSearchCall![0])).toContain('pid=012027000000001');
    });

    it('throws when the cleaned id exceeds 15 digits (never truncates)', async () => {
      const mockFetch = makeFetch(() => ({
        ok: true,
        status: 200,
        body: [{ parcelId: 'CANON-1' }],
      }));
      global.fetch = mockFetch as unknown as typeof fetch;

      await expect(
        fetchOrangeCountyData('1234567890123456') // 16 digits
      ).rejects.toThrow(/> 15/);
    });
  });

  describe('retry-on-empty for QuickSearch', () => {
    it('retries when QuickSearch returns an empty array and succeeds on a later attempt', async () => {
      let calls = 0;
      const mockFetch = makeFetch(() => {
        calls += 1;
        if (calls < 3) {
          return { ok: true, status: 200, body: [] }; // transient empty
        }
        return { ok: true, status: 200, body: [{ parcelId: 'CANON-1' }] };
      });
      global.fetch = mockFetch as unknown as typeof fetch;

      const result = await fetchOrangeCountyData('012027000000001');

      expect(calls).toBe(3);
      expect(result.type).toBe('json');
    });

    it('throws not-found only after retries are exhausted', async () => {
      const mockFetch = makeFetch(() => ({ ok: true, status: 200, body: [] }));
      global.fetch = mockFetch as unknown as typeof fetch;

      await expect(fetchOrangeCountyData('012027000000001')).rejects.toThrow(
        /returned empty after 4 attempts/
      );
    });

    it('does not retry genuine HTTP errors', async () => {
      let calls = 0;
      const mockFetch = makeFetch(() => {
        calls += 1;
        return { ok: false, status: 500, body: null };
      });
      global.fetch = mockFetch as unknown as typeof fetch;

      await expect(fetchOrangeCountyData('012027000000001')).rejects.toThrow(
        /failed with status 500/
      );
      expect(calls).toBe(1);
    });
  });
});
