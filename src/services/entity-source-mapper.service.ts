import type { EntityResult } from './ner-entity-extractor.service.js';
import type { TextWithSource } from '../utils/html-source-extractor.js';

export interface EntityWithSource {
  value: string;
  source: string;
}

function findLineIndexForPosition(
  text: string,
  position: number
): number | null {
  if (position === undefined || position === null) {
    return null;
  }

  let lineIndex = 0;

  for (let i = 0; i < text.length; i++) {
    if (i === position) {
      return lineIndex;
    }

    if (text[i] === '\n') {
      lineIndex++;
    }
  }

  // If position is at or after the end of the text
  if (position >= text.length) {
    return lineIndex;
  }

  return lineIndex;
}

export function mapEntitiesToSources(
  entities: EntityResult[],
  sourceMap: TextWithSource[],
  formattedText: string
): EntityWithSource[] {
  const result: EntityWithSource[] = [];

  for (const entity of entities) {
    if (entity.start === undefined || entity.start === null) {
      // No position information, cannot map
      result.push({
        value: entity.value,
        source: 'unknown',
      });
      continue;
    }

    const lineIndex = findLineIndexForPosition(formattedText, entity.start);

    if (lineIndex === null) {
      result.push({
        value: entity.value,
        source: 'unknown',
      });
      continue;
    }

    // Find the source entry for this line
    const sourceEntry = sourceMap.find(
      (entry) => entry.lineIndex === lineIndex
    );

    if (sourceEntry) {
      result.push({
        value: entity.value,
        source: sourceEntry.source,
      });
    } else {
      result.push({
        value: entity.value,
        source: 'unknown',
      });
    }
  }

  return result;
}
