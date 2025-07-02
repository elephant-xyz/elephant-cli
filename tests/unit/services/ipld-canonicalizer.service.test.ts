import { describe, it, expect, beforeEach } from 'vitest';
import { IPLDCanonicalizerService } from '../../../src/services/ipld-canonicalizer.service';

describe('IPLDCanonicalizerService', () => {
  let canonicalizer: IPLDCanonicalizerService;

  beforeEach(() => {
    canonicalizer = new IPLDCanonicalizerService();
  });

  describe('IPLD link sorting', () => {
    it('should sort arrays containing IPLD links by CID', () => {
      const input = {
        links: [
          {
            '/': 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi',
          },
          {
            '/': 'bafybeibazaarhe5qpbgvfwqnteba5hbgzvqcajqgfgxnhpdvfnqweabk4u',
          },
          {
            '/': 'bafybeifx7yeb55armcsxwwitkymga5xf53dxiarykms3ygqic223w5sk3m',
          },
        ],
      };

      const result = canonicalizer.canonicalize(input);
      const parsed = JSON.parse(result);

      // The CIDs should be sorted alphabetically
      expect(parsed.links[0]['/']).toBe(
        'bafybeibazaarhe5qpbgvfwqnteba5hbgzvqcajqgfgxnhpdvfnqweabk4u'
      );
      expect(parsed.links[1]['/']).toBe(
        'bafybeifx7yeb55armcsxwwitkymga5xf53dxiarykms3ygqic223w5sk3m'
      );
      expect(parsed.links[2]['/']).toBe(
        'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi'
      );
    });

    it('should handle arrays with mixed IPLD links and other values', () => {
      const input = {
        mixed: [
          {
            '/': 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi',
          },
          'regular string',
          {
            '/': 'bafybeibazaarhe5qpbgvfwqnteba5hbgzvqcajqgfgxnhpdvfnqweabk4u',
          },
          42,
          { not: 'ipld' },
        ],
      };

      const result = canonicalizer.canonicalize(input);
      const parsed = JSON.parse(result);

      // IPLD links should come first, sorted by CID
      expect(parsed.mixed[0]['/']).toBe(
        'bafybeibazaarhe5qpbgvfwqnteba5hbgzvqcajqgfgxnhpdvfnqweabk4u'
      );
      expect(parsed.mixed[1]['/']).toBe(
        'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi'
      );
      // Other items maintain relative order
      expect(parsed.mixed[2]).toBe('regular string');
      expect(parsed.mixed[3]).toBe(42);
      expect(parsed.mixed[4]).toEqual({ not: 'ipld' });
    });

    it('should recursively sort nested arrays with IPLD links', () => {
      const input = {
        outer: [
          {
            inner: [
              {
                '/': 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi',
              },
              {
                '/': 'bafybeibazaarhe5qpbgvfwqnteba5hbgzvqcajqgfgxnhpdvfnqweabk4u',
              },
            ],
          },
        ],
      };

      const result = canonicalizer.canonicalize(input);
      const parsed = JSON.parse(result);

      expect(parsed.outer[0].inner[0]['/']).toBe(
        'bafybeibazaarhe5qpbgvfwqnteba5hbgzvqcajqgfgxnhpdvfnqweabk4u'
      );
      expect(parsed.outer[0].inner[1]['/']).toBe(
        'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi'
      );
    });

    it('should not sort arrays without IPLD links', () => {
      const input = {
        regular: ['c', 'a', 'b'],
        numbers: [3, 1, 2],
        objects: [{ z: 1 }, { a: 2 }, { m: 3 }],
      };

      const result = canonicalizer.canonicalize(input);
      const parsed = JSON.parse(result);

      // Regular arrays should maintain their order
      expect(parsed.regular).toEqual(['c', 'a', 'b']);
      expect(parsed.numbers).toEqual([3, 1, 2]);
      expect(parsed.objects).toEqual([{ z: 1 }, { a: 2 }, { m: 3 }]);
    });

    it('should handle arrays containing only IPLD links', () => {
      const input = [
        { '/': 'QmYjtig7VJQ6XsnUjqqJvj7QaMcCAwtrgNdahSiFofrE7o' },
        { '/': 'QmPZ9gcCEpqKTo6aq61g2nXGUhM4iCL3ewB6LDXZCtioEB' },
        { '/': 'QmWATWQ7fVPP2EFGu71UkfnqhYXDYH566qy47CnJDgvs8u' },
      ];

      const result = canonicalizer.canonicalize(input);
      const parsed = JSON.parse(result);

      // Should be sorted alphabetically by CID
      expect(parsed[0]['/']).toBe(
        'QmPZ9gcCEpqKTo6aq61g2nXGUhM4iCL3ewB6LDXZCtioEB'
      );
      expect(parsed[1]['/']).toBe(
        'QmWATWQ7fVPP2EFGu71UkfnqhYXDYH566qy47CnJDgvs8u'
      );
      expect(parsed[2]['/']).toBe(
        'QmYjtig7VJQ6XsnUjqqJvj7QaMcCAwtrgNdahSiFofrE7o'
      );
    });

    it('should handle empty arrays and null values', () => {
      const input = {
        empty: [],
        nullValue: null,
        undefinedValue: undefined,
        arrayWithNull: [
          {
            '/': 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi',
          },
          null,
        ],
      };

      const result = canonicalizer.canonicalize(input);
      const parsed = JSON.parse(result);

      expect(parsed.empty).toEqual([]);
      expect(parsed.nullValue).toBe(null);
      expect(parsed.arrayWithNull[0]['/']).toBe(
        'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi'
      );
      expect(parsed.arrayWithNull[1]).toBe(null);
    });

    it('should not treat objects with additional properties as IPLD links', () => {
      const input = {
        notLinks: [
          { '/': 'cid1', extra: 'property' }, // Not an IPLD link
          { '/': 'cid2' }, // Valid IPLD link
          { other: 'object' },
        ],
      };

      const result = canonicalizer.canonicalize(input);
      const parsed = JSON.parse(result);

      // Only the valid IPLD link should be sorted first
      expect(parsed.notLinks[0]['/']).toBe('cid2');
      expect(parsed.notLinks[1]).toEqual({ '/': 'cid1', extra: 'property' });
      expect(parsed.notLinks[2]).toEqual({ other: 'object' });
    });

    it('should handle complex nested structures', () => {
      const input = {
        data: {
          references: [
            {
              metadata: {
                '/': 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi',
              },
              links: [
                {
                  '/': 'bafybeifx7yeb55armcsxwwitkymga5xf53dxiarykms3ygqic223w5sk3m',
                },
                {
                  '/': 'bafybeibazaarhe5qpbgvfwqnteba5hbgzvqcajqgfgxnhpdvfnqweabk4u',
                },
              ],
            },
          ],
          mainLinks: [
            { '/': 'QmYjtig7VJQ6XsnUjqqJvj7QaMcCAwtrgNdahSiFofrE7o' },
            { '/': 'QmPZ9gcCEpqKTo6aq61g2nXGUhM4iCL3ewB6LDXZCtioEB' },
          ],
        },
      };

      const result = canonicalizer.canonicalize(input);
      const parsed = JSON.parse(result);

      // Check nested array sorting
      expect(parsed.data.references[0].links[0]['/']).toBe(
        'bafybeibazaarhe5qpbgvfwqnteba5hbgzvqcajqgfgxnhpdvfnqweabk4u'
      );
      expect(parsed.data.references[0].links[1]['/']).toBe(
        'bafybeifx7yeb55armcsxwwitkymga5xf53dxiarykms3ygqic223w5sk3m'
      );

      // Check main links sorting
      expect(parsed.data.mainLinks[0]['/']).toBe(
        'QmPZ9gcCEpqKTo6aq61g2nXGUhM4iCL3ewB6LDXZCtioEB'
      );
      expect(parsed.data.mainLinks[1]['/']).toBe(
        'QmYjtig7VJQ6XsnUjqqJvj7QaMcCAwtrgNdahSiFofrE7o'
      );
    });
  });

  describe('standard canonicalization features', () => {
    it('should maintain RFC 8785 compliance for object key ordering', () => {
      const input = {
        z: 1,
        a: 2,
        m: 3,
      };

      const result = canonicalizer.canonicalize(input);

      // Keys should be sorted alphabetically per RFC 8785
      expect(result).toBe('{"a":2,"m":3,"z":1}');
    });

    it('should handle all JSON types correctly', () => {
      const input = {
        string: 'hello',
        number: 42,
        boolean: true,
        null: null,
        array: [1, 2, 3],
        object: { nested: 'value' },
      };

      const result = canonicalizer.canonicalize(input);
      expect(() => JSON.parse(result)).not.toThrow();
    });
  });

  describe('utility methods', () => {
    it('should correctly identify canonical strings', () => {
      const data = {
        links: [{ '/': 'cid2' }, { '/': 'cid1' }],
      };

      const canonical = canonicalizer.canonicalize(data);
      expect(canonicalizer.isCanonical(canonical)).toBe(true);

      // Non-canonical version (wrong order)
      const nonCanonical = '{"links":[{"/":"cid2"},{"/":"cid1"}]}';
      expect(canonicalizer.isCanonical(nonCanonical)).toBe(false);
    });

    it('should correctly compare equivalent objects', () => {
      const obj1 = {
        links: [{ '/': 'cid2' }, { '/': 'cid1' }],
      };

      const obj2 = {
        links: [{ '/': 'cid1' }, { '/': 'cid2' }],
      };

      // Both should be equivalent after canonicalization
      expect(canonicalizer.areEquivalent(obj1, obj2)).toBe(true);
    });

    it('should convert to buffer correctly', () => {
      const input = { test: 'data' };
      const buffer = canonicalizer.canonicalizeToBuffer(input);

      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.toString('utf-8')).toBe('{"test":"data"}');
    });

    it('should parse and canonicalize JSON strings', () => {
      const jsonString = '{"links":[{"/":"cid2"},{"/":"cid1"}]}';
      const result = canonicalizer.parseAndCanonicalize(jsonString);

      const parsed = JSON.parse(result);
      expect(parsed.links[0]['/']).toBe('cid1');
      expect(parsed.links[1]['/']).toBe('cid2');
    });
  });
});
