import { describe, it, expect, beforeAll } from 'vitest';

const isCI = process.env.CI === 'true';

// Skip entire file in CI to avoid loading native modules
if (isCI) {
  describe.skip('Mirror Validate Integration Tests (Skipped in CI)', () => {
    it('placeholder', () => {});
  });
} else {
  const { promises: fs } = await import('fs');
  const path = await import('path');
  const { fileURLToPath } = await import('url');
  const { dirname } = await import('path');
  const { NEREntityExtractorService } = await import(
    '../../src/services/ner-entity-extractor.service.js'
  );
  const { EntityComparisonService } = await import(
    '../../src/services/entity-comparison.service.js'
  );
  const { TransformDataAggregatorService } = await import(
    '../../src/services/transform-data-aggregator.service.js'
  );
  const { cleanHtml } = await import('../../src/lib/common.js');
  const { removeStaticParts } = await import(
    '../../src/utils/static-parts-filter.js'
  );

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);

  function stripHtml(html: string): string {
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  describe('Mirror Validate Integration Tests', () => {
    let extractor: InstanceType<typeof NEREntityExtractorService>;
    let comparisonService: InstanceType<typeof EntityComparisonService>;
    let aggregator: InstanceType<typeof TransformDataAggregatorService>;

    beforeAll(async () => {
      extractor = new NEREntityExtractorService();
      await extractor.initialize();
      comparisonService = new EntityComparisonService();
      aggregator = new TransformDataAggregatorService();
    }, 120000); // 2 minute timeout for model loading

    describe('Property 15955960002', () => {
      it('should extract entities from HTML and JSON, then compare', async () => {
        const fixturesDir = path.join(__dirname, '../fixtures/mirror-validate');

        // Read HTML file
        const htmlPath = path.join(fixturesDir, '15955960002.html');
        const rawHtml = await fs.readFile(htmlPath, 'utf-8');
        const cleanedHtml = await cleanHtml(rawHtml);
        const htmlText = stripHtml(cleanedHtml);

        // Read JSON file
        const jsonPath = path.join(fixturesDir, '15955960002.json');
        const jsonContent = await fs.readFile(jsonPath, 'utf-8');
        const jsonData = JSON.parse(jsonContent);

        // Convert JSON to text
        const jsonTextParts = aggregator.jsonToText(jsonData);
        const jsonText = jsonTextParts
          .join('. ')
          .replace(/\.\./g, '.')
          .replace(/\s+/g, ' ')
          .trim();

        // Extract entities from HTML
        console.log('Extracting entities from HTML...');
        const htmlEntities = await extractor.extractEntities(htmlText);
        console.log('HTML entities:', {
          quantity: htmlEntities.QUANTITY.length,
          date: htmlEntities.DATE.length,
          org: htmlEntities.ORGANIZATION.length,
          loc: htmlEntities.LOCATION.length,
        });

        // Extract entities from JSON
        console.log('Extracting entities from JSON...');
        const jsonEntities = await extractor.extractEntities(jsonText);
        console.log('JSON entities:', {
          quantity: jsonEntities.QUANTITY.length,
          date: jsonEntities.DATE.length,
          org: jsonEntities.ORGANIZATION.length,
          loc: jsonEntities.LOCATION.length,
        });

        // Both should have extracted some entities
        const totalHtmlEntities =
          htmlEntities.QUANTITY.length +
          htmlEntities.DATE.length +
          htmlEntities.ORGANIZATION.length +
          htmlEntities.LOCATION.length;

        const totalJsonEntities =
          jsonEntities.QUANTITY.length +
          jsonEntities.DATE.length +
          jsonEntities.ORGANIZATION.length +
          jsonEntities.LOCATION.length;

        expect(totalHtmlEntities).toBeGreaterThan(0);
        expect(totalJsonEntities).toBeGreaterThan(0);

        // Compare entities
        const comparison = comparisonService.compareEntities(
          htmlEntities,
          jsonEntities
        );

        console.log('Comparison results:', {
          quantityCosineSim: comparison.QUANTITY.cosineSimilarity.toFixed(2),
          quantityCoverage:
            (comparison.QUANTITY.coverage * 100).toFixed(1) + '%',
          dateCosineSim: comparison.DATE.cosineSimilarity.toFixed(2),
          dateCoverage: (comparison.DATE.coverage * 100).toFixed(1) + '%',
          orgCosineSim: comparison.ORGANIZATION.cosineSimilarity.toFixed(2),
          orgCoverage:
            (comparison.ORGANIZATION.coverage * 100).toFixed(1) + '%',
          locCosineSim: comparison.LOCATION.cosineSimilarity.toFixed(2),
          locCoverage: (comparison.LOCATION.coverage * 100).toFixed(1) + '%',
          globalCompleteness:
            (comparison.globalCompleteness * 100).toFixed(1) + '%',
        });

        // Comparison should produce valid metrics
        expect(comparison.QUANTITY.cosineSimilarity).toBeGreaterThanOrEqual(0);
        expect(comparison.QUANTITY.cosineSimilarity).toBeLessThanOrEqual(1);
        expect(comparison.QUANTITY.coverage).toBeGreaterThanOrEqual(0);
        expect(comparison.QUANTITY.coverage).toBeLessThanOrEqual(1);

        expect(comparison.DATE.cosineSimilarity).toBeGreaterThanOrEqual(0);
        expect(comparison.DATE.cosineSimilarity).toBeLessThanOrEqual(1);
        expect(comparison.DATE.coverage).toBeGreaterThanOrEqual(0);
        expect(comparison.DATE.coverage).toBeLessThanOrEqual(1);

        expect(comparison.globalCompleteness).toBeGreaterThanOrEqual(0);
        expect(comparison.globalCompleteness).toBeLessThanOrEqual(1);

        // Log sample entities for inspection
        if (htmlEntities.QUANTITY.length > 0) {
          console.log(
            'Sample HTML money entities:',
            htmlEntities.QUANTITY.slice(0, 5)
          );
        }
        if (jsonEntities.QUANTITY.length > 0) {
          console.log(
            'Sample JSON money entities:',
            jsonEntities.QUANTITY.slice(0, 5)
          );
        }
        if (htmlEntities.DATE.length > 0) {
          console.log(
            'Sample HTML date entities:',
            htmlEntities.DATE.slice(0, 5)
          );
        }
        if (jsonEntities.DATE.length > 0) {
          console.log(
            'Sample JSON date entities:',
            jsonEntities.DATE.slice(0, 5)
          );
        }
      }, 60000); // 1 minute timeout for extraction
    });

    describe('Property 82615002181', () => {
      it('should extract entities from HTML and JSON, then compare', async () => {
        const fixturesDir = path.join(__dirname, '../fixtures/mirror-validate');

        // Read HTML file
        const htmlPath = path.join(fixturesDir, '82615002181.html');
        const rawHtml = await fs.readFile(htmlPath, 'utf-8');
        const cleanedHtml = await cleanHtml(rawHtml);
        const htmlText = stripHtml(cleanedHtml);

        // Read JSON file
        const jsonPath = path.join(fixturesDir, '82615002181.json');
        const jsonContent = await fs.readFile(jsonPath, 'utf-8');
        const jsonData = JSON.parse(jsonContent);

        // Convert JSON to text
        const jsonTextParts = aggregator.jsonToText(jsonData);
        const jsonText = jsonTextParts
          .join('. ')
          .replace(/\.\./g, '.')
          .replace(/\s+/g, ' ')
          .trim();

        // Extract entities from HTML
        console.log('Extracting entities from HTML...');
        const htmlEntities = await extractor.extractEntities(htmlText);
        console.log('HTML entities:', {
          quantity: htmlEntities.QUANTITY.length,
          date: htmlEntities.DATE.length,
          org: htmlEntities.ORGANIZATION.length,
          loc: htmlEntities.LOCATION.length,
        });

        // Extract entities from JSON
        console.log('Extracting entities from JSON...');
        const jsonEntities = await extractor.extractEntities(jsonText);
        console.log('JSON entities:', {
          quantity: jsonEntities.QUANTITY.length,
          date: jsonEntities.DATE.length,
          org: jsonEntities.ORGANIZATION.length,
          loc: jsonEntities.LOCATION.length,
        });

        // Both should have extracted some entities
        const totalHtmlEntities =
          htmlEntities.QUANTITY.length +
          htmlEntities.DATE.length +
          htmlEntities.ORGANIZATION.length +
          htmlEntities.LOCATION.length;

        const totalJsonEntities =
          jsonEntities.QUANTITY.length +
          jsonEntities.DATE.length +
          jsonEntities.ORGANIZATION.length +
          jsonEntities.LOCATION.length;

        expect(totalHtmlEntities).toBeGreaterThan(0);
        expect(totalJsonEntities).toBeGreaterThan(0);

        // Compare entities
        const comparison = comparisonService.compareEntities(
          htmlEntities,
          jsonEntities
        );

        console.log('Comparison results:', {
          quantityCosineSim: comparison.QUANTITY.cosineSimilarity.toFixed(2),
          quantityCoverage:
            (comparison.QUANTITY.coverage * 100).toFixed(1) + '%',
          dateCosineSim: comparison.DATE.cosineSimilarity.toFixed(2),
          dateCoverage: (comparison.DATE.coverage * 100).toFixed(1) + '%',
          orgCosineSim: comparison.ORGANIZATION.cosineSimilarity.toFixed(2),
          orgCoverage:
            (comparison.ORGANIZATION.coverage * 100).toFixed(1) + '%',
          locCosineSim: comparison.LOCATION.cosineSimilarity.toFixed(2),
          locCoverage: (comparison.LOCATION.coverage * 100).toFixed(1) + '%',
          globalCompleteness:
            (comparison.globalCompleteness * 100).toFixed(1) + '%',
        });

        // Comparison should produce valid metrics
        expect(comparison.QUANTITY.cosineSimilarity).toBeGreaterThanOrEqual(0);
        expect(comparison.QUANTITY.cosineSimilarity).toBeLessThanOrEqual(1);
        expect(comparison.QUANTITY.coverage).toBeGreaterThanOrEqual(0);
        expect(comparison.QUANTITY.coverage).toBeLessThanOrEqual(1);

        expect(comparison.DATE.cosineSimilarity).toBeGreaterThanOrEqual(0);
        expect(comparison.DATE.cosineSimilarity).toBeLessThanOrEqual(1);
        expect(comparison.DATE.coverage).toBeGreaterThanOrEqual(0);
        expect(comparison.DATE.coverage).toBeLessThanOrEqual(1);

        expect(comparison.globalCompleteness).toBeGreaterThanOrEqual(0);
        expect(comparison.globalCompleteness).toBeLessThanOrEqual(1);

        // Log sample entities for inspection
        if (htmlEntities.QUANTITY.length > 0) {
          console.log(
            'Sample HTML money entities:',
            htmlEntities.QUANTITY.slice(0, 5)
          );
        }
        if (jsonEntities.QUANTITY.length > 0) {
          console.log(
            'Sample JSON money entities:',
            jsonEntities.QUANTITY.slice(0, 5)
          );
        }
        if (htmlEntities.DATE.length > 0) {
          console.log(
            'Sample HTML date entities:',
            htmlEntities.DATE.slice(0, 5)
          );
        }
        if (jsonEntities.DATE.length > 0) {
          console.log(
            'Sample JSON date entities:',
            jsonEntities.DATE.slice(0, 5)
          );
        }
      }, 60000); // 1 minute timeout for extraction
    });

    describe('Static Parts Filtering', () => {
      it('should reduce entity count when filtering static parts', async () => {
        const html = `
        <html>
          <body>
            <header id="static-header">
              <nav>
                <div>The listing price is $100,000 and the property tax is $2,500 annually.</div>
                <div>This website was last updated on 01/01/2024 at 3:00 PM.</div>
                <div>Contact us at Seattle office for more information.</div>
              </nav>
            </header>
            <main>
              <div>The property is valued at $250,000 based on recent appraisal.</div>
              <div>The sale was completed on 03/15/2024 with the closing on 03/20/2024.</div>
              <div>Located in downtown Seattle near Microsoft headquarters.</div>
            </main>
          </body>
        </html>
      `;

        const cleanedHtml = await cleanHtml(html);
        const textWithoutFilter = stripHtml(cleanedHtml);

        const filteredHtml = removeStaticParts(cleanedHtml, ['#static-header']);
        const textWithFilter = stripHtml(filteredHtml);

        const entitiesWithoutFilter =
          await extractor.extractEntities(textWithoutFilter);
        const entitiesWithFilter =
          await extractor.extractEntities(textWithFilter);

        // With filter, we should have fewer entities (header content removed)
        const totalWithoutFilter =
          entitiesWithoutFilter.QUANTITY.length +
          entitiesWithoutFilter.DATE.length +
          entitiesWithoutFilter.ORGANIZATION.length +
          entitiesWithoutFilter.LOCATION.length;
        const totalWithFilter =
          entitiesWithFilter.QUANTITY.length +
          entitiesWithFilter.DATE.length +
          entitiesWithFilter.ORGANIZATION.length +
          entitiesWithFilter.LOCATION.length;

        expect(totalWithFilter).toBeLessThan(totalWithoutFilter);

        // Verify main content entities are still present
        expect(totalWithFilter).toBeGreaterThan(0);
      });
    });
  });
}
