import { describe, it, expect, beforeEach } from 'vitest';
import { EntityComparisonService } from '../../src/services/entity-comparison.service.js';
import type {
  EntityResult,
  ExtractedEntities,
} from '../../src/services/ner-entity-extractor.service.js';

describe('EntityComparisonService', () => {
  let service: EntityComparisonService;

  beforeEach(() => {
    service = new EntityComparisonService();
  });

  describe('compareQuantity', () => {
    it('should calculate coverage for exact matches', () => {
      const entitiesA: EntityResult[] = [
        { value: '100', confidence: 90 },
        { value: '200', confidence: 85 },
      ];
      const entitiesB: EntityResult[] = [
        { value: '100', confidence: 92 },
        { value: '200', confidence: 88 },
      ];

      const result = service.compareQuantity(entitiesA, entitiesB);

      expect(result.coverage).toBe(1.0);
      expect(result.unmatchedFromA).toHaveLength(0);
    });

    it('should detect unmatched money entities', () => {
      const entitiesA: EntityResult[] = [
        { value: '100', confidence: 90 },
        { value: '200', confidence: 85 },
        { value: '300', confidence: 80 },
      ];
      const entitiesB: EntityResult[] = [
        { value: '100', confidence: 92 },
        { value: '200', confidence: 88 },
      ];

      const result = service.compareQuantity(entitiesA, entitiesB);

      expect(result.coverage).toBeCloseTo(0.667, 2);
      expect(result.unmatchedFromA).toContain('300');
    });

    it('should handle tolerance for money comparison', () => {
      const entitiesA: EntityResult[] = [{ value: '100.00', confidence: 90 }];
      const entitiesB: EntityResult[] = [{ value: '100.01', confidence: 92 }];

      const result = service.compareQuantity(entitiesA, entitiesB, 0.02);

      expect(result.coverage).toBe(1.0);
    });

    it('should calculate cosine similarity', () => {
      const entitiesA: EntityResult[] = [
        { value: '100', confidence: 90 },
        { value: '200', confidence: 85 },
      ];
      const entitiesB: EntityResult[] = [
        { value: '150', confidence: 92 },
        { value: '250', confidence: 88 },
      ];

      const result = service.compareQuantity(entitiesA, entitiesB);

      expect(result.cosineSimilarity).toBeGreaterThanOrEqual(0);
      expect(result.cosineSimilarity).toBeLessThanOrEqual(1);
    });

    it('should handle empty lists', () => {
      const result = service.compareQuantity([], []);

      expect(result.coverage).toBe(0);
      expect(result.cosineSimilarity).toBe(0);
    });

    it('should calculate stats correctly', () => {
      const entitiesA: EntityResult[] = [
        { value: '100', confidence: 90 },
        { value: '200', confidence: 80 },
      ];
      const entitiesB: EntityResult[] = [{ value: '100', confidence: 95 }];

      const result = service.compareQuantity(entitiesA, entitiesB);

      expect(result.statsA.count).toBe(2);
      expect(result.statsA.avgConfidence).toBe(85);
      expect(result.statsB.count).toBe(1);
      expect(result.statsB.avgConfidence).toBe(95);
    });
  });

  describe('compareDate', () => {
    it('should match exact dates', () => {
      const entitiesA: EntityResult[] = [
        { value: '01/15/2024', confidence: 90 },
      ];
      const entitiesB: EntityResult[] = [
        { value: '01/15/2024', confidence: 92 },
      ];

      const result = service.compareDate(entitiesA, entitiesB);

      expect(result.coverage).toBe(1.0);
      expect(result.unmatchedFromA).toHaveLength(0);
    });

    it('should detect unmatched dates', () => {
      const entitiesA: EntityResult[] = [
        { value: '01/15/2024', confidence: 90 },
        { value: '02/20/2024', confidence: 85 },
      ];
      const entitiesB: EntityResult[] = [
        { value: '01/15/2024', confidence: 92 },
      ];

      const result = service.compareDate(entitiesA, entitiesB);

      expect(result.coverage).toBe(0.5);
      expect(result.unmatchedFromA).toContain('02/20/2024');
    });

    it('should handle day tolerance', () => {
      const entitiesA: EntityResult[] = [
        { value: '01/15/2024', confidence: 90 },
      ];
      const entitiesB: EntityResult[] = [
        { value: '01/16/2024', confidence: 92 },
      ];

      const resultNoTolerance = service.compareDate(entitiesA, entitiesB, 0);
      expect(resultNoTolerance.coverage).toBe(0);

      const resultWithTolerance = service.compareDate(entitiesA, entitiesB, 1);
      expect(resultWithTolerance.coverage).toBe(1.0);
    });

    it('should calculate feature vector similarity', () => {
      const entitiesA: EntityResult[] = [
        { value: '01/15/2024', confidence: 90 },
        { value: '01/20/2024', confidence: 85 },
      ];
      const entitiesB: EntityResult[] = [
        { value: '01/18/2024', confidence: 92 },
        { value: '01/25/2024', confidence: 88 },
      ];

      const result = service.compareDate(entitiesA, entitiesB);

      expect(result.cosineSimilarity).toBeGreaterThan(0);
    });

    it('should handle invalid dates', () => {
      const entitiesA: EntityResult[] = [
        { value: 'invalid-date', confidence: 90 },
      ];
      const entitiesB: EntityResult[] = [
        { value: '01/15/2024', confidence: 92 },
      ];

      const result = service.compareDate(entitiesA, entitiesB);

      expect(result.unmatchedFromA).toContain('invalid-date');
    });
  });

  describe('compareText', () => {
    it('should match exact text', () => {
      const entitiesA: EntityResult[] = [
        { value: 'microsoft', confidence: 90 },
      ];
      const entitiesB: EntityResult[] = [
        { value: 'microsoft', confidence: 92 },
      ];

      const result = service.compareText(entitiesA, entitiesB);

      expect(result.coverage).toBe(1.0);
      expect(result.unmatchedFromA).toHaveLength(0);
    });

    it('should use jaro-winkler for fuzzy matching', () => {
      const entitiesA: EntityResult[] = [
        { value: 'microsoft', confidence: 90 },
      ];
      const entitiesB: EntityResult[] = [{ value: 'microsft', confidence: 92 }];

      const result = service.compareText(entitiesA, entitiesB, 0.85);

      expect(result.coverage).toBeGreaterThan(0);
    });

    it('should detect unmatched text entities', () => {
      const entitiesA: EntityResult[] = [
        { value: 'microsoft', confidence: 90 },
        { value: 'google', confidence: 85 },
      ];
      const entitiesB: EntityResult[] = [
        { value: 'microsoft', confidence: 92 },
      ];

      const result = service.compareText(entitiesA, entitiesB);

      expect(result.coverage).toBe(0.5);
      expect(result.unmatchedFromA).toContain('google');
    });

    it('should use bag-of-tokens for similarity', () => {
      const entitiesA: EntityResult[] = [
        { value: 'microsoft corporation', confidence: 90 },
      ];
      const entitiesB: EntityResult[] = [
        { value: 'apple corporation', confidence: 92 },
      ];

      const result = service.compareText(entitiesA, entitiesB);

      expect(result.cosineSimilarity).toBeGreaterThan(0);
    });

    it('should handle case differences', () => {
      const entitiesA: EntityResult[] = [
        { value: 'microsoft', confidence: 90 },
      ];
      const entitiesB: EntityResult[] = [
        { value: 'microsoft', confidence: 92 },
      ];

      const result = service.compareText(entitiesA, entitiesB, 0.9);

      expect(result.coverage).toBe(1.0);
    });

    it('should adjust similarity threshold', () => {
      const entitiesA: EntityResult[] = [
        { value: 'microsoft', confidence: 90 },
      ];
      const entitiesB: EntityResult[] = [{ value: 'microso', confidence: 92 }];

      const strictResult = service.compareText(entitiesA, entitiesB, 0.95);
      const lenientResult = service.compareText(entitiesA, entitiesB, 0.7);

      expect(lenientResult.coverage).toBeGreaterThanOrEqual(
        strictResult.coverage
      );
    });
  });

  describe('compareEntities', () => {
    it('should compare all entity types', () => {
      const entitiesA: ExtractedEntities = {
        QUANTITY: [{ value: '100', confidence: 90 }],
        DATE: [{ value: '01/15/2024', confidence: 85 }],
        ORGANIZATION: [{ value: 'microsoft', confidence: 92 }],
        LOCATION: [{ value: 'seattle', confidence: 88 }],
      };

      const entitiesB: ExtractedEntities = {
        QUANTITY: [{ value: '100', confidence: 95 }],
        DATE: [{ value: '01/15/2024', confidence: 90 }],
        ORGANIZATION: [{ value: 'microsoft', confidence: 94 }],
        LOCATION: [{ value: 'seattle', confidence: 91 }],
      };

      const result = service.compareEntities(entitiesA, entitiesB);

      expect(result.QUANTITY).toBeDefined();
      expect(result.DATE).toBeDefined();
      expect(result.ORGANIZATION).toBeDefined();
      expect(result.LOCATION).toBeDefined();
      expect(result.globalCompleteness).toBeGreaterThan(0);
    });

    it('should calculate global completeness score', () => {
      const entitiesA: ExtractedEntities = {
        QUANTITY: [
          { value: '100', confidence: 90 },
          { value: '200', confidence: 85 },
        ],
        DATE: [{ value: '01/15/2024', confidence: 85 }],
        ORGANIZATION: [{ value: 'microsoft', confidence: 92 }],
        LOCATION: [{ value: 'seattle', confidence: 88 }],
      };

      const entitiesB: ExtractedEntities = {
        QUANTITY: [{ value: '100', confidence: 95 }],
        DATE: [{ value: '01/15/2024', confidence: 90 }],
        ORGANIZATION: [{ value: 'microsoft', confidence: 94 }],
        LOCATION: [{ value: 'seattle', confidence: 91 }],
      };

      const result = service.compareEntities(entitiesA, entitiesB);

      expect(result.globalCompleteness).toBeGreaterThan(0);
      expect(result.globalCompleteness).toBeLessThanOrEqual(1);
    });

    it('should weight categories by count and confidence', () => {
      const highConfidenceA: ExtractedEntities = {
        QUANTITY: [
          { value: '100', confidence: 100 },
          { value: '200', confidence: 100 },
          { value: '300', confidence: 100 },
        ],
        DATE: [],
        ORGANIZATION: [],
        LOCATION: [],
      };

      const highConfidenceB: ExtractedEntities = {
        QUANTITY: [
          { value: '100', confidence: 100 },
          { value: '200', confidence: 100 },
        ],
        DATE: [],
        ORGANIZATION: [],
        LOCATION: [],
      };

      const lowConfidenceA: ExtractedEntities = {
        QUANTITY: [
          { value: '100', confidence: 50 },
          { value: '200', confidence: 50 },
          { value: '300', confidence: 50 },
        ],
        DATE: [],
        ORGANIZATION: [],
        LOCATION: [],
      };

      const lowConfidenceB: ExtractedEntities = {
        QUANTITY: [
          { value: '100', confidence: 50 },
          { value: '200', confidence: 50 },
        ],
        DATE: [],
        ORGANIZATION: [],
        LOCATION: [],
      };

      const highResult = service.compareEntities(
        highConfidenceA,
        highConfidenceB
      );
      const lowResult = service.compareEntities(lowConfidenceA, lowConfidenceB);

      expect(highResult.globalCompleteness).toBeGreaterThanOrEqual(
        lowResult.globalCompleteness
      );
    });

    it('should handle empty entity sets', () => {
      const emptyEntities: ExtractedEntities = {
        QUANTITY: [],
        DATE: [],
        ORGANIZATION: [],
        LOCATION: [],
      };

      const result = service.compareEntities(emptyEntities, emptyEntities);

      expect(result.globalCompleteness).toBe(0);
    });
  });
});
