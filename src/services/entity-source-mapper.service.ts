import type { EntityResult } from './ner-entity-extractor.service.js';
import type { TextWithSource } from '../utils/html-source-extractor.js';

export interface EntityWithSource {
  value: string;
  source: string;
  confidence: number;
}

function findSourceForPosition(
  position: number,
  sourceMap: TextWithSource[]
): TextWithSource | null {
  if (position === undefined || position === null) {
    return null;
  }

  // Build cumulative positions from sourceMap to find which entry contains this position
  let cumulativePos = 0;

  for (const entry of sourceMap) {
    const textLength = entry.text.length;
    const entryStart = cumulativePos;
    const entryEnd = cumulativePos + textLength;

    // Check if position falls within this entry
    if (position >= entryStart && position < entryEnd) {
      return entry;
    }

    // Add 1 for the newline character between entries
    cumulativePos = entryEnd + 1;
  }

  // If position is at or after the end, return last entry
  if (sourceMap.length > 0 && position >= cumulativePos - 1) {
    return sourceMap[sourceMap.length - 1];
  }

  return null;
}

export function mapEntitiesToSources(
  entities: EntityResult[],
  sourceMap: TextWithSource[],
  _formattedText: string
): EntityWithSource[] {
  const result: EntityWithSource[] = [];

  for (const entity of entities) {
    if (entity.start === undefined || entity.start === null) {
      // No position information, cannot map
      result.push({
        value: entity.value,
        source: 'unknown',
        confidence: entity.confidence,
      });
      continue;
    }

    const sourceEntry = findSourceForPosition(entity.start, sourceMap);

    if (sourceEntry) {
      result.push({
        value: entity.value,
        source: sourceEntry.source,
        confidence: entity.confidence,
      });
    } else {
      result.push({
        value: entity.value,
        source: 'unknown',
        confidence: entity.confidence,
      });
    }
  }

  return result;
}
