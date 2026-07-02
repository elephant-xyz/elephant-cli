import { Prepared } from '../types.js';
import { logger } from '../../utils/logger.js';

// OCPA's QuickSearch endpoint requires a 15-digit parcel id, but the county
// seed stores mixed 14/15-digit ids (numeric CSV storage strips leading
// zeros). Pad to 15 so 14-digit ids resolve instead of returning [].
const OCPA_PID_LENGTH = 15;

// OCPA intermittently returns an empty array/body for a valid id (measured
// ~16% first-pass in the pilot; all recovered on retry). Retry on empty with
// a short increasing backoff before treating the id as not found. This is
// local to Orange so no other county's fetch behavior changes.
const EMPTY_RETRY_ATTEMPTS = 4;
const EMPTY_RETRY_BASE_DELAY_MS = 300;

interface QuickSearchResult {
  parcelId?: string;
  [key: string]: unknown;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Resolve the canonical OCPA parcelId. Retries only when the response is a
// valid HTTP 2xx with an empty array; genuine HTTP errors are thrown
// immediately (not retried) so existing error handling is unchanged.
async function resolveParcelId(pid: string): Promise<QuickSearchResult[]> {
  const url = `https://ocpa-mainsite-afd-standard.azurefd.net/api/QuickSearch/GetSearchInfoByParcel?pid=${pid}`;

  for (let attempt = 1; attempt <= EMPTY_RETRY_ATTEMPTS; attempt++) {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(
        `API request to ${url} failed with status ${response.status}`
      );
    }

    const data = await response.json();
    if (Array.isArray(data) && data.length > 0) {
      return data as QuickSearchResult[];
    }

    logger.warn(
      `Quick search for parcel ${pid} returned empty (attempt ${attempt}/${EMPTY_RETRY_ATTEMPTS})`
    );
    if (attempt < EMPTY_RETRY_ATTEMPTS) {
      await delay(attempt * EMPTY_RETRY_BASE_DELAY_MS);
    }
  }

  throw new Error(
    `Quick search for parcel ${pid} returned empty after ${EMPTY_RETRY_ATTEMPTS} attempts`
  );
}

async function fetchAllYearsNonAdValorem(parcelId: string): Promise<unknown[]> {
  const results: unknown[] = [];
  let taxYear = 0;
  let shouldContinue = true;

  while (shouldContinue) {
    const url = `https://ocpa-mainsite-afd-standard.azurefd.net/api/PRC/GetPRCNonAdValorem?PID=${parcelId}&TaxYear=${taxYear}`;
    const response = await fetch(url);

    if (!response.ok) {
      if (response.status === 404) {
        shouldContinue = false;
        break;
      }
      throw new Error(
        `API request to ${url} failed with status ${response.status}`
      );
    }

    const data = await response.json();
    if (!Array.isArray(data) || data.length === 0) {
      shouldContinue = false;
      break;
    }

    const yearData = data[0];
    if (yearData.taxYear === 0) {
      shouldContinue = false;
      break;
    }

    results.push(yearData);
    taxYear = yearData.taxYear - 1;
  }

  return results;
}

async function fetchAllYearsTotalTaxes(parcelId: string): Promise<unknown[]> {
  const results: unknown[] = [];
  let taxYear = 0;
  let shouldContinue = true;

  while (shouldContinue) {
    const url = `https://ocpa-mainsite-afd-standard.azurefd.net/api/PRC/GetPRCTotalTaxes?PID=${parcelId}&TaxYear=${taxYear}`;
    const response = await fetch(url);

    if (!response.ok) {
      if (response.status === 404) {
        shouldContinue = false;
        break;
      }
      throw new Error(
        `API request to ${url} failed with status ${response.status}`
      );
    }

    const data = await response.json();
    if (data.taxYear === 0) {
      shouldContinue = false;
      break;
    }

    results.push(data);
    taxYear = data.taxYear - 1;
  }

  return results;
}

