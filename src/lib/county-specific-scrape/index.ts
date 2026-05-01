import { ProxyOptions, ScrapeResult } from '../types.js';
import { scrapePalmBeachPermits } from './palm-beach.js';

const SCRAPERS: Record<
  string,
  (
    pcn: string,
    outputDir: string,
    headless: boolean,
    proxy?: ProxyOptions
  ) => Promise<ScrapeResult>
> = {
  'palm-beach': scrapePalmBeachPermits,
};

export const SUPPORTED_COUNTIES = Object.keys(SCRAPERS);

export function getPermitScraper(county: string) {
  const scraper = SCRAPERS[county];
  if (!scraper) {
    throw new Error(
      `Unsupported county: ${county}. Supported: ${SUPPORTED_COUNTIES.join(', ')}`
    );
  }
  return scraper;
}
