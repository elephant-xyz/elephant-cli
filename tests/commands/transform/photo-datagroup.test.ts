import { describe, it, expect } from 'vitest';
import { createPhotoDataGroup } from '../../../src/commands/transform/photo-datagroup.js';

describe('createPhotoDataGroup', () => {
  it('creates relationships with parcel_has_file entries', () => {
    const result = createPhotoDataGroup([
      'relationship_parcel_has_file_1.json',
    ]);

    expect(result.label).toBe('Photo');
    expect(result.relationships.parcel_has_file).toEqual([
      { '/': './relationship_parcel_has_file_1.json' },
    ]);
  });

  it('includes optional fact sheet relationships when present', () => {
    const result = createPhotoDataGroup([
      'relationship_parcel_has_file_1.json',
      'relationship_parcel_has_fact_sheet_1.json',
      'relationship_file_has_fact_sheet_1.json',
    ]);

    expect(result.relationships.parcel_has_fact_sheet).toEqual([
      { '/': './relationship_parcel_has_fact_sheet_1.json' },
    ]);
    expect(result.relationships.file_has_fact_sheet).toEqual([
      { '/': './relationship_file_has_fact_sheet_1.json' },
    ]);
  });

  it('supports case-insensitive matching', () => {
    const result = createPhotoDataGroup([
      'RELATIONSHIP_PARCEL_HAS_FILE_1.JSON',
      'RELATIONSHIP_PARCEL_HAS_FACT_SHEET_1.JSON',
      'RELATIONSHIP_FILE_HAS_FACT_SHEET_1.JSON',
    ]);

    expect(result.relationships.parcel_has_file).toEqual([
      { '/': './RELATIONSHIP_PARCEL_HAS_FILE_1.JSON' },
    ]);
    expect(result.relationships.parcel_has_fact_sheet).toEqual([
      { '/': './RELATIONSHIP_PARCEL_HAS_FACT_SHEET_1.JSON' },
    ]);
    expect(result.relationships.file_has_fact_sheet).toEqual([
      { '/': './RELATIONSHIP_FILE_HAS_FACT_SHEET_1.JSON' },
    ]);
  });

  it('throws when no parcel_has_file relationships are provided', () => {
    expect(() =>
      createPhotoDataGroup(['relationship_parcel_has_fact_sheet_1.json'])
    ).toThrow(
      'Photo data group requires at least one parcel_has_file relationship'
    );
  });
});
