import { describe, it, expect, beforeAll } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import { NEREntityExtractorService } from '../../src/services/ner-entity-extractor.service.js';
import { EntityComparisonService } from '../../src/services/entity-comparison.service.js';
import { TransformDataAggregatorService } from '../../src/services/transform-data-aggregator.service.js';
import { cleanHtml } from '../../src/lib/common.js';

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

describe('Validate Completeness Integration Tests', () => {
  let extractor: NEREntityExtractorService;
  let comparisonService: EntityComparisonService;
  let aggregator: TransformDataAggregatorService;

  beforeAll(async () => {
    extractor = new NEREntityExtractorService();
    await extractor.initialize();
    comparisonService = new EntityComparisonService();
    aggregator = new TransformDataAggregatorService();
  }, 120000); // 2 minute timeout for model loading

  describe('Property 15955960002', () => {
    it('should extract entities from HTML and JSON, then compare', async () => {
      const testDocsDir = path.join(
        process.cwd(),
        'tmp/nlp-testing-js/test_docs'
      );

      // Read HTML file
      const htmlPath = path.join(testDocsDir, '15955960002.html');
      const rawHtml = await fs.readFile(htmlPath, 'utf-8');
      const cleanedHtml = await cleanHtml(rawHtml);
      const htmlText = stripHtml(cleanedHtml);

      // Read JSON file
      const jsonPath = path.join(testDocsDir, '15955960002.json');
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
        money: htmlEntities.MONEY.length,
        date: htmlEntities.DATE.length,
        org: htmlEntities.ORGANIZATION.length,
        loc: htmlEntities.LOCATION.length,
      });

      // Extract entities from JSON
      console.log('Extracting entities from JSON...');
      const jsonEntities = await extractor.extractEntities(jsonText);
      console.log('JSON entities:', {
        money: jsonEntities.MONEY.length,
        date: jsonEntities.DATE.length,
        org: jsonEntities.ORGANIZATION.length,
        loc: jsonEntities.LOCATION.length,
      });

      // Both should have extracted some entities
      const totalHtmlEntities =
        htmlEntities.MONEY.length +
        htmlEntities.DATE.length +
        htmlEntities.ORGANIZATION.length +
        htmlEntities.LOCATION.length;

      const totalJsonEntities =
        jsonEntities.MONEY.length +
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
        moneyCosineSim: comparison.MONEY.cosineSimilarity.toFixed(2),
        moneyCoverage: (comparison.MONEY.coverage * 100).toFixed(1) + '%',
        dateCosineSim: comparison.DATE.cosineSimilarity.toFixed(2),
        dateCoverage: (comparison.DATE.coverage * 100).toFixed(1) + '%',
        orgCosineSim: comparison.ORGANIZATION.cosineSimilarity.toFixed(2),
        orgCoverage: (comparison.ORGANIZATION.coverage * 100).toFixed(1) + '%',
        locCosineSim: comparison.LOCATION.cosineSimilarity.toFixed(2),
        locCoverage: (comparison.LOCATION.coverage * 100).toFixed(1) + '%',
        globalCompleteness:
          (comparison.globalCompleteness * 100).toFixed(1) + '%',
      });

      // Comparison should produce valid metrics
      expect(comparison.MONEY.cosineSimilarity).toBeGreaterThanOrEqual(0);
      expect(comparison.MONEY.cosineSimilarity).toBeLessThanOrEqual(1);
      expect(comparison.MONEY.coverage).toBeGreaterThanOrEqual(0);
      expect(comparison.MONEY.coverage).toBeLessThanOrEqual(1);

      expect(comparison.DATE.cosineSimilarity).toBeGreaterThanOrEqual(0);
      expect(comparison.DATE.cosineSimilarity).toBeLessThanOrEqual(1);
      expect(comparison.DATE.coverage).toBeGreaterThanOrEqual(0);
      expect(comparison.DATE.coverage).toBeLessThanOrEqual(1);

      expect(comparison.globalCompleteness).toBeGreaterThanOrEqual(0);
      expect(comparison.globalCompleteness).toBeLessThanOrEqual(1);

      // Log sample entities for inspection
      if (htmlEntities.MONEY.length > 0) {
        console.log(
          'Sample HTML money entities:',
          htmlEntities.MONEY.slice(0, 5)
        );
      }
      if (jsonEntities.MONEY.length > 0) {
        console.log(
          'Sample JSON money entities:',
          jsonEntities.MONEY.slice(0, 5)
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
      const testDocsDir = path.join(
        process.cwd(),
        'tmp/nlp-testing-js/test_docs'
      );

      // Read HTML file
      const htmlPath = path.join(testDocsDir, '82615002181.html');
      const rawHtml = await fs.readFile(htmlPath, 'utf-8');
      const cleanedHtml = await cleanHtml(rawHtml);
      const htmlText = stripHtml(cleanedHtml);

      // Read JSON file
      const jsonPath = path.join(testDocsDir, '82615002181.json');
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
        money: htmlEntities.MONEY.length,
        date: htmlEntities.DATE.length,
        org: htmlEntities.ORGANIZATION.length,
        loc: htmlEntities.LOCATION.length,
      });

      // Extract entities from JSON
      console.log('Extracting entities from JSON...');
      const jsonEntities = await extractor.extractEntities(jsonText);
      console.log('JSON entities:', {
        money: jsonEntities.MONEY.length,
        date: jsonEntities.DATE.length,
        org: jsonEntities.ORGANIZATION.length,
        loc: jsonEntities.LOCATION.length,
      });

      // Both should have extracted some entities
      const totalHtmlEntities =
        htmlEntities.MONEY.length +
        htmlEntities.DATE.length +
        htmlEntities.ORGANIZATION.length +
        htmlEntities.LOCATION.length;

      const totalJsonEntities =
        jsonEntities.MONEY.length +
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
        moneyCosineSim: comparison.MONEY.cosineSimilarity.toFixed(2),
        moneyCoverage: (comparison.MONEY.coverage * 100).toFixed(1) + '%',
        dateCosineSim: comparison.DATE.cosineSimilarity.toFixed(2),
        dateCoverage: (comparison.DATE.coverage * 100).toFixed(1) + '%',
        orgCosineSim: comparison.ORGANIZATION.cosineSimilarity.toFixed(2),
        orgCoverage: (comparison.ORGANIZATION.coverage * 100).toFixed(1) + '%',
        locCosineSim: comparison.LOCATION.cosineSimilarity.toFixed(2),
        locCoverage: (comparison.LOCATION.coverage * 100).toFixed(1) + '%',
        globalCompleteness:
          (comparison.globalCompleteness * 100).toFixed(1) + '%',
      });

      // Comparison should produce valid metrics
      expect(comparison.MONEY.cosineSimilarity).toBeGreaterThanOrEqual(0);
      expect(comparison.MONEY.cosineSimilarity).toBeLessThanOrEqual(1);
      expect(comparison.MONEY.coverage).toBeGreaterThanOrEqual(0);
      expect(comparison.MONEY.coverage).toBeLessThanOrEqual(1);

      expect(comparison.DATE.cosineSimilarity).toBeGreaterThanOrEqual(0);
      expect(comparison.DATE.cosineSimilarity).toBeLessThanOrEqual(1);
      expect(comparison.DATE.coverage).toBeGreaterThanOrEqual(0);
      expect(comparison.DATE.coverage).toBeLessThanOrEqual(1);

      expect(comparison.globalCompleteness).toBeGreaterThanOrEqual(0);
      expect(comparison.globalCompleteness).toBeLessThanOrEqual(1);

      // Log sample entities for inspection
      if (htmlEntities.MONEY.length > 0) {
        console.log(
          'Sample HTML money entities:',
          htmlEntities.MONEY.slice(0, 5)
        );
      }
      if (jsonEntities.MONEY.length > 0) {
        console.log(
          'Sample JSON money entities:',
          jsonEntities.MONEY.slice(0, 5)
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
});
