import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import { tmpdir } from 'os';
import {
  parseStaticPartsCsv,
  removeStaticParts,
} from '../../../src/utils/static-parts-filter.js';

describe('static-parts-filter', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(tmpdir(), 'static-parts-test-'));
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe('parseStaticPartsCsv', () => {
    it('should parse CSV with quoted selectors', async () => {
      const csvPath = path.join(testDir, 'test.csv');
      const csvContent = `cssSelector
"#header"
"#footer"
".menu"`;
      await fs.writeFile(csvPath, csvContent, 'utf-8');

      const selectors = await parseStaticPartsCsv(csvPath);

      expect(selectors).toEqual(['#header', '#footer', '.menu']);
    });

    it('should parse CSV without quotes', async () => {
      const csvPath = path.join(testDir, 'test.csv');
      const csvContent = `cssSelector
#header
#footer
.menu`;
      await fs.writeFile(csvPath, csvContent, 'utf-8');

      const selectors = await parseStaticPartsCsv(csvPath);

      expect(selectors).toEqual(['#header', '#footer', '.menu']);
    });

    it('should handle empty lines', async () => {
      const csvPath = path.join(testDir, 'test.csv');
      const csvContent = `cssSelector
"#header"

"#footer"

`;
      await fs.writeFile(csvPath, csvContent, 'utf-8');

      const selectors = await parseStaticPartsCsv(csvPath);

      expect(selectors).toEqual(['#header', '#footer']);
    });

    it('should return empty array for empty CSV', async () => {
      const csvPath = path.join(testDir, 'test.csv');
      const csvContent = `cssSelector`;
      await fs.writeFile(csvPath, csvContent, 'utf-8');

      const selectors = await parseStaticPartsCsv(csvPath);

      expect(selectors).toEqual([]);
    });

    it('should handle complex selectors', async () => {
      const csvPath = path.join(testDir, 'test.csv');
      const csvContent = `cssSelector
"body > div:nth-of-type(1) > header"
"div.container:nth-of-type(2)"
"#nav > ul > li:first-child"`;
      await fs.writeFile(csvPath, csvContent, 'utf-8');

      const selectors = await parseStaticPartsCsv(csvPath);

      expect(selectors).toHaveLength(3);
      expect(selectors[0]).toBe('body > div:nth-of-type(1) > header');
    });
  });

  describe('removeStaticParts', () => {
    it('should remove elements by ID', () => {
      const html = `
        <html><body>
          <div id="header">Header</div>
          <div id="content">Content</div>
          <div id="footer">Footer</div>
        </body></html>
      `;

      const filtered = removeStaticParts(html, ['#header', '#footer']);

      expect(filtered).not.toContain('id="header"');
      expect(filtered).not.toContain('id="footer"');
      expect(filtered).toContain('id="content"');
    });

    it('should remove elements by class', () => {
      const html = `
        <html><body>
          <div class="menu">Menu</div>
          <div class="content">Content</div>
        </body></html>
      `;

      const filtered = removeStaticParts(html, ['.menu']);

      expect(filtered).not.toContain('class="menu"');
      expect(filtered).toContain('class="content"');
    });

    it('should handle complex selectors', () => {
      const html = `
        <html><body>
          <div id="wrapper">
            <header>
              <nav><ul><li>Link</li></ul></nav>
            </header>
            <main>Content</main>
          </div>
        </body></html>
      `;

      const filtered = removeStaticParts(html, ['#wrapper > header']);

      expect(filtered).not.toContain('<header>');
      expect(filtered).toContain('<main>');
    });

    it('should return original HTML if no selectors provided', () => {
      const html = '<html><body><div>Content</div></body></html>';

      const filtered = removeStaticParts(html, []);

      expect(filtered).toBe(html);
    });

    it('should handle invalid selectors gracefully', () => {
      const html = '<html><body><div id="test">Content</div></body></html>';

      // Should not throw
      const filtered = removeStaticParts(html, ['#test', '::invalid::']);

      expect(filtered).not.toContain('id="test"');
    });

    it('should remove nested elements', () => {
      const html = `
        <html><body>
          <div id="parent">
            <div id="child">
              <span>Text</span>
            </div>
          </div>
          <div id="other">Other</div>
        </body></html>
      `;

      const filtered = removeStaticParts(html, ['#parent']);

      expect(filtered).not.toContain('id="parent"');
      expect(filtered).not.toContain('id="child"');
      expect(filtered).toContain('id="other"');
    });

    it('should handle multiple matching elements', () => {
      const html = `
        <html><body>
          <div class="item">Item 1</div>
          <div class="item">Item 2</div>
          <div class="item">Item 3</div>
          <div class="keep">Keep this</div>
        </body></html>
      `;

      const filtered = removeStaticParts(html, ['.item']);

      expect(filtered).not.toContain('class="item"');
      expect(filtered).toContain('class="keep"');
    });
  });
});
