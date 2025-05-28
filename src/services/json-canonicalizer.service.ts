export class JsonCanonicalizerService {
  private canonicalizeLib: any;
  private canonicalizeLoaded: Promise<void>;

  constructor() {
    this.canonicalizeLoaded = this.loadCanonicalizeLibrary();
  }

  private async loadCanonicalizeLibrary(): Promise<void> {
    const { createRequire } = await import('module');
    const require = createRequire(import.meta.url);
    this.canonicalizeLib = require('canonicalize');
  }

  /**
   * Canonicalize a JSON object according to RFC 8785
   * Returns the canonical JSON string representation
   */
  async canonicalize(json: any): Promise<string> {
    await this.canonicalizeLoaded; // Wait for library to load

    try {
      // Check for invalid inputs
      if (json === undefined) {
        throw new Error('Cannot canonicalize undefined');
      }
      if (typeof json === 'function') {
        throw new Error('Cannot canonicalize functions');
      }

      // The canonicalize library implements RFC 8785
      const result = this.canonicalizeLib(json);

      // Check if canonicalize returned undefined (for unsupported types)
      if (result === undefined) {
        throw new Error('Canonicalization failed for unsupported type');
      }

      return result;
    } catch (error) {
      throw new Error(
        `Failed to canonicalize JSON: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Canonicalize and convert to Buffer
   */
  async canonicalizeToBuffer(json: any): Promise<Buffer> {
    const canonicalJson = await this.canonicalize(json);
    return Buffer.from(canonicalJson, 'utf-8');
  }

  /**
   * Parse JSON string and canonicalize
   */
  async parseAndCanonicalize(jsonString: string): Promise<string> {
    try {
      const parsed = JSON.parse(jsonString);
      return await this.canonicalize(parsed);
    } catch (error) {
      throw new Error(
        `Failed to parse or canonicalize JSON string: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Batch canonicalize multiple JSON objects
   */
  async canonicalizeBatch(jsonArray: any[]): Promise<string[]> {
    // Process all items asynchronously
    return Promise.all(jsonArray.map((json) => this.canonicalize(json)));
  }

  /**
   * Verify if a JSON string is already in canonical form
   */
  async isCanonical(jsonString: string): Promise<boolean> {
    try {
      const parsed = JSON.parse(jsonString);
      const canonical = await this.canonicalize(parsed);
      return jsonString === canonical;
    } catch {
      return false;
    }
  }

  /**
   * Compare two JSON objects after canonicalization
   * Returns true if they are equivalent
   */
  async areEquivalent(json1: any, json2: any): Promise<boolean> {
    try {
      const canonical1 = await this.canonicalize(json1);
      const canonical2 = await this.canonicalize(json2);
      return canonical1 === canonical2;
    } catch {
      return false;
    }
  }
}
