import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat.js';
import type {
  ExtractedEntities,
  EntityResult,
} from './ner-entity-extractor.service.js';

dayjs.extend(customParseFormat);

export interface EntityTypeComparison {
  cosineSimilarity: number;
  coverage: number;
  unmatchedFromA: string[];
  statsA: {
    count: number;
    avgConfidence: number;
  };
  statsB: {
    count: number;
    avgConfidence: number;
  };
}

export interface ComparisonResult {
  QUANTITY: EntityTypeComparison;
  DATE: EntityTypeComparison;
  ORGANIZATION: EntityTypeComparison;
  LOCATION: EntityTypeComparison;
  globalCompleteness: number;
}

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

function cosineSimilarityFromHistogram(
  hist1: Map<number, number>,
  hist2: Map<number, number>
): number {
  const allKeys = new Set([...hist1.keys(), ...hist2.keys()]);
  let dotProduct = 0;
  let mag1 = 0;
  let mag2 = 0;

  for (const k of allKeys) {
    const v1 = hist1.get(k) || 0;
    const v2 = hist2.get(k) || 0;
    dotProduct += v1 * v2;
    mag1 += v1 * v1;
    mag2 += v2 * v2;
  }

  if (mag1 === 0 || mag2 === 0) return 0.0;
  return dotProduct / (Math.sqrt(mag1) * Math.sqrt(mag2));
}

function buildLogHistogram(
  values: number[],
  numBins = 20
): Map<number, number> {
  if (values.length === 0) return new Map();

  const logVals = values.map((v) => Math.log10(Math.max(v, 1)));
  const minLog = Math.min(...logVals);
  const maxLog = Math.max(...logVals);
  const binWidth = maxLog > minLog ? (maxLog - minLog) / numBins : 1;

  const hist = new Map<number, number>();

  for (const lv of logVals) {
    const bin = Math.floor((lv - minLog) / binWidth);
    hist.set(bin, (hist.get(bin) || 0) + 1);
  }

  return hist;
}

function buildDateFeatureVector(dates: string[]): Map<string, number> {
  const features = new Map<string, number>();

  for (const dateStr of dates) {
    const parsed = dayjs(dateStr, 'MM/DD/YYYY', true);
    if (!parsed.isValid()) continue;

    const year = parsed.year();
    const month = parsed.month() + 1;
    const day = parsed.date();

    const yearKey = `year_${year}`;
    features.set(yearKey, (features.get(yearKey) || 0) + 1);

    const monthSin = Math.sin((2 * Math.PI * month) / 12);
    const monthCos = Math.cos((2 * Math.PI * month) / 12);
    features.set('month_sin', (features.get('month_sin') || 0) + monthSin);
    features.set('month_cos', (features.get('month_cos') || 0) + monthCos);

    const daySin = Math.sin((2 * Math.PI * day) / 31);
    const dayCos = Math.cos((2 * Math.PI * day) / 31);
    features.set('day_sin', (features.get('day_sin') || 0) + daySin);
    features.set('day_cos', (features.get('day_cos') || 0) + dayCos);
  }

  return features;
}

function buildBagOfTokens(texts: string[]): Map<string, number> {
  const bag = new Map<string, number>();

  for (const text of texts) {
    const tokens = text
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length > 0);
    for (const token of tokens) {
      bag.set(token, (bag.get(token) || 0) + 1);
    }
  }

  return bag;
}

function cosineSimilarityFromMap(
  map1: Map<string, number>,
  map2: Map<string, number>
): number {
  const allKeys = new Set([...map1.keys(), ...map2.keys()]);
  let dotProduct = 0;
  let mag1 = 0;
  let mag2 = 0;

  for (const k of allKeys) {
    const v1 = map1.get(k) || 0;
    const v2 = map2.get(k) || 0;
    dotProduct += v1 * v2;
    mag1 += v1 * v1;
    mag2 += v2 * v2;
  }

  if (mag1 === 0 || mag2 === 0) return 0.0;
  return dotProduct / (Math.sqrt(mag1) * Math.sqrt(mag2));
}

export class EntityComparisonService {
  compareQuantity(
    entitiesA: EntityResult[],
    entitiesB: EntityResult[],
    tolerance = 0.01
  ): EntityTypeComparison {
    const valuesA = entitiesA.map((e) => parseFloat(e.value));
    const valuesB = entitiesB.map((e) => parseFloat(e.value));

    const histA = buildLogHistogram(valuesA);
    const histB = buildLogHistogram(valuesB);
    const cosineSimilarity = cosineSimilarityFromHistogram(histA, histB);

    const matched: string[] = [];
    const unmatched: string[] = [];

    for (const entityA of entitiesA) {
      const valA = parseFloat(entityA.value);
      let found = false;

      for (const valB of valuesB) {
        if (Math.abs(valA - valB) <= tolerance) {
          found = true;
          break;
        }
      }

      if (found) {
        matched.push(entityA.value);
      } else {
        unmatched.push(entityA.value);
      }
    }

    const coverage =
      entitiesA.length > 0 ? matched.length / entitiesA.length : 0;

    const avgConfA =
      entitiesA.length > 0
        ? entitiesA.reduce((sum, e) => sum + e.confidence, 0) / entitiesA.length
        : 0;
    const avgConfB =
      entitiesB.length > 0
        ? entitiesB.reduce((sum, e) => sum + e.confidence, 0) / entitiesB.length
        : 0;

    return {
      cosineSimilarity,
      coverage,
      unmatchedFromA: unmatched,
      statsA: { count: entitiesA.length, avgConfidence: avgConfA },
      statsB: { count: entitiesB.length, avgConfidence: avgConfB },
    };
  }

