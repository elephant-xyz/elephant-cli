import { JsonCanonicalizerService } from './json-canonicalizer.service.cjs';

export class IPLDCanonicalizerService {
  private baseCanonicalizer: JsonCanonicalizerService;

  constructor() {
    this.baseCanonicalizer = new JsonCanonicalizerService();
  }

  /**
   * Canonicalize JSON with IPLD-aware array sorting
   * Arrays containing IPLD links (objects with "/" key) are sorted by CID value
   */
  canonicalize(json: any): string {
    // First, sort arrays containing IPLD links
    const sortedJson = this.sortIPLDArrays(json);

    // Then apply standard canonicalization
    return this.baseCanonicalizer.canonicalize(sortedJson);
  }

  /**
   * Recursively sort arrays that contain IPLD links
   */
  private sortIPLDArrays(data: any): any {
    if (data === null || data === undefined) {
      return data;
    }

    if (Array.isArray(data)) {
      // Check if this array contains IPLD links
      const hasIPLDLinks = data.some((item) => this.isIPLDLink(item));

      if (hasIPLDLinks) {
        // Sort the array by CID values
        const sorted = [...data].sort((a, b) => {
          const cidA = this.extractCID(a);
          const cidB = this.extractCID(b);

          // If both are IPLD links, sort by CID
          if (cidA && cidB) {
            return cidA.localeCompare(cidB);
          }

          // IPLD links come before non-links
          if (cidA && !cidB) return -1;
          if (!cidA && cidB) return 1;

          // For non-IPLD items, maintain original order
          return 0;
        });

        // Recursively process sorted array elements
        return sorted.map((item) => this.sortIPLDArrays(item));
      } else {
        // If no IPLD links, just recursively process elements
        return data.map((item) => this.sortIPLDArrays(item));
      }
    }

    if (typeof data === 'object') {
      const result: any = {};
      for (const key in data) {
        if (Object.prototype.hasOwnProperty.call(data, key)) {
          result[key] = this.sortIPLDArrays(data[key]);
        }
      }
      return result;
    }

    return data;
  }

  /**
   * Check if an object is an IPLD link
   */
  private isIPLDLink(obj: any): boolean {
    return (
      obj !== null &&
      typeof obj === 'object' &&
      Object.prototype.hasOwnProperty.call(obj, '/') &&
      typeof obj['/'] === 'string' &&
      Object.keys(obj).length === 1
    );
  }

  /**
   * Extract CID from an IPLD link object or return null
   */
  private extractCID(obj: any): string | null {
    if (this.isIPLDLink(obj)) {
      return obj['/'];
    }
    return null;
  }

  /**
   * Canonicalize and convert to Buffer
   */
  canonicalizeToBuffer(json: any): Buffer {
    const canonicalJson = this.canonicalize(json);
    return Buffer.from(canonicalJson, 'utf-8');
  }

  /**
   * Parse JSON string and canonicalize with IPLD sorting
   */
  parseAndCanonicalize(jsonString: string): string {
    try {
      const parsed = JSON.parse(jsonString);
      return this.canonicalize(parsed);
    } catch (error) {
      throw new Error(
        `Failed to parse or canonicalize JSON string: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Verify if a JSON string is already in canonical form with IPLD sorting
   */
  isCanonical(jsonString: string): boolean {
    try {
      const parsed = JSON.parse(jsonString);
      const canonical = this.canonicalize(parsed);
      return jsonString === canonical;
    } catch {
      return false;
    }
  }

  /**
   * Compare two JSON objects after canonicalization with IPLD sorting
   */
  areEquivalent(json1: any, json2: any): boolean {
    try {
      const canonical1 = this.canonicalize(json1);
      const canonical2 = this.canonicalize(json2);
      return canonical1 === canonical2;
    } catch {
      return false;
    }
  }
}
