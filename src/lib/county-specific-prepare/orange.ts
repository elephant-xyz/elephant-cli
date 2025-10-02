import { Prepared } from '../types.js';
import { logger } from '../../utils/logger.js';

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

  const cleanRequestId = requestId.replace(/-/g, '');

  // First, fetch the quick search to get the parcelId
  const quickSearchUrl = `https://ocpa-mainsite-afd-standard.azurefd.net/api/QuickSearch/GetSearchInfoByParcel?pid=${cleanRequestId}`;
  const quickSearchResponse = await fetch(quickSearchUrl);
  if (!quickSearchResponse.ok) {
    throw new Error(
      `API request to ${quickSearchUrl} failed with status ${quickSearchResponse.status}`
    );
  }
  const quickSearchData = await quickSearchResponse.json();
  if (!Array.isArray(quickSearchData) || quickSearchData.length === 0) {
    throw new Error('Quick search response is not a valid array or is empty');
  }
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
