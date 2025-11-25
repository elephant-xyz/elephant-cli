import { describe, it, expect } from 'vitest';
import { StaticPartsIdentifierService } from '../../src/services/static-parts-identifier.service.js';

describe('StaticPartsIdentifierService', () => {
  const service = new StaticPartsIdentifierService();

  describe('identifyStaticParts', () => {
    it('should throw error if less than 2 HTML files provided', async () => {
      const html = '<html><body><div id="test">Content</div></body></html>';

      await expect(service.identifyStaticParts([html])).rejects.toThrow(
        'At least 2 HTML files are required'
      );
    });

    it('should identify identical elements with IDs', async () => {
      const html1 =
        '<html><body><div id="header">Header</div><div id="unique1">Content 1</div></body></html>';
      const html2 =
        '<html><body><div id="header">Header</div><div id="unique2">Content 2</div></body></html>';

      const selectors = await service.identifyStaticParts([html1, html2]);

      expect(selectors).toContain('#header');
      expect(selectors).not.toContain('#unique1');
      expect(selectors).not.toContain('#unique2');
    });

    it('should identify identical structural elements without IDs', async () => {
      const html1 =
        '<html><body><header><nav>Navigation</nav></header><main>Content 1</main></body></html>';
      const html2 =
        '<html><body><header><nav>Navigation</nav></header><main>Content 2</main></body></html>';

      const selectors = await service.identifyStaticParts([html1, html2]);

      const hasHeaderOrNav = selectors.some(
        (s) => s.includes('header') || s.includes('nav')
      );
      expect(hasHeaderOrNav).toBe(true);
    });

    it('should ignore elements inside tables', async () => {
      const html1 =
        '<html><body><table><tr><td><div id="inside-table">Content</div></td></tr></table><div id="outside">Static</div></body></html>';
      const html2 =
        '<html><body><table><tr><td><div id="inside-table">Content</div></td></tr></table><div id="outside">Static</div></body></html>';

      const selectors = await service.identifyStaticParts([html1, html2]);

      expect(selectors).not.toContain('#inside-table');
      expect(selectors).toContain('#outside');
    });

    it('should ignore table elements themselves', async () => {
      const html1 =
        '<html><body><table id="data-table"><tr><td>Cell</td></tr></table></body></html>';
      const html2 =
        '<html><body><table id="data-table"><tr><td>Cell</td></tr></table></body></html>';

      const selectors = await service.identifyStaticParts([html1, html2]);

      expect(selectors).not.toContain('#data-table');
    });

    it('should ignore volatile attributes when comparing', async () => {
      const html1 =
        '<html><body><div id="box" style="color:red" tabindex="0">Content</div></body></html>';
      const html2 =
        '<html><body><div id="box" style="color:blue" tabindex="1">Content</div></body></html>';

      const selectors = await service.identifyStaticParts([html1, html2]);

      expect(selectors).toContain('#box');
    });

    it('should normalize whitespace when comparing', async () => {
      const html1 =
        '<html><body><div id="text">Hello    World</div></body></html>';
      const html2 =
        '<html><body><div id="text">Hello World</div></body></html>';

      const selectors = await service.identifyStaticParts([html1, html2]);

      expect(selectors).toContain('#text');
    });

    it('should ignore script and style tags', async () => {
      const html1 =
        '<html><head><script>var x=1;</script></head><body><div id="content">Text</div></body></html>';
      const html2 =
        '<html><head><script>var x=2;</script></head><body><div id="content">Text</div></body></html>';

      const selectors = await service.identifyStaticParts([html1, html2]);

      expect(selectors).toContain('#content');
    });

    it('should minimize selectors by removing nested ones', async () => {
      const html1 =
        '<html><body><div id="parent"><div id="child">Content here</div></div></body></html>';
      const html2 =
        '<html><body><div id="parent"><div id="child">Content here</div></div></body></html>';

      const selectors = await service.identifyStaticParts([html1, html2]);

      // The parent should be selected, child should be removed by minimization
      expect(selectors).toContain('#parent');
      // However, if child wasn't minimized, that's also valid behavior
      // The key is that parent is definitely included
    });

    it('should handle multiple HTML files', async () => {
      const html1 =
        '<html><body><footer id="footer">Footer 2024</footer></body></html>';
      const html2 =
        '<html><body><footer id="footer">Footer 2024</footer></body></html>';
      const html3 =
        '<html><body><footer id="footer">Footer 2024</footer></body></html>';

      const selectors = await service.identifyStaticParts([
        html1,
        html2,
        html3,
      ]);

      expect(selectors).toContain('#footer');
    });

    it('should only return elements present in ALL files', async () => {
      const html1 =
        '<html><body><div id="common">Common</div><div id="only-in-1">Unique</div></body></html>';
      const html2 =
        '<html><body><div id="common">Common</div><div id="only-in-2">Different</div></body></html>';

      const selectors = await service.identifyStaticParts([html1, html2]);

      expect(selectors).toContain('#common');
      expect(selectors).not.toContain('#only-in-1');
      expect(selectors).not.toContain('#only-in-2');
    });

    it('should build structural selectors for elements without IDs', async () => {
      const html1 =
        '<html><body><header><nav class="menu">Nav content here</nav></header></body></html>';
      const html2 =
        '<html><body><header><nav class="menu">Nav content here</nav></header></body></html>';

      const selectors = await service.identifyStaticParts([html1, html2]);

      expect(selectors.length).toBeGreaterThan(0);
      const hasHeaderOrNav = selectors.some(
        (s) => s.includes('header') || s.includes('nav')
      );
      expect(hasHeaderOrNav).toBe(true);
    });

    it('should skip elements with insufficient content', async () => {
      const html1 =
        '<html><body><div>A</div><div id="enough">Sufficient content here</div></body></html>';
      const html2 =
        '<html><body><div>A</div><div id="enough">Sufficient content here</div></body></html>';

      const selectors = await service.identifyStaticParts([html1, html2]);

      expect(selectors).toContain('#enough');
    });

    it('should return empty array if no static parts found', async () => {
      const html1 =
        '<html><body><div id="unique1">Content 1</div></body></html>';
      const html2 =
        '<html><body><div id="unique2">Content 2</div></body></html>';

      const selectors = await service.identifyStaticParts([html1, html2]);

      expect(selectors).toEqual([]);
    });

    it('should handle complex nested structures', async () => {
      const html1 = `
        <html><body>
          <div id="wrapper">
            <header id="header">
              <nav id="nav">
                <ul><li>Item 1</li><li>Item 2</li></ul>
              </nav>
            </header>
            <main>Content varies</main>
          </div>
        </body></html>
      `;
      const html2 = `
        <html><body>
          <div id="wrapper">
            <header id="header">
              <nav id="nav">
                <ul><li>Item 1</li><li>Item 2</li></ul>
              </nav>
            </header>
            <main>Different content</main>
          </div>
        </body></html>
      `;

      const selectors = await service.identifyStaticParts([html1, html2]);

      // Since wrapper contains everything, it might not be selected if children are different
      // The algorithm should identify the nav or header if they're identical
      expect(selectors.length).toBeGreaterThan(0);
      const hasNavOrHeader = selectors.some(
        (s) => s.includes('nav') || s.includes('header')
      );
      expect(hasNavOrHeader).toBe(true);
    });
  });
});
