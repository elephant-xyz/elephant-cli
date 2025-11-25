import { describe, it, expect } from 'vitest';
import { extractTextWithSources } from '../../../src/utils/html-source-extractor.js';

describe('html-source-extractor', () => {
  describe('extractTextWithSources', () => {
    it('should extract text with CSS selectors from simple HTML', () => {
      const html = `
        <html>
          <body>
            <div id="main">Hello World</div>
            <p class="intro">This is a test</p>
          </body>
        </html>
      `;

      const result = extractTextWithSources(html);

      expect(result.sourceMap).toHaveLength(2);
      expect(result.sourceMap[0].text).toBe('Hello World');
      expect(result.sourceMap[0].source).toBe('#main');
      expect(result.sourceMap[0].lineIndex).toBe(0);

      expect(result.sourceMap[1].text).toContain('This is a test');
      expect(result.sourceMap[1].source).toContain('p.intro');
      expect(result.sourceMap[1].lineIndex).toBe(1);

      expect(result.formattedText).toBe('Hello World\nThis is a test');
    });

    it('should prefer ID selectors over other attributes', () => {
      const html = `
        <html>
          <body>
            <div id="unique-id" class="some-class" data-test="value">Content</div>
          </body>
        </html>
      `;

      const result = extractTextWithSources(html);

      expect(result.sourceMap).toHaveLength(1);
      expect(result.sourceMap[0].source).toBe('#unique-id');
    });

    it('should use data attributes when no ID is present', () => {
      const html = `
        <html>
          <body>
            <div data-testid="my-element" class="some-class">Content</div>
          </body>
        </html>
      `;

      const result = extractTextWithSources(html);

      expect(result.sourceMap).toHaveLength(1);
      expect(result.sourceMap[0].source).toBe('div[data-testid="my-element"]');
    });

    it('should generate path with classes when no ID or data attributes', () => {
      const html = `
        <html>
          <body>
            <div class="container">
              <p class="text">Some text here</p>
            </div>
          </body>
        </html>
      `;

      const result = extractTextWithSources(html);

      // Both container and p elements will have text extracted
      expect(result.sourceMap.length).toBeGreaterThanOrEqual(1);
      const textEntry = result.sourceMap.find((entry) =>
        entry.source.includes('p.text')
      );
      expect(textEntry).toBeDefined();
    });

    it('should remove script and style tags', () => {
      const html = `
        <html>
          <head>
            <script>console.log('test');</script>
            <style>.test { color: red; }</style>
          </head>
          <body>
            <div>Visible content</div>
            <script>alert('hello');</script>
          </body>
        </html>
      `;

      const result = extractTextWithSources(html);

      expect(result.sourceMap).toHaveLength(1);
      expect(result.sourceMap[0].text).toBe('Visible content');
      expect(result.formattedText).not.toContain('console.log');
      expect(result.formattedText).not.toContain('color: red');
    });

    it('should extract separate text nodes from elements with mixed content', () => {
      const html = `
        <html>
          <body>
            <p>Part one <span>part two</span> part three</p>
          </body>
        </html>
      `;

      const result = extractTextWithSources(html);

      // Now extracts each text node separately
      expect(result.sourceMap).toHaveLength(3);
      expect(result.sourceMap.map((s) => s.text)).toContain('Part one');
      expect(result.sourceMap.map((s) => s.text)).toContain('part two');
      expect(result.sourceMap.map((s) => s.text)).toContain('part three');

      // Should have specific selectors for each
      expect(result.sourceMap[0].source).toContain('p');
      expect(result.sourceMap[1].source).toContain('span');
    });

    it('should handle nested elements correctly', () => {
      const html = `
        <html>
          <body>
            <div class="outer">
              <div class="inner">
                <span>Nested text</span>
              </div>
            </div>
          </body>
        </html>
      `;

      const result = extractTextWithSources(html);

      // All nested elements with the same text will be extracted
      expect(result.sourceMap.length).toBeGreaterThanOrEqual(1);
      const spanEntry = result.sourceMap.find(
        (entry) => entry.text === 'Nested text'
      );
      expect(spanEntry).toBeDefined();
    });

    it('should assign correct line indices', () => {
      const html = `
        <html>
          <body>
            <div>Line 0</div>
            <div>Line 1</div>
            <div>Line 2</div>
          </body>
        </html>
      `;

      const result = extractTextWithSources(html);

      expect(result.sourceMap).toHaveLength(3);
      expect(result.sourceMap[0].lineIndex).toBe(0);
      expect(result.sourceMap[1].lineIndex).toBe(1);
      expect(result.sourceMap[2].lineIndex).toBe(2);
    });

    it('should format text with newline separators', () => {
      const html = `
        <html>
          <body>
            <div>First line</div>
            <div>Second line</div>
            <div>Third line</div>
          </body>
        </html>
      `;

      const result = extractTextWithSources(html);

      expect(result.formattedText).toBe('First line\nSecond line\nThird line');
    });

    it('should skip elements with very short text', () => {
      const html = `
        <html>
          <body>
            <div>OK</div>
            <div>This is long enough</div>
            <div>X</div>
          </body>
        </html>
      `;

      const result = extractTextWithSources(html);

      expect(result.sourceMap).toHaveLength(1);
      expect(result.sourceMap[0].text).toBe('This is long enough');
    });

    it('should handle empty HTML gracefully', () => {
      const html = '<html><body></body></html>';

      const result = extractTextWithSources(html);

      expect(result.sourceMap).toHaveLength(0);
      expect(result.formattedText).toBe('');
    });

    it('should preserve original text content', () => {
      const html = `
        <html>
          <body>
            <div>Text   with    multiple     spaces</div>
          </body>
        </html>
      `;

      const result = extractTextWithSources(html);

      // Text is trimmed but internal whitespace is preserved
      expect(result.sourceMap[0].text).toBe(
        'Text   with    multiple     spaces'
      );
    });

    it('should handle real-world HTML structure', () => {
      const html = `
        <!DOCTYPE html>
        <html>
          <head><title>Property Details</title></head>
          <body>
            <header id="header">Property Information</header>
            <main class="content">
              <div class="property-details">
                <h1 data-testid="address">123 Main Street</h1>
                <div class="price">$450,000</div>
                <div class="specs">
                  <span>3 bedrooms</span>
                  <span>2 bathrooms</span>
                </div>
              </div>
            </main>
          </body>
        </html>
      `;

      const result = extractTextWithSources(html);

      expect(result.sourceMap.length).toBeGreaterThan(0);

      const headerEntry = result.sourceMap.find((entry) =>
        entry.text.includes('Property Information')
      );
      expect(headerEntry?.source).toBe('#header');

      const addressEntry = result.sourceMap.find((entry) =>
        entry.text.includes('123 Main Street')
      );
      // The address text should be found
      expect(addressEntry).toBeDefined();

      expect(result.formattedText).toContain('123 Main Street');
      expect(result.formattedText).toContain('$450,000');
    });
  });
});
