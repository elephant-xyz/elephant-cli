export type IPLDRef = { '/': string };

export interface PropertyImprovementData {
  label: 'Property Improvement';
  relationships: PropertyImprovementRelationships;
}

export interface PropertyImprovementRelationships {
  parcel_has_property_improvement?: IPLDRef | null;
  property_has_property_improvement?: IPLDRef[] | null;
  property_improvement_has_contractor?: IPLDRef[] | null;
  property_improvement_has_layout?: IPLDRef | null;
  property_improvement_has_structure?: IPLDRef | null;
  property_improvement_has_utility?: IPLDRef | null;
  company_has_communication?: IPLDRef[] | null;
  contractor_has_person?: IPLDRef[] | null;
}

/**
 * Create the Property Improvement data group structure based on relationship files.
 * @param relationshipFiles Filenames like "parcel_has_property_improvement.json", etc.
 * @returns A minimal PropertyImprovementData object with only present relationships included.
 */
export function createPropertyImprovementDataGroup(
  relationshipFiles: readonly string[]
): PropertyImprovementData {
  const propertyHasPropertyImprovement: IPLDRef[] = [];
  const propertyImprovementHasContractor: IPLDRef[] = [];
  const companyHasCommunication: IPLDRef[] = [];
  const contractorHasPerson: IPLDRef[] = [];

  let parcelHasPropertyImprovement: IPLDRef | undefined;
  let propertyImprovementHasLayout: IPLDRef | undefined;
  let propertyImprovementHasStructure: IPLDRef | undefined;
  let propertyImprovementHasUtility: IPLDRef | undefined;

  for (const file of relationshipFiles) {
    const lower = file.toLowerCase();
    const ref: IPLDRef = { '/': `./${file}` };

    // Parcel relationships
    if (lower.includes('parcel_has_property_improvement')) {
      parcelHasPropertyImprovement = ref;
      continue;
    }

    // Property relationships
    if (lower.includes('property_has_property_improvement')) {
      propertyHasPropertyImprovement.push(ref);
      continue;
    }

    // Property Improvement relationships
    if (lower.includes('property_improvement_has_contractor')) {
      propertyImprovementHasContractor.push(ref);
      continue;
    }
    if (lower.includes('property_improvement_has_layout')) {
      propertyImprovementHasLayout = ref;
      continue;
    }
    if (lower.includes('property_improvement_has_structure')) {
      propertyImprovementHasStructure = ref;
      continue;
    }
    if (lower.includes('property_improvement_has_utility')) {
      propertyImprovementHasUtility = ref;
      continue;
    }

    // Company relationships
    if (lower.includes('company_has_communication')) {
      companyHasCommunication.push(ref);
      continue;
    }
    if (lower.includes('contractor_has_person')) {
      contractorHasPerson.push(ref);
      continue;
    }
  }

  const relationships: PropertyImprovementRelationships = {};

  // Only include relationships that have values
  if (parcelHasPropertyImprovement) {
    relationships.parcel_has_property_improvement =
      parcelHasPropertyImprovement;
  }

  if (propertyHasPropertyImprovement.length > 0) {
    relationships.property_has_property_improvement =
      propertyHasPropertyImprovement;
  }

  if (propertyImprovementHasContractor.length > 0) {
    relationships.property_improvement_has_contractor =
      propertyImprovementHasContractor;
  }

  if (propertyImprovementHasLayout) {
    relationships.property_improvement_has_layout =
      propertyImprovementHasLayout;
  }

  if (propertyImprovementHasStructure) {
    relationships.property_improvement_has_structure =
      propertyImprovementHasStructure;
  }

  if (propertyImprovementHasUtility) {
    relationships.property_improvement_has_utility =
      propertyImprovementHasUtility;
  }

  if (companyHasCommunication.length > 0) {
    relationships.company_has_communication = companyHasCommunication;
  }

  if (contractorHasPerson.length > 0) {
    relationships.contractor_has_person = contractorHasPerson;
  }

  return {
    label: 'Property Improvement',
    relationships,
  };
}
