import type {
  EntityWithSource,
  EntityTypeComparison,
  ComparisonResult,
} from './entity-comparison.service.js';
import type { ExtractedEntities } from './ner-entity-extractor.service.js';

function jaroWinkler(s1: string, s2: string): number {
  const m = s1.length;
  const n = s2.length;

  if (m === 0 && n === 0) return 1.0;
  if (m === 0 || n === 0) return 0.0;

  const matchDistance = Math.floor(Math.max(m, n) / 2) - 1;
  const s1Matches = new Array(m).fill(false);
  const s2Matches = new Array(n).fill(false);

  let matches = 0;
  let transpositions = 0;

  for (let i = 0; i < m; i++) {
    const start = Math.max(0, i - matchDistance);
    const end = Math.min(i + matchDistance + 1, n);

    for (let j = start; j < end; j++) {
      if (s2Matches[j]) continue;
      if (s1[i] !== s2[j]) continue;
      s1Matches[i] = true;
      s2Matches[j] = true;
      matches++;
      break;
    }
  }

  if (matches === 0) return 0.0;

  let k = 0;
  for (let i = 0; i < m; i++) {
    if (!s1Matches[i]) continue;
    while (!s2Matches[k]) k++;
    if (s1[i] !== s2[k]) transpositions++;
    k++;
  }

  const jaro =
    (matches / m + matches / n + (matches - transpositions / 2) / matches) / 3;

  let prefix = 0;
  for (let i = 0; i < Math.min(4, Math.min(m, n)); i++) {
    if (s1[i] === s2[i]) prefix++;
    else break;
  }

  return jaro + prefix * 0.1 * (1 - jaro);
}

export class ManualEntityMatcherService {
  matchUnmatchedEntities(
    comparison: ComparisonResult,
    rawEntities: ExtractedEntities,
    transformedLeafValues: string[]
  ): ComparisonResult {
    const normalizedLeaves = transformedLeafValues.map((v) => v.toLowerCase());

    const updatedComparison = { ...comparison };

    updatedComparison.ORGANIZATION = this.matchTextEntities(
      comparison.ORGANIZATION,
      rawEntities.ORGANIZATION,
      normalizedLeaves,
      0.88
    );

    updatedComparison.LOCATION = this.matchTextEntities(
      comparison.LOCATION,
      rawEntities.LOCATION,
      normalizedLeaves,
      0.88
    );

    updatedComparison.QUANTITY = this.matchExactEntities(
      comparison.QUANTITY,
      rawEntities.QUANTITY,
      transformedLeafValues
    );

    updatedComparison.DATE = this.matchExactEntities(
      comparison.DATE,
      rawEntities.DATE,
      transformedLeafValues
    );

    updatedComparison.globalCompleteness =
      this.recalculateGlobalCompleteness(updatedComparison);

    return updatedComparison;
  }

  private matchTextEntities(
    categoryComparison: EntityTypeComparison,
    rawCategoryEntities: Array<{ value: string; confidence: number }>,
    normalizedLeaves: string[],
    similarityThreshold: number
  ): EntityTypeComparison {
    const unmatched = categoryComparison.unmatchedFromA as EntityWithSource[];
    const stillUnmatched: EntityWithSource[] = [];

    for (const unmatchedEntity of unmatched) {
      const normalizedValue = unmatchedEntity.value.toLowerCase();
      let found = false;

      for (const leaf of normalizedLeaves) {
        const similarity = jaroWinkler(normalizedValue, leaf);
        if (similarity >= similarityThreshold) {
          found = true;
          break;
        }
      }

      if (!found) {
        stillUnmatched.push(unmatchedEntity);
      }
    }

    const totalCount = categoryComparison.statsA.count;
    const newCoverage =
      totalCount > 0 ? (totalCount - stillUnmatched.length) / totalCount : 0;

    return {
      ...categoryComparison,
      coverage: newCoverage,
      unmatchedFromA: stillUnmatched,
    };
  }

  private matchExactEntities(
    categoryComparison: EntityTypeComparison,
    rawCategoryEntities: Array<{ value: string; confidence: number }>,
    transformedLeafValues: string[]
  ): EntityTypeComparison {
    const unmatched = categoryComparison.unmatchedFromA as EntityWithSource[];
    const stillUnmatched: EntityWithSource[] = [];

    const leafSet = new Set(transformedLeafValues);

    for (const unmatchedEntity of unmatched) {
      if (!leafSet.has(unmatchedEntity.value)) {
        stillUnmatched.push(unmatchedEntity);
      }
    }

    const totalCount = categoryComparison.statsA.count;
    const newCoverage =
      totalCount > 0 ? (totalCount - stillUnmatched.length) / totalCount : 0;

    return {
      ...categoryComparison,
      coverage: newCoverage,
      unmatchedFromA: stillUnmatched,
    };
  }

  private recalculateGlobalCompleteness(comparison: ComparisonResult): number {
    const categories = [
      comparison.QUANTITY,
      comparison.DATE,
      comparison.ORGANIZATION,
      comparison.LOCATION,
    ];

    let totalWeightedCoverage = 0;
    let totalWeightForCoverage = 0;

    for (const cat of categories) {
      const weightForCoverage = cat.statsA.count * cat.statsA.avgConfidence;
      totalWeightedCoverage += cat.coverage * weightForCoverage;
      totalWeightForCoverage += weightForCoverage;
    }

    return totalWeightForCoverage > 0
      ? totalWeightedCoverage / totalWeightForCoverage
      : 0;
  }
}
