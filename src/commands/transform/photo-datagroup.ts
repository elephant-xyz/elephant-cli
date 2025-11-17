export type IPLDRef = { '/': string };

export interface PhotoData {
  label: 'Photo';
  relationships: PhotoRelationships;
}

export interface PhotoRelationships {
  parcel_has_file: IPLDRef[];
  parcel_has_fact_sheet?: IPLDRef[];
  file_has_fact_sheet?: IPLDRef[];
}

const createRef = (file: string): IPLDRef => ({ '/': `./${file}` });

export function createPhotoDataGroup(
  relationshipFiles: readonly string[]
): PhotoData {
  const parcelHasFile: IPLDRef[] = [];
  const parcelHasFactSheet: IPLDRef[] = [];
  const fileHasFactSheet: IPLDRef[] = [];

  for (const file of relationshipFiles) {
    const lower = file.toLowerCase();
    const ref = createRef(file);

    if (lower.includes('parcel_has_file')) {
      parcelHasFile.push(ref);
      continue;
    }

    if (lower.includes('parcel_has_fact_sheet')) {
      parcelHasFactSheet.push(ref);
      continue;
    }

    if (lower.includes('file_has_fact_sheet')) {
      fileHasFactSheet.push(ref);
    }
  }

  if (!parcelHasFile.length) {
    throw new Error(
      'Photo data group requires at least one parcel_has_file relationship'
    );
  }

  const relationships: PhotoRelationships = {
    parcel_has_file: parcelHasFile,
  };

  if (parcelHasFactSheet.length) {
    relationships.parcel_has_fact_sheet = parcelHasFactSheet;
  }

  if (fileHasFactSheet.length) {
    relationships.file_has_fact_sheet = fileHasFactSheet;
  }

  return {
    label: 'Photo',
    relationships,
  };
}
