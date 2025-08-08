import { diff, atomizeChangeset } from 'json-diff-ts';
import { logger } from '../utils/logger.js';
import { CID } from 'multiformats/cid';

export interface ComparisonResult {
  cid1: string;
  cid2: string;
  differences: DifferenceDetail[];
  differenceCount: number;
  hasDifferences: boolean;
}

export interface DifferenceDetail {
  path: string;
  type: 'ADD' | 'UPDATE' | 'REMOVE';
  oldValue?: any;
  newValue?: any;
  description: string;
}

export interface MultiComparisonResult {
  propertyHash: string;
  dataGroupHash: string;
  cids: string[];
  pairwiseComparisons: ComparisonResult[];
  summary: string;
  totalDifferences: number;
}

export class IpfsDataComparatorService {
  private readonly baseUrl: string;
  private readonly maxRetries: number = 3;
  private readonly rateLimitDelay: number = 5000;
  private fetchCache: Map<string, any> = new Map();

  constructor(gatewayUrl: string = 'https://gateway.pinata.cloud/ipfs') {
    this.baseUrl = gatewayUrl.endsWith('/')
      ? gatewayUrl.slice(0, -1)
      : gatewayUrl;
  }

  /**
   * Compare data from multiple CIDs and return detailed differences
   */
  public async compareMultipleCids(
    cids: string[],
    propertyHash: string,
    dataGroupHash: string
  ): Promise<MultiComparisonResult> {
    if (cids.length < 2) {
      throw new Error('At least 2 CIDs are required for comparison');
    }

    logger.info(
      `Comparing ${cids.length} CIDs for property ${propertyHash.slice(0, 10)}...`
    );

    // Fetch and construct full JSON for each CID
    const fullJsons: Map<string, any> = new Map();
    for (const cid of cids) {
      try {
        const fullJson = await this.fetchAndConstructFullJson(cid);
        fullJsons.set(cid, fullJson);
        logger.debug(
          `Successfully fetched and constructed JSON for CID: ${cid}`
        );
      } catch (error) {
        logger.error(`Failed to fetch CID ${cid}: ${error}`);
        throw new Error(`Failed to fetch data for CID ${cid}: ${error}`);
      }
    }

    // Perform pairwise comparisons
    const pairwiseComparisons: ComparisonResult[] = [];
    let totalDifferences = 0;

    for (let i = 0; i < cids.length - 1; i++) {
      for (let j = i + 1; j < cids.length; j++) {
        const cid1 = cids[i];
        const cid2 = cids[j];
        const json1 = fullJsons.get(cid1);
        const json2 = fullJsons.get(cid2);

        const comparison = this.compareJsons(json1, json2, cid1, cid2);
        pairwiseComparisons.push(comparison);
        totalDifferences += comparison.differenceCount;
      }
    }

    // Generate summary
    const summary = this.generateComparisonSummary(cids, pairwiseComparisons);

    return {
      propertyHash,
      dataGroupHash,
      cids,
      pairwiseComparisons,
      summary,
      totalDifferences,
    };
  }

