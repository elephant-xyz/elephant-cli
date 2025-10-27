export type IPLDRef = { '/': string };

export interface PropertyImprovementData {
  label: 'Property Improvement';
  relationships: PropertyImprovementRelationships;
}

export interface PropertyImprovementRelationships {
  parcel_to_property_improvement?: IPLDRef | null;
  property_to_property_improvement?: IPLDRef[] | null;
  property_improvement_to_company?: IPLDRef[] | null;
  property_improvement_to_file?: IPLDRef[] | null;
  property_improvement_to_inspection?: IPLDRef[] | null;
  property_improvement_to_layout?: IPLDRef | null;
  property_improvement_to_structure?: IPLDRef | null;
  property_improvement_to_utility?: IPLDRef | null;
}

/**
 * Create the Property Improvement data group structure based on relationship files.
 * @param relationshipFiles Filenames like "parcel_to_property_improvement.json", etc.
 * @returns A minimal PropertyImprovementData object with only present relationships included.
 */
export function createPropertyImprovementDataGroup(
  relationshipFiles: readonly string[]
): PropertyImprovementData {
  const propertyToPropertyImprovement: IPLDRef[] = [];
  const propertyImprovementToCompany: IPLDRef[] = [];
  const propertyImprovementToFile: IPLDRef[] = [];
  const propertyImprovementToInspection: IPLDRef[] = [];

  let parcelToPropertyImprovement: IPLDRef | undefined;
  let propertyImprovementToLayout: IPLDRef | undefined;
  let propertyImprovementToStructure: IPLDRef | undefined;
  let propertyImprovementToUtility: IPLDRef | undefined;

  for (const file of relationshipFiles) {
    const lower = file.toLowerCase();
    const ref: IPLDRef = { '/': `./${file}` };

    // Parcel relationships
    if (lower.includes('parcel_to_property_improvement')) {
      parcelToPropertyImprovement = ref;
      continue;
    }

    // Property relationships
    if (lower.includes('property_to_property_improvement')) {
      propertyToPropertyImprovement.push(ref);
      continue;
    }

    // Property Improvement relationships
    if (lower.includes('property_improvement_to_company')) {
      propertyImprovementToCompany.push(ref);
      continue;
    }
    if (lower.includes('property_improvement_to_file')) {
      propertyImprovementToFile.push(ref);
      continue;
    }
    if (lower.includes('property_improvement_to_inspection')) {
      propertyImprovementToInspection.push(ref);
      continue;
    }
    if (lower.includes('property_improvement_to_layout')) {
      propertyImprovementToLayout = ref;
      continue;
    }
    if (lower.includes('property_improvement_to_structure')) {
      propertyImprovementToStructure = ref;
      continue;
    }
    if (lower.includes('property_improvement_to_utility')) {
      propertyImprovementToUtility = ref;
      continue;
    }
  }

  const relationships: PropertyImprovementRelationships = {};

  // Only include relationships that have values
  if (parcelToPropertyImprovement) {
    relationships.parcel_to_property_improvement = parcelToPropertyImprovement;
  }

  if (propertyToPropertyImprovement.length > 0) {
    relationships.property_to_property_improvement = propertyToPropertyImprovement;
  }

  if (propertyImprovementToCompany.length > 0) {
    relationships.property_improvement_to_company = propertyImprovementToCompany;
  }

  if (propertyImprovementToFile.length > 0) {
    relationships.property_improvement_to_file = propertyImprovementToFile;
  }

  if (propertyImprovementToInspection.length > 0) {
    relationships.property_improvement_to_inspection = propertyImprovementToInspection;
  }

  if (propertyImprovementToLayout) {
    relationships.property_improvement_to_layout = propertyImprovementToLayout;
  }

  if (propertyImprovementToStructure) {
    relationships.property_improvement_to_structure = propertyImprovementToStructure;
  }

  if (propertyImprovementToUtility) {
    relationships.property_improvement_to_utility = propertyImprovementToUtility;
  }

  return {
    label: 'Property Improvement',
    relationships,
  };
}
