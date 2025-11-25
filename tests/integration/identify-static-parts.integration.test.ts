import { describe, it, expect } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { StaticPartsIdentifierService } from '../../src/services/static-parts-identifier.service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('Identify Static Parts Integration Tests', () => {
  const service = new StaticPartsIdentifierService();

  it('should identify static parts from real property HTML files', async () => {
    const fixturesDir = path.join(__dirname, '../fixtures/mirror-validate');

    const html1Path = path.join(fixturesDir, '15955960002.html');
    const html2Path = path.join(fixturesDir, '82615002181.html');

    const html1 = await fs.readFile(html1Path, 'utf-8');
    const html2 = await fs.readFile(html2Path, 'utf-8');

    const selectors = await service.identifyStaticParts([html1, html2]);

    expect(Array.isArray(selectors)).toBe(true);
    expect(selectors.length).toBeGreaterThan(0);

    console.log(`Found ${selectors.length} static selectors`);
    console.log('Sample selectors:', selectors.slice(0, 5));

    for (const selector of selectors) {
      expect(typeof selector).toBe('string');
      expect(selector.length).toBeGreaterThan(0);
    }

    const hasIdSelector = selectors.some((s) => s.startsWith('#'));
    const hasStructuralSelector = selectors.some((s) => s.includes('>'));

    expect(hasIdSelector || hasStructuralSelector).toBe(true);
  }, 30000);

  it('should handle HTML files with different content in table cells', async () => {
    const html1 = `
      <html>
        <head><title>Property 1</title></head>
        <body>
          <header id="main-header"><h1>County Records</h1></header>
          <nav id="navigation"><ul><li>Home</li><li>Search</li></ul></nav>
          <table id="property-data">
            <thead><tr><th>Field</th><th>Value</th></tr></thead>
            <tbody>
              <tr><td>Address</td><td>123 Main St</td></tr>
              <tr><td>Value</td><td>$500,000</td></tr>
            </tbody>
          </table>
          <footer id="page-footer"><p>© 2024 County</p></footer>
        </body>
      </html>
    `;

    const html2 = `
      <html>
        <head><title>Property 2</title></head>
        <body>
          <header id="main-header"><h1>County Records</h1></header>
          <nav id="navigation"><ul><li>Home</li><li>Search</li></ul></nav>
          <table id="property-data">
            <thead><tr><th>Field</th><th>Value</th></tr></thead>
            <tbody>
              <tr><td>Address</td><td>456 Oak Ave</td></tr>
              <tr><td>Value</td><td>$750,000</td></tr>
            </tbody>
          </table>
          <footer id="page-footer"><p>© 2024 County</p></footer>
        </body>
      </html>
    `;

    const selectors = await service.identifyStaticParts([html1, html2]);

    expect(selectors).toContain('#main-header');
    expect(selectors).toContain('#navigation');
    expect(selectors).toContain('#page-footer');

    expect(selectors).not.toContain('#property-data');
  });

  it('should minimize selectors correctly', async () => {
    const html1 = `
      <html><body>
        <div id="parent-container">
          <div id="child-container">
            <div id="grandchild">Content here</div>
          </div>
        </div>
      </body></html>
    `;

    const html2 = `
      <html><body>
        <div id="parent-container">
          <div id="child-container">
            <div id="grandchild">Content here</div>
          </div>
        </div>
      </body></html>
    `;

    const selectors = await service.identifyStaticParts([html1, html2]);

    // Parent should definitely be included
    expect(selectors).toContain('#parent-container');
    // All nested elements are identical, so they'll all be selected
    // The minimization algorithm removes children if parent selector already covers them
    expect(selectors.length).toBeGreaterThan(0);
  });

  it('should handle varying attributes correctly', async () => {
    const html1 = `
      <html><body>
        <div id="dynamic-box" style="width:100px" data-timestamp="123">
          Static Content Here
        </div>
      </body></html>
    `;

    const html2 = `
      <html><body>
        <div id="dynamic-box" style="width:200px" data-timestamp="456">
          Static Content Here
        </div>
      </body></html>
    `;

    const selectors = await service.identifyStaticParts([html1, html2]);

    // Volatile attributes (style, data-*) are ignored, so content should match
    expect(selectors).toContain('#dynamic-box');
  });

  it('should work with three HTML files', async () => {
    const baseHtml = (id: string) => `
      <html><body>
        <header id="site-header">
          <h1>Site Title</h1>
          <nav id="main-nav"><ul><li>Link</li></ul></nav>
        </header>
        <main id="content-${id}">
          <p>Content for page ${id}</p>
        </main>
        <footer id="site-footer">
          <p>Copyright 2024</p>
        </footer>
      </body></html>
    `;

    const selectors = await service.identifyStaticParts([
      baseHtml('1'),
      baseHtml('2'),
      baseHtml('3'),
    ]);

    expect(selectors).toContain('#site-header');
    expect(selectors).toContain('#site-footer');
    expect(selectors).not.toContain('#content-1');
    expect(selectors).not.toContain('#content-2');
    expect(selectors).not.toContain('#content-3');
  });
});