  /**
   * Fetch content from IPFS with retry logic
   */
  private async fetchContent(cid: string, attempt: number = 0): Promise<any> {
    // Check cache first
    if (this.fetchCache.has(cid)) {
      return this.fetchCache.get(cid);
    }

    const url = `${this.baseUrl}/${cid}`;

    try {
      logger.debug(
        `Fetching CID ${cid} (attempt ${attempt + 1}/${this.maxRetries})`
      );

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);

      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'elephant-cli/1.0',
        },
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        if (response.status === 429 && attempt < this.maxRetries - 1) {
          const waitTime = this.rateLimitDelay * Math.pow(2, attempt);
          logger.warn(
            `Rate limited. Waiting ${waitTime / 1000}s before retry...`
          );
          await new Promise((resolve) => setTimeout(resolve, waitTime));
          return this.fetchContent(cid, attempt + 1);
        }
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const content = await response.json();
      this.fetchCache.set(cid, content);
      return content;
    } catch (error) {
      if (attempt < this.maxRetries - 1) {
        logger.warn(`Retry ${attempt + 1}/${this.maxRetries} for CID ${cid}`);
        await new Promise((resolve) =>
          setTimeout(resolve, 1000 * (attempt + 1))
        );
        return this.fetchContent(cid, attempt + 1);
      }
      throw error;
    }
  }

  /**
   * Check if a string is a valid CID
   */
  private isValidCid(cid: string): boolean {
    if (!cid || cid.length < 46) {
      return false;
    }
    try {
      CID.parse(cid);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Fetch and construct a complete JSON object by resolving all CID references
   */
  private async fetchAndConstructFullJson(cid: string): Promise<any> {
    const processedCids = new Set<string>();
    return this.resolveReferences(cid, processedCids);
  }

  /**
   * Recursively resolve CID references to build a complete JSON object
   */
  private async resolveReferences(
    cidOrData: any,
    processedCids: Set<string>
  ): Promise<any> {
    // If it's a string CID, fetch it
    if (typeof cidOrData === 'string' && this.isValidCid(cidOrData)) {
      if (processedCids.has(cidOrData)) {
        return { '/': cidOrData }; // Circular reference, keep as CID reference
      }
      processedCids.add(cidOrData);
      const content = await this.fetchContent(cidOrData);
      return this.resolveReferences(content, processedCids);
    }

    // If it's an object
    if (typeof cidOrData === 'object' && cidOrData !== null) {
      // Check if it's a CID reference pattern {"/": "cid"}
      if (
        '/' in cidOrData &&
        typeof cidOrData['/'] === 'string' &&
        Object.keys(cidOrData).length === 1
      ) {
        const cid = cidOrData['/'];
        if (this.isValidCid(cid)) {
          if (processedCids.has(cid)) {
            return { '/': cid }; // Circular reference
          }
          processedCids.add(cid);
          const content = await this.fetchContent(cid);
          return this.resolveReferences(content, processedCids);
        }
      }

      // Recursively process object properties
      const resolved: any = Array.isArray(cidOrData) ? [] : {};
      for (const [key, value] of Object.entries(cidOrData)) {
        resolved[key] = await this.resolveReferences(value, processedCids);
      }
      return resolved;
    }

    // Return primitive values as-is
    return cidOrData;
  }

  /**
   * Compare two JSON objects and return detailed differences
   */
  private compareJsons(
    json1: any,
    json2: any,
    cid1: string,
    cid2: string
  ): ComparisonResult {
    const changes = diff(json1, json2);
    const atomicChanges = atomizeChangeset(changes);

    const differences: DifferenceDetail[] = atomicChanges.map((change: any) => {
      const path = this.formatPath(change.key, (change as any).embeddedKey);
      let description = '';
      const oldValue = change.oldValue;
      const newValue = change.value;

      switch (change.type) {
        case 'ADD':
          description = `Added: ${this.formatValue(newValue)}`;
          break;
        case 'UPDATE':
          description = `Changed from ${this.formatValue(oldValue)} to ${this.formatValue(newValue)}`;
          break;
        case 'REMOVE':
          description = `Removed: ${this.formatValue(oldValue)}`;
          break;
      }

      return {
        path,
        type: change.type,
        oldValue,
        newValue,
        description,
      };
    });

    return {
      cid1,
      cid2,
      differences,
      differenceCount: differences.length,
      hasDifferences: differences.length > 0,
    };
  }

  /**
   * Format a path from change keys
   */
  private formatPath(key: string, embeddedKey?: string): string {
    // Convert the key to a more readable JSON path format
    // The key comes as a path like "relationships.property_seed.from" or just "/"
    let formattedPath = key;

    // Handle array indices if embeddedKey is provided
    if (embeddedKey) {
      // If embeddedKey is a number, it's an array index
      if (!isNaN(Number(embeddedKey))) {
        formattedPath = `${key}[${embeddedKey}]`;
      } else {
        // Otherwise it's a nested property
        formattedPath = `${key}.${embeddedKey}`;
      }
    }

    // Special handling for root-level changes
    if (formattedPath === '/') {
      formattedPath = '(root)';
    }

    return formattedPath;
  }

  /**
   * Format a value for display
   */
  private formatValue(value: any): string {
    if (value === null) return 'null';
    if (value === undefined) return 'undefined';
    if (typeof value === 'string') {
      if (value.length > 50) {
        return `"${value.substring(0, 47)}..."`;
      }
      return `"${value}"`;
    }
    if (typeof value === 'object') {
      try {
        const str = JSON.stringify(value);
        if (str.length > 50) {
          return str.substring(0, 47) + '...';
        }
        return str;
      } catch {
        return '[object]';
      }
    }
    return String(value);
  }

  /**
   * Generate a summary of all comparisons
   */
  private generateComparisonSummary(
    cids: string[],
    comparisons: ComparisonResult[]
  ): string {
    if (comparisons.every((c) => !c.hasDifferences)) {
      return `All ${cids.length} submissions are identical`;
    }

    const summaryLines: string[] = [];
    summaryLines.push(
      `Compared ${cids.length} submissions (${cids.length === 2 ? 'CIDs' : 'unique CIDs'}: ${cids.map((c) => '...' + c.slice(-8)).join(', ')}):`
    );
    summaryLines.push('');

    // Group differences by path to show all values for each path
    const differencesByPath = new Map<
      string,
      {
        type: string;
        values: Map<string, any>;
        comparisons: Array<{
          cid1: string;
          cid2: string;
          oldValue: any;
          newValue: any;
        }>;
      }
    >();

    for (const comparison of comparisons) {
      for (const diff of comparison.differences) {
        if (!differencesByPath.has(diff.path)) {
          differencesByPath.set(diff.path, {
            type: diff.type,
            values: new Map(),
            comparisons: [],
          });
        }

        const pathData = differencesByPath.get(diff.path)!;

        // Track all unique values for this path
        if (diff.type === 'UPDATE') {
          pathData.values.set(comparison.cid1, diff.oldValue);
          pathData.values.set(comparison.cid2, diff.newValue);
        } else if (diff.type === 'REMOVE') {
          pathData.values.set(comparison.cid1, diff.oldValue);
          pathData.values.set(comparison.cid2, undefined);
        } else if (diff.type === 'ADD') {
          pathData.values.set(comparison.cid1, undefined);
          pathData.values.set(comparison.cid2, diff.newValue);
        }

        pathData.comparisons.push({
          cid1: comparison.cid1,
          cid2: comparison.cid2,
          oldValue: diff.oldValue,
          newValue: diff.newValue,
        });
      }
    }

    // Sort paths by frequency of differences
    const sortedPaths = Array.from(differencesByPath.entries()).sort(
      (a, b) => b[1].comparisons.length - a[1].comparisons.length
    );

    // Show detailed differences for top paths
    const maxPathsToShow = 10;
    const pathsToShow = sortedPaths.slice(0, maxPathsToShow);

    if (pathsToShow.length > 0) {
      summaryLines.push('DIFFERENCES FOUND:');
      summaryLines.push('');

      for (const [path, data] of pathsToShow) {
        summaryLines.push(`📍 Path: ${path}`);

        // Show all unique values for this path
        const uniqueValues = Array.from(data.values.entries());
        if (uniqueValues.length <= 4) {
          // If we have few unique values, show them all
          summaryLines.push('  Values across submissions:');
          for (const [cid, value] of uniqueValues) {
            const cidShort = '...' + cid.slice(-8);
            const formattedValue = this.formatValueForSummary(value);
            summaryLines.push(`    • ${cidShort}: ${formattedValue}`);
          }
        } else {
          // If too many unique values, show a sample
          summaryLines.push(`  ${uniqueValues.length} different values found`);
          summaryLines.push('  Sample values:');
          for (const [cid, value] of uniqueValues.slice(0, 3)) {
            const cidShort = '...' + cid.slice(-8);
            const formattedValue = this.formatValueForSummary(value);
            summaryLines.push(`    • ${cidShort}: ${formattedValue}`);
          }
        }
        summaryLines.push('');
      }

      if (sortedPaths.length > maxPathsToShow) {
        summaryLines.push(
          `... and ${sortedPaths.length - maxPathsToShow} more paths with differences`
        );
        summaryLines.push('');
      }
    }

    // Add summary statistics
    const totalDifferences = comparisons.reduce(
      (sum, c) => sum + c.differenceCount,
      0
    );
    summaryLines.push('SUMMARY STATISTICS:');
    summaryLines.push(`  • Total differences: ${totalDifferences}`);
    summaryLines.push(
      `  • Unique paths with differences: ${differencesByPath.size}`
    );
    summaryLines.push(`  • Pairwise comparisons: ${comparisons.length}`);

    return summaryLines.join('\n');
  }

  /**
   * Format a value for the summary display
   */
  private formatValueForSummary(value: any): string {
    if (value === null) return 'null';
    if (value === undefined) return 'undefined (field missing)';
    if (typeof value === 'string') {
      // Show more of string values in summary
      if (value.length > 100) {
        return `"${value.substring(0, 97)}..."`;
      }
      return `"${value}"`;
    }
    if (typeof value === 'boolean') {
      return String(value);
    }
    if (typeof value === 'number') {
      return String(value);
    }
    if (Array.isArray(value)) {
      return `[Array with ${value.length} items]`;
    }
    if (typeof value === 'object') {
      const keys = Object.keys(value);
      if (keys.length === 0) return '{}';
      if (keys.length === 1 && keys[0] === '/') {
        // This is a CID reference
        return `{"/": "${value['/']}"}`;
      }
      return `{Object with ${keys.length} keys: ${keys.slice(0, 3).join(', ')}${keys.length > 3 ? '...' : ''}}`;
    }
    return String(value);
  }

  /**
   * Clear the fetch cache
   */
  public clearCache(): void {
    this.fetchCache.clear();
  }
}
