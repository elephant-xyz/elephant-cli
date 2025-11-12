import { pipeline } from '@xenova/transformers';
import type { TokenClassificationPipeline } from '@xenova/transformers';
import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat.js';
import {
  configureTransformersJS,
  getModelCacheDir,
  getRemoteModelId,
  getLocalModelDir,
} from '../lib/nlp/index.js';

dayjs.extend(customParseFormat);

const MAX_CHARS = 1000;

export interface EntityResult {
  value: string;
  confidence: number;
  start?: number;
  end?: number;
}

export interface ExtractedEntities {
  QUANTITY: EntityResult[];
  DATE: EntityResult[];
  ORGANIZATION: EntityResult[];
  LOCATION: EntityResult[];
}

interface RawEntity {
  text: string;
  type: string;
  score: number;
  start?: number;
  end?: number;
}

interface Token {
  entity?: string;
  entity_group?: string;
  word?: string;
  score?: number;
  index?: number;
  start?: number | null;
  end?: number | null;
}

function normalizeEntityLabel(lbl: string): string {
  return (lbl || '').replace(/^B-/, '').replace(/^I-/, '');
}

function calculatePositions(entities: RawEntity[], text: string): RawEntity[] {
  const result: RawEntity[] = [];
  const textLines = text.split('\n');

  for (const entity of entities) {
    // If entity already has valid positions, keep them
    if (entity.start !== undefined && entity.end !== undefined) {
      result.push(entity);
      continue;
    }

    const entityText = entity.text;
    let bestMatch: { lineIdx: number; position: number; score: number } | null =
      null;
    let currentPos = 0;

    // Find ALL potential matches and score them
    for (let lineIdx = 0; lineIdx < textLines.length; lineIdx++) {
      const line = textLines[lineIdx];
      const lowerLine = line.toLowerCase();
      const lowerEntity = entityText.toLowerCase();

      // Check for exact match (best score)
      let position = line.indexOf(entityText);
      if (position !== -1) {
        const score = calculateMatchScore(line, entityText, position);
        if (!bestMatch || score > bestMatch.score) {
          bestMatch = { lineIdx, position: currentPos + position, score };
        }
      }

      // Check for case-insensitive match
      position = lowerLine.indexOf(lowerEntity);
      if (position !== -1) {
        const score = calculateMatchScore(line, entityText, position);
        if (!bestMatch || score > bestMatch.score) {
          bestMatch = { lineIdx, position: currentPos + position, score };
        }
      }

      currentPos += line.length + 1; // +1 for newline
    }

    if (bestMatch) {
      result.push({
        ...entity,
        start: bestMatch.position,
        end: bestMatch.position + entityText.length,
      });

      // Debug: log position mapping for numbers
      if (/^\d+$/.test(entityText)) {
        console.log(
          `[POS] Entity "${entityText}" → line ${bestMatch.lineIdx} (pos ${bestMatch.position}, score ${bestMatch.score}): "${textLines[bestMatch.lineIdx].substring(0, 50)}..."`
        );
      }
    } else {
      // Keep entity without position - will be marked as unknown source
      result.push(entity);
      console.warn(
        `[NER] Could not find position for entity "${entityText}" in text`
      );
    }
  }

  return result;
}

// Calculate match score to find the best match
// Higher score = better match
function calculateMatchScore(
  line: string,
  entityText: string,
  position: number
): number {
  let score = 0;

  // Base score for finding the entity
  score += 1;

  // Bonus if entity takes up most of the line (more specific)
  const lineLength = line.trim().length;
  const entityLength = entityText.length;
  const ratio = entityLength / lineLength;
  if (ratio > 0.5)
    score += 10; // Entity is >50% of line
  else if (ratio > 0.3) score += 5; // Entity is >30% of line

  // Bonus if line is short (more specific context)
  if (lineLength < 20) score += 3;

  // Bonus for exact case match
  if (line.includes(entityText)) score += 2;

  // Check character before entity (word boundary)
  if (position === 0 || /[\s,.\-:;!?()[\]{}]/.test(line[position - 1])) {
    score += 5;
  }

  // Check character after entity (word boundary)
  const endPos = position + entityText.length;
  if (endPos === line.length || /[\s,.\-:;!?()[\]{}]/.test(line[endPos])) {
    score += 5;
  }

  return score;
}

