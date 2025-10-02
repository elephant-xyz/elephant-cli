export type IPLDRef = { '/': string };

/**
 * Relationships that may appear in the Property Improvement data structure.
 * Based on the Property Improvement schema provided by the user.
 */
export interface PropertyImprovementRelationships {
  property_has_property_improvement?: IPLDRef[];
  property_has_permit?: IPLDRef[];
  property_improvement_has_contractor?: IPLDRef[];
  property_improvement_has_fact_sheet?: IPLDRef[];
  property_improvement_has_layout?: IPLDRef[];
  property_improvement_has_owner?: IPLDRef[];
  property_improvement_has_structure?: IPLDRef;
  property_improvement_has_unormalized_address?: IPLDRef;
  property_improvement_has_utility?: IPLDRef;
  communication_has_fact_sheet?: IPLDRef[];
  company_has_communication?: IPLDRef[];
  file_has_fact_sheet?: IPLDRef[];
  property_has_fact_sheet?: IPLDRef[];
  structure_has_fact_sheet?: IPLDRef[];
  utility_has_fact_sheet?: IPLDRef[];
}

export interface PropertyImprovementData {
  label: 'Property Improvement';
  relationships: PropertyImprovementRelationships;
}

/**
 * Create the property improvement data group structure based on relationship files.
 * @param relationshipFiles Filenames like "property_improvement_to_property_1.json", etc.
 * @returns A PropertyImprovementData object with only present relationships included.
 */
export function createPropertyImprovementDataGroup(
  relationshipFiles: readonly string[]
): PropertyImprovementData {
  const propertyHasPropertyImprovement: IPLDRef[] = [];
  const propertyHasPermit: IPLDRef[] = [];
  const propertyImprovementHasFactSheet: IPLDRef[] = [];
  const propertyImprovementHasLayout: IPLDRef[] = [];
  const propertyImprovementHasOwner: IPLDRef[] = [];
  const communicationHasFactSheet: IPLDRef[] = [];
  const fileHasFactSheet: IPLDRef[] = [];
  const propertyHasFactSheet: IPLDRef[] = [];
  const structureHasFactSheet: IPLDRef[] = [];
  const utilityHasFactSheet: IPLDRef[] = [];

  const propertyImprovementHasContractor: IPLDRef[] = [];
  let propertyImprovementHasStructure: IPLDRef | undefined;
  let propertyImprovementHasUnormalizedAddress: IPLDRef | undefined;
  let propertyImprovementHasUtility: IPLDRef | undefined;
  const companyHasCommunication: IPLDRef[] = [];

  for (const file of relationshipFiles) {
    const lower = file.toLowerCase();
    const ref: IPLDRef = { '/': `./${file}` };

    // Property to property improvement relationships
    if (lower.includes('property_improvement_to_property')) {
      propertyHasPropertyImprovement.push(ref);
      continue;
    }

    // Property to permit relationships
    if (lower.includes('property_to_file') && lower.includes('permit')) {
      propertyHasPermit.push(ref);
      continue;
    }

    // Property improvement to contractor company (collect)
    if (lower.includes('property_improvement_to_company')) {
      propertyImprovementHasContractor.push(ref);
      continue;
    }

    // Property improvement to fact sheet relationships
    if (lower.includes('property_improvement_to_fact_sheet')) {
      propertyImprovementHasFactSheet.push(ref);
      continue;
    }

    // Property improvement to layout relationships
    if (lower.includes('property_improvement_to_layout')) {
      propertyImprovementHasLayout.push(ref);
      continue;
    }

    // Property improvement to owner relationships
    if (lower.includes('property_improvement_to_person')) {
      propertyImprovementHasOwner.push(ref);
      continue;
    }

    // Property improvement to structure (singleton)
    if (lower.includes('property_improvement_to_structure')) {
      propertyImprovementHasStructure = ref;
      continue;
    }

    // Property improvement to unnormalized address (required)
    if (lower.includes('property_improvement_to_unnormalized_address')) {
      propertyImprovementHasUnormalizedAddress = ref;
      continue;
    }

    // Property improvement to utility (singleton)
    if (lower.includes('property_improvement_to_utility')) {
      propertyImprovementHasUtility = ref;
      continue;
    }

    // Communication to fact sheet relationships
    if (lower.includes('communication_to_fact_sheet')) {
      communicationHasFactSheet.push(ref);
      continue;
    }

    // Company to communication (collect)
    if (lower.includes('company_to_communication')) {
      companyHasCommunication.push(ref);
      continue;
    }

    // File to fact sheet relationships
    if (lower.includes('file_to_fact_sheet')) {
      fileHasFactSheet.push(ref);
      continue;
    }

    // Property to fact sheet relationships
    if (lower.includes('property_to_fact_sheet')) {
      propertyHasFactSheet.push(ref);
      continue;
    }

    // Structure to fact sheet relationships
    if (lower.includes('structure_to_fact_sheet')) {
      structureHasFactSheet.push(ref);
      continue;
    }

    // Utility to fact sheet relationships
    if (lower.includes('utility_to_fact_sheet')) {
      utilityHasFactSheet.push(ref);
      continue;
    }
  }

  const relationships: PropertyImprovementRelationships = {};

  // Required relationships
  if (propertyHasPropertyImprovement.length) {
    relationships.property_has_property_improvement = propertyHasPropertyImprovement;
  }

  // Include optional relationships when present
  if (propertyImprovementHasContractor.length) {
    relationships.property_improvement_has_contractor = propertyImprovementHasContractor;
  }
  if (companyHasCommunication.length) {
    relationships.company_has_communication = companyHasCommunication;
  }

  return {
    label: 'Property Improvement',
    relationships,
  };
}
