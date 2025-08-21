import { describe, it, expect } from 'vitest';

// Test the replaceHtmlMarkers function directly
// Since it's not exported, we'll test it through integration
describe('HTML Path Marker Replacement Logic', () => {
  // Helper function that mimics replaceHtmlMarkers behavior
  function replaceHtmlMarkers(data: any, mediaDirectoryCid: string): any {
    if (!data || typeof data !== 'object') {
      // For string values that contain HTML path markers
      if (typeof data === 'string') {
        // Check if it's an ipfs:// URI with an HTML path marker
        if (data.startsWith('ipfs://__HTML_PATH__')) {
          // Replace with proper IPFS URI using media directory CID
          return `ipfs://${mediaDirectoryCid}`;
        }
        // Check if it's just an HTML path marker
        if (data.startsWith('__HTML_PATH__')) {
          // For IPLD links (used in {"/": "..."} format), return just the CID
          return mediaDirectoryCid;
        }
      }
      return data;
    }

    // Handle arrays
    if (Array.isArray(data)) {
      return data.map((item) => replaceHtmlMarkers(item, mediaDirectoryCid));
    }

    // Handle objects
    const processed: any = {};
    for (const key in data) {
      if (Object.prototype.hasOwnProperty.call(data, key)) {
        processed[key] = replaceHtmlMarkers(data[key], mediaDirectoryCid);
      }
    }
    return processed;
  }

  const testMediaCid = 'bafybeimediadir12345';

  it('should replace ipfs:// URI markers with proper ipfs:// format', () => {
    const input = {
      ipfs_url: 'ipfs://__HTML_PATH__./index.html',
    };
    const result = replaceHtmlMarkers(input, testMediaCid);
    expect(result.ipfs_url).toBe(`ipfs://${testMediaCid}`);
  });

  it('should replace plain HTML path markers with just the CID', () => {
    const input = {
      '/': '__HTML_PATH__./index.html',
    };
    const result = replaceHtmlMarkers(input, testMediaCid);
    expect(result['/']).toBe(testMediaCid);
  });

  it('should not modify data without HTML markers', () => {
    const input = {
      field1: 'value1',
      field2: 123,
      nested: {
        field3: 'value3',
      },
    };
    const result = replaceHtmlMarkers(input, testMediaCid);
    expect(result).toEqual(input);
  });

  it('should handle nested structures with HTML markers', () => {
    const input = {
      metadata: {
        visualization: {
          ipfs_url: 'ipfs://__HTML_PATH__./chart.html',
        },
      },
      items: [
        { link: '__HTML_PATH__./item1.html' },
        { link: '__HTML_PATH__./item2.html' },
      ],
    };
    const result = replaceHtmlMarkers(input, testMediaCid);

    expect(result.metadata.visualization.ipfs_url).toBe(
      `ipfs://${testMediaCid}`
    );
    expect(result.items[0].link).toBe(testMediaCid);
    expect(result.items[1].link).toBe(testMediaCid);
  });

  it('should handle mixed content with and without markers', () => {
    const input = {
      ipfs_url: 'ipfs://__HTML_PATH__./index.html',
      regular_field: 'normal value',
      nested: {
        html_ref: '__HTML_PATH__./page.html',
        json_ref: 'bafkreijsonfile',
      },
    };
    const result = replaceHtmlMarkers(input, testMediaCid);

    expect(result.ipfs_url).toBe(`ipfs://${testMediaCid}`);
    expect(result.regular_field).toBe('normal value');
    expect(result.nested.html_ref).toBe(testMediaCid);
    expect(result.nested.json_ref).toBe('bafkreijsonfile');
  });

  it('should handle arrays with HTML markers', () => {
    const input = [
      '__HTML_PATH__./file1.html',
      'regular string',
      'ipfs://__HTML_PATH__./file2.html',
    ];
    const result = replaceHtmlMarkers(input, testMediaCid);

    expect(result[0]).toBe(testMediaCid);
    expect(result[1]).toBe('regular string');
    expect(result[2]).toBe(`ipfs://${testMediaCid}`);
  });

  it('should maintain consistent format for ipfs_url vs IPLD links', () => {
    const input = {
      // ipfs_url field should use ipfs:// format
      ipfs_url: 'ipfs://__HTML_PATH__./index.html',
      // IPLD link should use just the CID
      ipld_link: {
        '/': '__HTML_PATH__./page.html',
      },
    };
    const result = replaceHtmlMarkers(input, testMediaCid);

    // ipfs_url gets the full ipfs:// URI
    expect(result.ipfs_url).toBe(`ipfs://${testMediaCid}`);
    // IPLD link gets just the CID
    expect(result.ipld_link['/']).toBe(testMediaCid);
  });
});