export async function fetchOrangeCountyData(
  requestId: string
): Promise<Prepared> {
  logger.info('Orange County detected - using hardcoded API flow');

  // Strip every non-digit (seed ids may carry dashes/whitespace), then
  // left-pad to 15 so 14-digit ids resolve. Never truncate longer ids.
  const digits = requestId.replace(/\D/g, '');
  if (digits.length > OCPA_PID_LENGTH) {
    throw new Error(
      `Orange County parcel id "${requestId}" cleaned to ${digits.length} digits (> ${OCPA_PID_LENGTH}); cannot resolve`
    );
  }
  const cleanRequestId = digits.padStart(OCPA_PID_LENGTH, '0');

  // First, resolve the canonical parcelId (retries on transient empty result).
  const quickSearchData = await resolveParcelId(cleanRequestId);
  const parcelId = quickSearchData[0]?.parcelId;
  if (!parcelId) {
    throw new Error('Failed to retrieve parcelId from quick search response');
  }

  // Fetch multi-year data for specific endpoints
  const [nonAdValoremData, totalTaxesData] = await Promise.all([
    fetchAllYearsNonAdValorem(parcelId),
    fetchAllYearsTotalTaxes(parcelId),
  ]);

  // Use the parcelId for subsequent requests
  const endpoints = [
    {
      url: `https://ocpa-mainsite-afd-standard.azurefd.net/api/PRC/GetPRCStats?PID=${parcelId}`,
      key: 'parcelValuationStats',
    },
    {
      url: `https://ocpa-mainsite-afd-standard.azurefd.net/api/PRC/GetPRCGeneralInfo?pid=${parcelId}`,
      key: 'parcelGeneralProfile',
    },
    {
      url: `https://ocpa-mainsite-afd-standard.azurefd.net/api/PRC/GetPRCPropertyValues?PID=${parcelId}&TaxYear=0&ShowAllFlag=1`,
      key: 'parcelPropertyValuesByYear',
    },
    {
      url: `https://ocpa-mainsite-afd-standard.azurefd.net/api/PRC/GetPRCCertifiedTaxes?PID=${parcelId}&TaxYear=0`,
      key: 'parcelCertifiedTaxesByAuthority',
    },
    {
      url: `https://ocpa-mainsite-afd-standard.azurefd.net/api/PRC/GetPRCPropFeatLand?pid=${parcelId}`,
      key: 'parcelLandFeatures',
    },
    {
      url: `https://ocpa-mainsite-afd-standard.azurefd.net/api/PRC/GetPRCPropFeatLegal?pid=${parcelId}`,
      key: 'parcelLegalDescription',
    },
    {
      url: `https://ocpa-mainsite-afd-standard.azurefd.net/api/PRC/GetPRCPropFeatBldg?pid=${parcelId}`,
      key: 'parcelBuildingFeatures',
    },
    {
      url: `https://ocpa-mainsite-afd-standard.azurefd.net/api/PRC/GetPRCPropFeatXfob?pid=${parcelId}`,
      key: 'parcelExtraFeatures',
    },
    {
      url: `https://ocpa-mainsite-afd-standard.azurefd.net/api/PRC/GetPRCPropFeatLandArea?pid=${parcelId}`,
      key: 'parcelLandAreaSummary',
    },
    {
      url: `https://ocpa-mainsite-afd-standard.azurefd.net/api/PRC/GetPRCSales?pid=${parcelId}`,
      key: 'parcelSalesHistory',
    },
  ];

  const responses = await Promise.all(
    endpoints.map(async ({ url, key }) => {
      const response = await fetch(url);
      if (!response.ok) {
        if (response.status === 404) {
          logger.warn(
            `Information missing for parcel ${parcelId}: ${key} returned 404`
          );
          return { key, data: null };
        }
        throw new Error(
          `API request to ${url} failed with status ${response.status}`
        );
      }
      const data = await response.json();
      return { key, data };
    })
  );

  const combinedData = {
    parcelQuickSearchSummary: quickSearchData,
    parcelNonAdValoremAssessments: nonAdValoremData,
    parcelTotalTaxesSummary: totalTaxesData,
    ...responses.reduce(
      (acc, { key, data }) => {
        if (data !== null) {
          acc[key] = data;
        }
        return acc;
      },
      {} as Record<string, unknown>
    ),
  };

  return {
    type: 'json',
    content: JSON.stringify(combinedData, null, 2),
  };
}