function aggregateEntities(items: Token[]): RawEntity[] {
  if (!items || items.length === 0) return [];

  const entityItems = items.filter(
    (t) => t.entity !== 'O' && !t.entity?.startsWith?.('O')
  );

  if (entityItems.length === 0) return [];

  const hasGroups = entityItems.some((t) => t.entity_group !== undefined);

  if (hasGroups) {
    return entityItems
      .filter((t) => t.entity_group)
      .map((t) => ({
        text: t.word || '',
        type: t.entity_group || '',
        score: t.score || 0,
        start: t.start !== null && t.start !== undefined ? t.start : undefined,
        end: t.end !== null && t.end !== undefined ? t.end : undefined,
      }));
  }

  const out: RawEntity[] = [];
  let cur: {
    text: string;
    type: string;
    scoreSum: number;
    count: number;
    start?: number;
    end?: number;
  } | null = null;
  let lastIndex = -1;

  const clean = (w: string) => (w || '').replace(/^##/, '').replace(/^▁/, '');

  for (const t of entityItems) {
    const type = normalizeEntityLabel(t.entity || '');
    const isSubword = t.word?.startsWith('##') || t.word?.startsWith('▁');
    const isContiguous =
      typeof t.index === 'number' && t.index === lastIndex + 1;
    const isBeginning = t.entity?.startsWith('B-');

    if (!cur) {
      cur = {
        text: clean(t.word || ''),
        type,
        scoreSum: t.score ?? 0,
        count: 1,
        start: t.start !== null && t.start !== undefined ? t.start : undefined,
        end: t.end !== null && t.end !== undefined ? t.end : undefined,
      };
      lastIndex = t.index ?? -1;
      continue;
    }

    const isNumericType = type === 'MONEY' || type === 'CARDINAL';
    const shouldIgnoreBeginning = (isNumericType && isContiguous) || isSubword;
    const shouldMerge =
      type === cur.type &&
      (isContiguous || isSubword) &&
      (!isBeginning || shouldIgnoreBeginning);

    if (shouldMerge) {
      const sep = isSubword ? '' : ' ';
      cur.text += sep + clean(t.word || '');
      cur.scoreSum += t.score ?? 0;
      cur.count += 1;
      if (t.end !== null && t.end !== undefined) {
        cur.end = t.end;
      }
      lastIndex = t.index ?? -1;
    } else {
      out.push({
        text: cur.text,
        type: cur.type,
        score: cur.scoreSum / cur.count,
        start: cur.start,
        end: cur.end,
      });
      cur = {
        text: clean(t.word || ''),
        type,
        scoreSum: t.score ?? 0,
        count: 1,
        start: t.start !== null && t.start !== undefined ? t.start : undefined,
        end: t.end !== null && t.end !== undefined ? t.end : undefined,
      };
      lastIndex = t.index ?? -1;
    }
  }

  if (cur) {
    out.push({
      text: cur.text,
      type: cur.type,
      score: cur.scoreSum / cur.count,
      start: cur.start,
      end: cur.end,
    });
  }

  return out;
}

function cleanupSpacing(text: string): string {
  let cleaned = text
    .replace(/\s*,\s*/g, ',')
    .replace(/\s*\.\s*/g, '.')
    .replace(/\s*\/\s*/g, '/')
    .replace(/\s*-\s*/g, '-')
    .replace(/\$\s+/g, '$')
    .replace(/\s+%/g, '%')
    .trim();

  cleaned = cleaned.replace(/([A-Za-z]+\s+\d+),(\d+)/g, '$1, $2');
  cleaned = cleaned.replace(/[.,;]+$/, '');
  return cleaned;
}

function uniqByText(arr: RawEntity[]): RawEntity[] {
  const seen = new Set<string>();
  const out: RawEntity[] = [];
  const candidates: RawEntity[] = [];

  for (const e of arr) {
    if (!e || !e.text) continue;
    const cleanedText = cleanupSpacing(e.text);
    candidates.push({ ...e, text: cleanedText });
  }

  for (const candidate of candidates) {
    const k = candidate.text.toLowerCase().replace(/[,.\s]/g, '');
    const isSubstring = candidates.some((other) => {
      if (other === candidate) return false;
      const otherKey = other.text.toLowerCase().replace(/[,.\s]/g, '');
      return otherKey.includes(k) && otherKey.length > k.length;
    });

    if (isSubstring) continue;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(candidate);
  }

  return out;
}

function expandNumericEntities(
  entities: RawEntity[],
  originalText: string
): RawEntity[] {
  return entities.map((entity) => {
    const { text, type } = entity;

    if (type !== 'MONEY' && type !== 'CARDINAL') return entity;

    const isLikelyIncomplete = /^\d{1,4}$/.test(text.trim());
    if (!isLikelyIncomplete) return entity;

    const pattern = new RegExp(
      `(?:[$€£¥])?\\s*(\\d{1,3}(?:[,.]\\d{3})*(?:[.]\\d+)?)(?=\\D|$)`,
      'gi'
    );
    let bestMatch: string | null = null;

    originalText.replace(pattern, (fullMatch, numberPart: string) => {
      const cleanNumber = numberPart.replace(/,/g, '');
      const cleanEntity = text.replace(/,/g, '');

      const startsExactly =
        cleanNumber === cleanEntity ||
        (cleanNumber.startsWith(cleanEntity) &&
          numberPart.charAt(cleanEntity.length) === ',');

      if (startsExactly && numberPart.length > text.length) {
        if (!bestMatch || numberPart.length > bestMatch.length) {
          bestMatch = numberPart;
        }
      }
      return fullMatch;
    });

    if (bestMatch) {
      return { ...entity, text: bestMatch };
    }

    return entity;
  });
}

function splitConcatenatedDates(entities: RawEntity[]): RawEntity[] {
  const result: RawEntity[] = [];

  for (const entity of entities) {
    if (entity.type !== 'DATE') {
      result.push(entity);
      continue;
    }

    const datePattern =
      /(\d{1,2}\s*\/\s*\d{1,2}(?:\s*\/\s*\d{2,4})?|\d{4}\s*-\s*\d{2}\s*-\s*\d{2})/g;
    const matches = entity.text.match(datePattern);

    if (matches && matches.length > 1) {
      matches.forEach((dateText) => {
        result.push({
          ...entity,
          text: dateText.trim(),
        });
      });
    } else {
      result.push(entity);
    }
  }

  return result;
}

function normalizeDates(dateEntities: RawEntity[]): RawEntity[] {
  const result: RawEntity[] = [];

  for (const entity of dateEntities) {
    const text = entity.text.trim();
    const textLower = text.toLowerCase();

    if (
      textLower.includes('each year') ||
      textLower.includes('every year') ||
      textLower.includes('monthly') ||
      textLower.includes('yearly') ||
      textLower.includes('daily') ||
      textLower.includes('weekly')
    ) {
      continue;
    }

    let parsedDate: string | null = null;

    const formats = [
      'MM/DD/YYYY',
      'MM/DD/YY',
      'M/D/YYYY',
      'M/D/YY',
      'YYYY-MM-DD',
      'YYYY-M-D',
      'MMMM DD, YYYY',
      'MMMM D, YYYY',
      'MMM DD, YYYY',
      'MMM D, YYYY',
      'DD MMMM YYYY',
      'D MMMM YYYY',
      'YYYY',
    ];

    for (const format of formats) {
      const parsed = dayjs(text, format, true);
      if (parsed.isValid()) {
        const year = parsed.year();
        if (year >= 1900 && year <= 2100) {
          parsedDate = parsed.format('MM/DD/YYYY');
          break;
        }
      }
    }

    if (parsedDate) {
      result.push({
        ...entity,
        text: parsedDate,
      });
    }
  }

  return result;
}

function normalizeNumericValue(value: string): string | null {
  const cleaned = value.replace(/[$€£¥,]/g, '').trim();
  const num = parseFloat(cleaned);

  if (isNaN(num) || !isFinite(num)) {
    return null;
  }

  return num.toString();
}

function normalizeQuantity(quantityEntities: RawEntity[]): RawEntity[] {
  const valueMap = new Map<string, RawEntity>();

  for (const entity of quantityEntities) {
    const text = entity.text.trim();

    if (text.includes('-')) {
      continue;
    }

    const parts = text.split(/\s+/);

    if (parts.length > 1) {
      for (const part of parts) {
        const normalized = normalizeNumericValue(part);

        if (normalized !== null) {
          const existing = valueMap.get(normalized);
          if (!existing || entity.score > existing.score) {
            valueMap.set(normalized, {
              ...entity,
              text: normalized,
            });
          }
        }
      }
    } else {
      const normalized = normalizeNumericValue(text);

      if (normalized !== null) {
        const existing = valueMap.get(normalized);
        if (!existing || entity.score > existing.score) {
          valueMap.set(normalized, {
            ...entity,
            text: normalized,
          });
        }
      }
    }
  }

  return Array.from(valueMap.values());
}

async function runInChunks(
  text: string,
  maxChars: number,
  pipe: TokenClassificationPipeline
): Promise<Token[]> {
  const chunks: string[] = [];
  const offsets: number[] = [];

  for (let i = 0; i < text.length; i += maxChars) {
    chunks.push(text.slice(i, i + maxChars));
    offsets.push(i);
  }

  const all: Token[] = [];

  for (let chunkIdx = 0; chunkIdx < chunks.length; chunkIdx++) {
    const chunk = chunks[chunkIdx];
    const offset = offsets[chunkIdx];
    const res = (await pipe(chunk)) as Token[];

    const adjusted = res.map((token) => ({
      ...token,
      start:
        token.start !== null && token.start !== undefined
          ? token.start + offset
          : null,
      end:
        token.end !== null && token.end !== undefined
          ? token.end + offset
          : null,
    }));

    all.push(...adjusted);
  }

  return all;
}

export class NEREntityExtractorService {
  private moneyPipeline: TokenClassificationPipeline | null = null;
  private locationPipeline: TokenClassificationPipeline | null = null;
  private initialized = false;

  async initialize(): Promise<void> {
    if (this.initialized) return;

    const moneyDateConfig = configureTransformersJS({
      localModelDir: getLocalModelDir('MONEY_DATE'),
      modelIdRemote: getRemoteModelId('MONEY_DATE'),
      cacheDir: getModelCacheDir(),
      preferLocal: true,
    });

    const perOrgLocConfig = configureTransformersJS({
      localModelDir: getLocalModelDir('PERSON_ORG_LOCATION'),
      modelIdRemote: getRemoteModelId('PERSON_ORG_LOCATION'),
      cacheDir: getModelCacheDir(),
      preferLocal: true,
    });

    this.moneyPipeline = (await pipeline(
      'token-classification',
      moneyDateConfig.modelId
    )) as TokenClassificationPipeline;
    this.locationPipeline = (await pipeline(
      'token-classification',
      perOrgLocConfig.modelId
    )) as TokenClassificationPipeline;

    this.initialized = true;
  }

  async extractEntities(text: string): Promise<ExtractedEntities> {
    if (!this.initialized) {
      await this.initialize();
    }

    if (!this.moneyPipeline || !this.locationPipeline) {
      throw new Error('NER pipelines not initialized');
    }

    const rawMoney =
      text.length > MAX_CHARS
        ? await runInChunks(text, MAX_CHARS, this.moneyPipeline)
        : ((await this.moneyPipeline(text)) as Token[]);

    const rawLocation =
      text.length > MAX_CHARS
        ? await runInChunks(text, MAX_CHARS, this.locationPipeline)
        : ((await this.locationPipeline(text)) as Token[]);

    const entitiesMoney = aggregateEntities(rawMoney);
    const entitiesLocation = aggregateEntities(rawLocation);

    const combinedEntities = [...entitiesMoney, ...entitiesLocation];
    const expandedEntities = expandNumericEntities(combinedEntities, text);
    const splitDates = splitConcatenatedDates(expandedEntities);

    const quantityAndCardinal = splitDates.filter(
      (e) => e.type === 'MONEY' || e.type === 'CARDINAL'
    );
    const quantity = quantityAndCardinal;

    const dates = uniqByText(splitDates.filter((e) => e.type === 'DATE'));
    const orgs = uniqByText(splitDates.filter((e) => e.type === 'ORG'));
    const locations = uniqByText(splitDates.filter((e) => e.type === 'LOC'));

    const normalizedDates = normalizeDates(dates);
    const normalizedQuantity = normalizeQuantity(quantity);

    // Calculate positions for all entities by searching in original text
    const quantityWithPos = calculatePositions(normalizedQuantity, text);
    const datesWithPos = calculatePositions(normalizedDates, text);
    const orgsWithPos = calculatePositions(orgs, text);
    const locationsWithPos = calculatePositions(locations, text);

    return {
      QUANTITY: quantityWithPos.map((e) => ({
        value: e.text,
        confidence: parseFloat((e.score * 100).toFixed(1)),
        start: e.start,
        end: e.end,
      })),
      DATE: datesWithPos.map((e) => ({
        value: e.text,
        confidence: parseFloat((e.score * 100).toFixed(1)),
        start: e.start,
        end: e.end,
      })),
      ORGANIZATION: orgsWithPos.map((e) => ({
        value: e.text.toLowerCase(),
        confidence: parseFloat((e.score * 100).toFixed(1)),
        start: e.start,
        end: e.end,
      })),
      LOCATION: locationsWithPos.map((e) => ({
        value: e.text.toLowerCase(),
        confidence: parseFloat((e.score * 100).toFixed(1)),
        start: e.start,
        end: e.end,
      })),
    };
  }
}
