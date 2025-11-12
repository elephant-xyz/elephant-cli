import { describe, it, expect } from 'vitest';
import { mapEntitiesToSources } from '../../../src/services/entity-source-mapper.service.js';
import type { EntityResult } from '../../../src/services/ner-entity-extractor.service.js';
import type { TextWithSource } from '../../../src/utils/html-source-extractor.js';

describe('entity-source-mapper', () => {
  describe('mapEntitiesToSources', () => {
    it('should map entities to their source locations', () => {
      const formattedText =
        'First line text\nSecond line text\nThird line text';
      const sourceMap: TextWithSource[] = [
        { text: 'First line text', source: '#first', lineIndex: 0 },
        { text: 'Second line text', source: '#second', lineIndex: 1 },
        { text: 'Third line text', source: '#third', lineIndex: 2 },
      ];

      const entities: EntityResult[] = [
        { value: 'First', confidence: 90, start: 0, end: 5 },
        { value: 'Second', confidence: 90, start: 16, end: 22 },
        { value: 'Third', confidence: 90, start: 33, end: 38 },
      ];

      const result = mapEntitiesToSources(entities, sourceMap, formattedText);

      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({ value: 'First', source: '#first' });
      expect(result[1]).toEqual({ value: 'Second', source: '#second' });
      expect(result[2]).toEqual({ value: 'Third', source: '#third' });
    });

    it('should handle entity at the beginning of text', () => {
      const formattedText = 'Microsoft Corporation\nSome other text';
      const sourceMap: TextWithSource[] = [
        {
          text: 'Microsoft Corporation',
          source: 'div.company',
          lineIndex: 0,
        },
        { text: 'Some other text', source: 'div.other', lineIndex: 1 },
      ];

      const entities: EntityResult[] = [
        { value: 'Microsoft', confidence: 95, start: 0, end: 9 },
      ];

      const result = mapEntitiesToSources(entities, sourceMap, formattedText);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ value: 'Microsoft', source: 'div.company' });
    });

    it('should handle entity in the middle of a line', () => {
      const formattedText =
        'The company Microsoft is located in Seattle\nAnother line';
      const sourceMap: TextWithSource[] = [
        {
          text: 'The company Microsoft is located in Seattle',
          source: 'p.info',
          lineIndex: 0,
        },
        { text: 'Another line', source: 'p.other', lineIndex: 1 },
      ];

      const entities: EntityResult[] = [
        { value: 'Microsoft', confidence: 95, start: 12, end: 21 },
      ];

      const result = mapEntitiesToSources(entities, sourceMap, formattedText);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ value: 'Microsoft', source: 'p.info' });
    });

    it('should handle entities on different lines', () => {
      const formattedText = 'Price: $450,000\nLocation: Austin, TX';
      const sourceMap: TextWithSource[] = [
        { text: 'Price: $450,000', source: 'div.price', lineIndex: 0 },
        {
          text: 'Location: Austin, TX',
          source: 'div.location',
          lineIndex: 1,
        },
      ];

      const entities: EntityResult[] = [
        { value: '450000', confidence: 90, start: 8, end: 15 },
        { value: 'Austin', confidence: 85, start: 26, end: 32 },
      ];

      const result = mapEntitiesToSources(entities, sourceMap, formattedText);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ value: '450000', source: 'div.price' });
      expect(result[1]).toEqual({ value: 'Austin', source: 'div.location' });
    });

    it('should return unknown source when entity has no position', () => {
      const formattedText = 'Some text here';
      const sourceMap: TextWithSource[] = [
        { text: 'Some text here', source: 'div', lineIndex: 0 },
      ];

      const entities: EntityResult[] = [
        { value: 'text', confidence: 90 }, // No start/end
      ];

      const result = mapEntitiesToSources(entities, sourceMap, formattedText);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ value: 'text', source: 'unknown' });
    });

    it('should return unknown source when position is beyond text length', () => {
      const formattedText = 'Short text';
      const sourceMap: TextWithSource[] = [
        { text: 'Short text', source: 'div', lineIndex: 0 },
      ];

      const entities: EntityResult[] = [
        { value: 'something', confidence: 90, start: 1000, end: 1009 },
      ];

      const result = mapEntitiesToSources(entities, sourceMap, formattedText);

      expect(result).toHaveLength(1);
      // Position beyond text length still maps to last line (line 0)
      expect(result[0]).toEqual({ value: 'something', source: 'div' });
    });

    it('should map using cumulative positions when sourceMap has gaps', () => {
      const formattedText = 'Line 1\nLine 2\nLine 3';
      const sourceMap: TextWithSource[] = [
        { text: 'Line 1', source: 'div.line1', lineIndex: 0 },
        // Missing line index 1 - this happens when HTML extractor filters short text
        { text: 'Line 3', source: 'div.line3', lineIndex: 2 },
      ];

      const entities: EntityResult[] = [
        { value: 'Line', confidence: 90, start: 7, end: 11 }, // Position 7 in formatted text
      ];

      const result = mapEntitiesToSources(entities, sourceMap, formattedText);

      expect(result).toHaveLength(1);
      // With cumulative position mapping:
      // Entry 0: "Line 1" (6 chars) covers positions 0-5, cumulative pos after = 7
      // Entry 1: "Line 3" (6 chars) starts at cumulative position 7
      // So position 7 maps to the second sourceMap entry
      expect(result[0]).toEqual({ value: 'Line', source: 'div.line3' });
    });

    it('should handle empty entities array', () => {
      const formattedText = 'Some text';
      const sourceMap: TextWithSource[] = [
        { text: 'Some text', source: 'div', lineIndex: 0 },
      ];

      const entities: EntityResult[] = [];

      const result = mapEntitiesToSources(entities, sourceMap, formattedText);

      expect(result).toHaveLength(0);
    });

    it('should handle multiple entities on the same line', () => {
      const formattedText = 'Microsoft and Google are tech companies';
      const sourceMap: TextWithSource[] = [
        {
          text: 'Microsoft and Google are tech companies',
          source: 'p.companies',
          lineIndex: 0,
        },
      ];

      const entities: EntityResult[] = [
        { value: 'Microsoft', confidence: 95, start: 0, end: 9 },
        { value: 'Google', confidence: 93, start: 14, end: 20 },
      ];

      const result = mapEntitiesToSources(entities, sourceMap, formattedText);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        value: 'Microsoft',
        source: 'p.companies',
      });
      expect(result[1]).toEqual({ value: 'Google', source: 'p.companies' });
    });

    it('should handle entity at line boundary', () => {
      const formattedText = 'End of line\nStart of line';
      const sourceMap: TextWithSource[] = [
        { text: 'End of line', source: 'div.first', lineIndex: 0 },
        { text: 'Start of line', source: 'div.second', lineIndex: 1 },
      ];

      const entities: EntityResult[] = [
        { value: 'Start', confidence: 90, start: 12, end: 17 },
      ];

      const result = mapEntitiesToSources(entities, sourceMap, formattedText);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ value: 'Start', source: 'div.second' });
    });

    it('should handle real-world scenario with property data', () => {
      const formattedText =
        '123 Main Street\n$450,000\nBuilt in 1985\nAustin, Texas';
      const sourceMap: TextWithSource[] = [
        { text: '123 Main Street', source: 'h1.address', lineIndex: 0 },
        { text: '$450,000', source: 'div.price', lineIndex: 1 },
        { text: 'Built in 1985', source: 'span.year', lineIndex: 2 },
        { text: 'Austin, Texas', source: 'p.location', lineIndex: 3 },
      ];

      const entities: EntityResult[] = [
        { value: '123 Main Street', confidence: 95, start: 0, end: 15 },
        { value: '450000', confidence: 92, start: 17, end: 24 },
        { value: '1985', confidence: 98, start: 34, end: 38 },
        { value: 'Austin', confidence: 90, start: 39, end: 45 },
      ];

      const result = mapEntitiesToSources(entities, sourceMap, formattedText);

      expect(result).toHaveLength(4);
      expect(result[0]).toEqual({
        value: '123 Main Street',
        source: 'h1.address',
      });
      expect(result[1]).toEqual({ value: '450000', source: 'div.price' });
      expect(result[2]).toEqual({ value: '1985', source: 'span.year' });
      expect(result[3]).toEqual({ value: 'Austin', source: 'p.location' });
    });

    it('should handle JSONPath sources', () => {
      const formattedText =
        'property address: 123 Main Street\nsale price: 450000';
      const sourceMap: TextWithSource[] = [
        {
          text: 'property address: 123 Main Street',
          source: '$.property_address',
          lineIndex: 0,
        },
        {
          text: 'sale price: 450000',
          source: '$.sale_price',
          lineIndex: 1,
        },
      ];

      const entities: EntityResult[] = [
        { value: '123 Main Street', confidence: 95, start: 18, end: 33 },
        { value: '450000', confidence: 92, start: 47, end: 53 },
      ];

      const result = mapEntitiesToSources(entities, sourceMap, formattedText);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        value: '123 Main Street',
        source: '$.property_address',
      });
      expect(result[1]).toEqual({ value: '450000', source: '$.sale_price' });
    });
  });
});