  compareDate(
    entitiesA: EntityResult[],
    entitiesB: EntityResult[],
    dayTolerance = 0
  ): EntityTypeComparison {
    const datesA = entitiesA.map((e) => e.value);
    const datesB = entitiesB.map((e) => e.value);

    const featuresA = buildDateFeatureVector(datesA);
    const featuresB = buildDateFeatureVector(datesB);
    const cosineSimilarity = cosineSimilarityFromMap(featuresA, featuresB);

    const parsedB = datesB
      .map((d) => dayjs(d, 'MM/DD/YYYY', true))
      .filter((d) => d.isValid());

    const matched: string[] = [];
    const unmatched: string[] = [];

    for (const entityA of entitiesA) {
      const parsedA = dayjs(entityA.value, 'MM/DD/YYYY', true);
      if (!parsedA.isValid()) {
        unmatched.push(entityA.value);
        continue;
      }

      let found = false;

      for (const dateB of parsedB) {
        const diffDays = Math.abs(parsedA.diff(dateB, 'day'));
        if (diffDays <= dayTolerance) {
          found = true;
          break;
        }
      }

      if (found) {
        matched.push(entityA.value);
      } else {
        unmatched.push(entityA.value);
      }
    }

    const coverage =
      entitiesA.length > 0 ? matched.length / entitiesA.length : 0;

    const avgConfA =
      entitiesA.length > 0
        ? entitiesA.reduce((sum, e) => sum + e.confidence, 0) / entitiesA.length
        : 0;
    const avgConfB =
      entitiesB.length > 0
        ? entitiesB.reduce((sum, e) => sum + e.confidence, 0) / entitiesB.length
        : 0;

    return {
      cosineSimilarity,
      coverage,
      unmatchedFromA: unmatched,
      statsA: { count: entitiesA.length, avgConfidence: avgConfA },
      statsB: { count: entitiesB.length, avgConfidence: avgConfB },
    };
  }

  compareText(
    entitiesA: EntityResult[],
    entitiesB: EntityResult[],
    similarityThreshold = 0.88
  ): EntityTypeComparison {
    const textsA = entitiesA.map((e) => e.value);
    const textsB = entitiesB.map((e) => e.value);

    const bagA = buildBagOfTokens(textsA);
    const bagB = buildBagOfTokens(textsB);
    const cosineSimilarity = cosineSimilarityFromMap(bagA, bagB);

    const matched: string[] = [];
    const unmatched: string[] = [];

    for (const entityA of entitiesA) {
      let found = false;

      for (const entityB of entitiesB) {
        const similarity = jaroWinkler(entityA.value, entityB.value);
        if (similarity >= similarityThreshold) {
          found = true;
          break;
        }
      }

      if (found) {
        matched.push(entityA.value);
      } else {
        unmatched.push(entityA.value);
      }
    }

    const coverage =
      entitiesA.length > 0 ? matched.length / entitiesA.length : 0;

    const avgConfA =
      entitiesA.length > 0
        ? entitiesA.reduce((sum, e) => sum + e.confidence, 0) / entitiesA.length
        : 0;
    const avgConfB =
      entitiesB.length > 0
        ? entitiesB.reduce((sum, e) => sum + e.confidence, 0) / entitiesB.length
        : 0;

    return {
      cosineSimilarity,
      coverage,
      unmatchedFromA: unmatched,
      statsA: { count: entitiesA.length, avgConfidence: avgConfA },
      statsB: { count: entitiesB.length, avgConfidence: avgConfB },
    };
  }

  compareEntities(
    entitiesA: ExtractedEntities,
    entitiesB: ExtractedEntities
  ): ComparisonResult {
    const quantityComparison = this.compareQuantity(
      entitiesA.QUANTITY,
      entitiesB.QUANTITY
    );
    const dateComparison = this.compareDate(entitiesA.DATE, entitiesB.DATE);
    const orgComparison = this.compareText(
      entitiesA.ORGANIZATION,
      entitiesB.ORGANIZATION
    );
    const locComparison = this.compareText(
      entitiesA.LOCATION,
      entitiesB.LOCATION
    );

    const categories = [
      { comparison: quantityComparison, label: 'QUANTITY' },
      { comparison: dateComparison, label: 'DATE' },
      { comparison: orgComparison, label: 'ORGANIZATION' },
      { comparison: locComparison, label: 'LOCATION' },
    ];

    let totalWeightedCoverage = 0;
    let totalWeight = 0;

    for (const cat of categories) {
      const weight =
        cat.comparison.statsA.count * cat.comparison.statsA.avgConfidence;
      totalWeightedCoverage += cat.comparison.coverage * weight;
      totalWeight += weight;
    }

    const globalCompleteness =
      totalWeight > 0 ? totalWeightedCoverage / totalWeight : 0;

    return {
      QUANTITY: quantityComparison,
      DATE: dateComparison,
      ORGANIZATION: orgComparison,
      LOCATION: locComparison,
      globalCompleteness,
    };
  }
}
