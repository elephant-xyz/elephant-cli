// eslint-disable-next-line @typescript-eslint/no-var-requires
const canonicalizeLib = require('canonicalize');

class JsonCanonicalizerService {
  /**
   * Canonicalize a JSON object according to RFC 8785
   * Returns the canonical JSON string representation
   */
  canonicalize(json: any): string {
    try {
      // Check for invalid inputs
      if (json === undefined) {
        throw new Error('Cannot canonicalize undefined');
      }
      if (typeof json === 'function') {
        throw new Error('Cannot canonicalize functions');
      }

      // The canonicalize library implements RFC 8785
      const result = canonicalizeLib(json);

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
  canonicalizeToBuffer(json: any): Buffer {
    const canonicalJson = this.canonicalize(json);
    return Buffer.from(canonicalJson, 'utf-8');
  }

  /**
   * Parse JSON string and canonicalize
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
   * Batch canonicalize multiple JSON objects
   */
  canonicalizeBatch(jsonArray: any[]): string[] {
    // Process all items synchronously
    return jsonArray.map((json) => this.canonicalize(json));
  }

  /**
   * Verify if a JSON string is already in canonical form
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
   * Compare two JSON objects after canonicalization
   * Returns true if they are equivalent
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

export = JsonCanonicalizerService; 