import { describe, it, expect, beforeEach } from 'vitest';
import { ManualEntityMatcherService } from '../../src/services/manual-entity-matcher.service.js';
import type {
  ComparisonResult,
  EntityWithSource,
} from '../../src/services/entity-comparison.service.js';
import type { ExtractedEntities } from '../../src/services/ner-entity-extractor.service.js';

describe('ManualEntityMatcherService', () => {
  let service: ManualEntityMatcherService;

  beforeEach(() => {
    service = new ManualEntityMatcherService();
  });

  describe('matchUnmatchedEntities - ORGANIZATION', () => {
    it('should match organization with Jaro-Winkler similarity', () => {
      const rawEntities: ExtractedEntities = {
        QUANTITY: [],
        DATE: [],
        ORGANIZATION: [
          { value: 'cavalier sterling eisa ann', confidence: 83.4 },
        ],
        LOCATION: [],
      };

      const unmatchedOrg: EntityWithSource = {
        value: 'cavalier sterling eisa ann',
        source: '#test',
        confidence: 83.4,
      };

      const comparison: ComparisonResult = {
        QUANTITY: {
          cosineSimilarity: 0,
          coverage: 0,
          unmatchedFromA: [],
          statsA: { count: 0, avgConfidence: 0 },
          statsB: { count: 0, avgConfidence: 0 },
        },
        DATE: {
          cosineSimilarity: 0,
          coverage: 0,
          unmatchedFromA: [],
          statsA: { count: 0, avgConfidence: 0 },
          statsB: { count: 0, avgConfidence: 0 },
        },
        ORGANIZATION: {
          cosineSimilarity: 0.5,
          coverage: 0,
          unmatchedFromA: [unmatchedOrg],
          statsA: { count: 1, avgConfidence: 83.4 },
          statsB: { count: 0, avgConfidence: 0 },
        },
        LOCATION: {
          cosineSimilarity: 0,
          coverage: 0,
          unmatchedFromA: [],
          statsA: { count: 0, avgConfidence: 0 },
          statsB: { count: 0, avgConfidence: 0 },
        },
        globalCompleteness: 0,
        globalCosineSimilarity: 0,
      };

      const transformedLeaves = ['Cavalier Sterling Eisa Ann'];

      const result = service.matchUnmatchedEntities(
        comparison,
        rawEntities,
        transformedLeaves
      );

      expect(result.ORGANIZATION.coverage).toBe(1.0);
      expect(result.ORGANIZATION.unmatchedFromA).toHaveLength(0);
      expect(result.globalCompleteness).toBeGreaterThan(0);
    });

    it('should not match organization below threshold', () => {
      const rawEntities: ExtractedEntities = {
        QUANTITY: [],
        DATE: [],
        ORGANIZATION: [{ value: 'completely different name', confidence: 80 }],
        LOCATION: [],
      };

      const unmatchedOrg: EntityWithSource = {
        value: 'completely different name',
        source: '#test',
        confidence: 80,
      };

      const comparison: ComparisonResult = {
        QUANTITY: {
          cosineSimilarity: 0,
          coverage: 0,
          unmatchedFromA: [],
          statsA: { count: 0, avgConfidence: 0 },
          statsB: { count: 0, avgConfidence: 0 },
        },
        DATE: {
          cosineSimilarity: 0,
          coverage: 0,
          unmatchedFromA: [],
          statsA: { count: 0, avgConfidence: 0 },
          statsB: { count: 0, avgConfidence: 0 },
        },
        ORGANIZATION: {
          cosineSimilarity: 0.5,
          coverage: 0,
          unmatchedFromA: [unmatchedOrg],
          statsA: { count: 1, avgConfidence: 80 },
          statsB: { count: 0, avgConfidence: 0 },
        },
        LOCATION: {
          cosineSimilarity: 0,
          coverage: 0,
          unmatchedFromA: [],
          statsA: { count: 0, avgConfidence: 0 },
          statsB: { count: 0, avgConfidence: 0 },
        },
        globalCompleteness: 0,
        globalCosineSimilarity: 0,
      };

      const transformedLeaves = ['Acme Corporation'];

      const result = service.matchUnmatchedEntities(
        comparison,
        rawEntities,
        transformedLeaves
      );

      expect(result.ORGANIZATION.coverage).toBe(0);
      expect(result.ORGANIZATION.unmatchedFromA).toHaveLength(1);
    });

    it('should handle case-insensitive matching for organization', () => {
      const rawEntities: ExtractedEntities = {
        QUANTITY: [],
        DATE: [],
        ORGANIZATION: [{ value: 'MICROSOFT CORP', confidence: 90 }],
        LOCATION: [],
      };

      const unmatchedOrg: EntityWithSource = {
        value: 'MICROSOFT CORP',
        source: '#test',
        confidence: 90,
      };

      const comparison: ComparisonResult = {
        QUANTITY: {
          cosineSimilarity: 0,
          coverage: 0,
          unmatchedFromA: [],
          statsA: { count: 0, avgConfidence: 0 },
          statsB: { count: 0, avgConfidence: 0 },
        },
        DATE: {
          cosineSimilarity: 0,
          coverage: 0,
          unmatchedFromA: [],
          statsA: { count: 0, avgConfidence: 0 },
          statsB: { count: 0, avgConfidence: 0 },
        },
        ORGANIZATION: {
          cosineSimilarity: 0.5,
          coverage: 0,
          unmatchedFromA: [unmatchedOrg],
          statsA: { count: 1, avgConfidence: 90 },
          statsB: { count: 0, avgConfidence: 0 },
        },
        LOCATION: {
          cosineSimilarity: 0,
          coverage: 0,
          unmatchedFromA: [],
          statsA: { count: 0, avgConfidence: 0 },
          statsB: { count: 0, avgConfidence: 0 },
        },
        globalCompleteness: 0,
        globalCosineSimilarity: 0,
      };

      const transformedLeaves = ['microsoft corp'];

      const result = service.matchUnmatchedEntities(
        comparison,
        rawEntities,
        transformedLeaves
      );

      expect(result.ORGANIZATION.coverage).toBe(1.0);
      expect(result.ORGANIZATION.unmatchedFromA).toHaveLength(0);
    });
  });

  describe('matchUnmatchedEntities - LOCATION', () => {
    it('should match location with Jaro-Winkler similarity', () => {
      const rawEntities: ExtractedEntities = {
        QUANTITY: [],
        DATE: [],
        ORGANIZATION: [],
        LOCATION: [{ value: 'new york city', confidence: 85 }],
      };

      const unmatchedLoc: EntityWithSource = {
        value: 'new york city',
        source: '#test',
        confidence: 85,
      };

      const comparison: ComparisonResult = {
        QUANTITY: {
          cosineSimilarity: 0,
          coverage: 0,
          unmatchedFromA: [],
          statsA: { count: 0, avgConfidence: 0 },
          statsB: { count: 0, avgConfidence: 0 },
        },
        DATE: {
          cosineSimilarity: 0,
          coverage: 0,
          unmatchedFromA: [],
          statsA: { count: 0, avgConfidence: 0 },
          statsB: { count: 0, avgConfidence: 0 },
        },
        ORGANIZATION: {
          cosineSimilarity: 0,
          coverage: 0,
          unmatchedFromA: [],
          statsA: { count: 0, avgConfidence: 0 },
          statsB: { count: 0, avgConfidence: 0 },
        },
        LOCATION: {
          cosineSimilarity: 0.5,
          coverage: 0,
          unmatchedFromA: [unmatchedLoc],
          statsA: { count: 1, avgConfidence: 85 },
          statsB: { count: 0, avgConfidence: 0 },
        },
        globalCompleteness: 0,
        globalCosineSimilarity: 0,
      };

      const transformedLeaves = ['New York City'];

      const result = service.matchUnmatchedEntities(
        comparison,
        rawEntities,
        transformedLeaves
      );

      expect(result.LOCATION.coverage).toBe(1.0);
      expect(result.LOCATION.unmatchedFromA).toHaveLength(0);
    });
  });

  describe('matchUnmatchedEntities - QUANTITY', () => {
    it('should match quantity with exact matching', () => {
      const rawEntities: ExtractedEntities = {
        QUANTITY: [{ value: '1000', confidence: 90 }],
        DATE: [],
        ORGANIZATION: [],
        LOCATION: [],
      };

      const unmatchedQty: EntityWithSource = {
        value: '1000',
        source: '#test',
        confidence: 90,
      };

      const comparison: ComparisonResult = {
        QUANTITY: {
          cosineSimilarity: 0.5,
          coverage: 0,
          unmatchedFromA: [unmatchedQty],
          statsA: { count: 1, avgConfidence: 90 },
          statsB: { count: 0, avgConfidence: 0 },
        },
        DATE: {
          cosineSimilarity: 0,
          coverage: 0,
          unmatchedFromA: [],
          statsA: { count: 0, avgConfidence: 0 },
          statsB: { count: 0, avgConfidence: 0 },
        },
        ORGANIZATION: {
          cosineSimilarity: 0,
          coverage: 0,
          unmatchedFromA: [],
          statsA: { count: 0, avgConfidence: 0 },
          statsB: { count: 0, avgConfidence: 0 },
        },
        LOCATION: {
          cosineSimilarity: 0,
          coverage: 0,
          unmatchedFromA: [],
          statsA: { count: 0, avgConfidence: 0 },
          statsB: { count: 0, avgConfidence: 0 },
        },
        globalCompleteness: 0,
        globalCosineSimilarity: 0,
      };

      const transformedLeaves = ['1000', 'other data'];

      const result = service.matchUnmatchedEntities(
        comparison,
        rawEntities,
        transformedLeaves
      );

      expect(result.QUANTITY.coverage).toBe(1.0);
      expect(result.QUANTITY.unmatchedFromA).toHaveLength(0);
    });

    it('should not match quantity with similar but not exact value', () => {
      const rawEntities: ExtractedEntities = {
        QUANTITY: [{ value: '1000', confidence: 90 }],
        DATE: [],
        ORGANIZATION: [],
        LOCATION: [],
      };

      const unmatchedQty: EntityWithSource = {
        value: '1000',
        source: '#test',
        confidence: 90,
      };

      const comparison: ComparisonResult = {
        QUANTITY: {
          cosineSimilarity: 0.5,
          coverage: 0,
          unmatchedFromA: [unmatchedQty],
          statsA: { count: 1, avgConfidence: 90 },
          statsB: { count: 0, avgConfidence: 0 },
        },
        DATE: {
          cosineSimilarity: 0,
          coverage: 0,
          unmatchedFromA: [],
          statsA: { count: 0, avgConfidence: 0 },
          statsB: { count: 0, avgConfidence: 0 },
        },
        ORGANIZATION: {
          cosineSimilarity: 0,
          coverage: 0,
          unmatchedFromA: [],
          statsA: { count: 0, avgConfidence: 0 },
          statsB: { count: 0, avgConfidence: 0 },
        },
        LOCATION: {
          cosineSimilarity: 0,
          coverage: 0,
          unmatchedFromA: [],
          statsA: { count: 0, avgConfidence: 0 },
          statsB: { count: 0, avgConfidence: 0 },
        },
        globalCompleteness: 0,
        globalCosineSimilarity: 0,
      };

      const transformedLeaves = ['1001', '999'];

      const result = service.matchUnmatchedEntities(
        comparison,
        rawEntities,
        transformedLeaves
      );

      expect(result.QUANTITY.coverage).toBe(0);
      expect(result.QUANTITY.unmatchedFromA).toHaveLength(1);
    });
  });

  describe('matchUnmatchedEntities - DATE', () => {
    it('should match date with exact matching', () => {
      const rawEntities: ExtractedEntities = {
        QUANTITY: [],
        DATE: [{ value: '01/15/2024', confidence: 85 }],
        ORGANIZATION: [],
        LOCATION: [],
      };

      const unmatchedDate: EntityWithSource = {
        value: '01/15/2024',
        source: '#test',
        confidence: 85,
      };

      const comparison: ComparisonResult = {
        QUANTITY: {
          cosineSimilarity: 0,
          coverage: 0,
          unmatchedFromA: [],
          statsA: { count: 0, avgConfidence: 0 },
          statsB: { count: 0, avgConfidence: 0 },
        },
        DATE: {
          cosineSimilarity: 0.5,
          coverage: 0,
          unmatchedFromA: [unmatchedDate],
          statsA: { count: 1, avgConfidence: 85 },
          statsB: { count: 0, avgConfidence: 0 },
        },
        ORGANIZATION: {
          cosineSimilarity: 0,
          coverage: 0,
          unmatchedFromA: [],
          statsA: { count: 0, avgConfidence: 0 },
          statsB: { count: 0, avgConfidence: 0 },
        },
        LOCATION: {
          cosineSimilarity: 0,
          coverage: 0,
          unmatchedFromA: [],
          statsA: { count: 0, avgConfidence: 0 },
          statsB: { count: 0, avgConfidence: 0 },
        },
        globalCompleteness: 0,
        globalCosineSimilarity: 0,
      };

      const transformedLeaves = ['01/15/2024', 'other data'];

      const result = service.matchUnmatchedEntities(
        comparison,
        rawEntities,
        transformedLeaves
      );

      expect(result.DATE.coverage).toBe(1.0);
      expect(result.DATE.unmatchedFromA).toHaveLength(0);
    });

    it('should not match date with off-by-one-day value', () => {
      const rawEntities: ExtractedEntities = {
        QUANTITY: [],
        DATE: [{ value: '01/15/2024', confidence: 85 }],
        ORGANIZATION: [],
        LOCATION: [],
      };

      const unmatchedDate: EntityWithSource = {
        value: '01/15/2024',
        source: '#test',
        confidence: 85,
      };

      const comparison: ComparisonResult = {
        QUANTITY: {
          cosineSimilarity: 0,
          coverage: 0,
          unmatchedFromA: [],
          statsA: { count: 0, avgConfidence: 0 },
          statsB: { count: 0, avgConfidence: 0 },
        },
        DATE: {
          cosineSimilarity: 0.5,
          coverage: 0,
          unmatchedFromA: [unmatchedDate],
          statsA: { count: 1, avgConfidence: 85 },
          statsB: { count: 0, avgConfidence: 0 },
        },
        ORGANIZATION: {
          cosineSimilarity: 0,
          coverage: 0,
          unmatchedFromA: [],
          statsA: { count: 0, avgConfidence: 0 },
          statsB: { count: 0, avgConfidence: 0 },
        },
        LOCATION: {
          cosineSimilarity: 0,
          coverage: 0,
          unmatchedFromA: [],
          statsA: { count: 0, avgConfidence: 0 },
          statsB: { count: 0, avgConfidence: 0 },
        },
        globalCompleteness: 0,
        globalCosineSimilarity: 0,
      };

      const transformedLeaves = ['01/16/2024', '01/14/2024'];

      const result = service.matchUnmatchedEntities(
        comparison,
        rawEntities,
        transformedLeaves
      );

      expect(result.DATE.coverage).toBe(0);
      expect(result.DATE.unmatchedFromA).toHaveLength(1);
    });
  });

  describe('matchUnmatchedEntities - global completeness recalculation', () => {
    it('should recalculate global completeness after manual matching', () => {
      const rawEntities: ExtractedEntities = {
        QUANTITY: [{ value: '1000', confidence: 90 }],
        DATE: [{ value: '01/15/2024', confidence: 85 }],
        ORGANIZATION: [
          { value: 'cavalier sterling eisa ann', confidence: 83.4 },
        ],
        LOCATION: [{ value: 'seattle', confidence: 88 }],
      };

      const comparison: ComparisonResult = {
        QUANTITY: {
          cosineSimilarity: 0.5,
          coverage: 0,
          unmatchedFromA: [{ value: '1000', source: '#test1', confidence: 90 }],
          statsA: { count: 1, avgConfidence: 90 },
          statsB: { count: 0, avgConfidence: 0 },
        },
        DATE: {
          cosineSimilarity: 0.5,
          coverage: 0,
          unmatchedFromA: [
            { value: '01/15/2024', source: '#test2', confidence: 85 },
          ],
          statsA: { count: 1, avgConfidence: 85 },
          statsB: { count: 0, avgConfidence: 0 },
        },
        ORGANIZATION: {
          cosineSimilarity: 0.5,
          coverage: 0,
          unmatchedFromA: [
            {
              value: 'cavalier sterling eisa ann',
              source: '#test3',
              confidence: 83.4,
            },
          ],
          statsA: { count: 1, avgConfidence: 83.4 },
          statsB: { count: 0, avgConfidence: 0 },
        },
        LOCATION: {
          cosineSimilarity: 0.5,
          coverage: 0,
          unmatchedFromA: [
            { value: 'seattle', source: '#test4', confidence: 88 },
          ],
          statsA: { count: 1, avgConfidence: 88 },
          statsB: { count: 0, avgConfidence: 0 },
        },
        globalCompleteness: 0,
        globalCosineSimilarity: 0,
      };

      const transformedLeaves = [
        '1000',
        '01/15/2024',
        'Cavalier Sterling Eisa Ann',
        'Seattle',
      ];

      const result = service.matchUnmatchedEntities(
        comparison,
        rawEntities,
        transformedLeaves
      );

      expect(result.QUANTITY.coverage).toBe(1.0);
      expect(result.DATE.coverage).toBe(1.0);
      expect(result.ORGANIZATION.coverage).toBe(1.0);
      expect(result.LOCATION.coverage).toBe(1.0);
      expect(result.globalCompleteness).toBe(1.0);
    });
  });
});
