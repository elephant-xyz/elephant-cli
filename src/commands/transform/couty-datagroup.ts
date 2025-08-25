export type IPLDRef = { '/': string };

/**
 * Relationships that may appear in the County data structure.
 * Optional keys are omitted when not present (no nulls).
 */
export interface Relationships {
  person_has_property?: IPLDRef[];
  company_has_property?: IPLDRef[];
  property_has_address?: IPLDRef;
  property_has_lot?: IPLDRef;
  property_has_tax?: IPLDRef[];
  property_has_sales_history?: IPLDRef[];
  property_has_layout?: IPLDRef[];
  property_has_flood_storm_information?: IPLDRef;
  property_has_file?: IPLDRef;
  property_has_structure?: IPLDRef;
  property_has_utility?: IPLDRef;
  sales_history_has_person?: IPLDRef[];
  sales_history_has_company?: IPLDRef[];
}

export interface CountyData {
  label: 'County';
  relationships: Relationships;
}

/**
 * Create the county data group structure based on relationship files.
 * @param relationshipFiles Filenames like "property_address.ndjson", etc.
 * @returns A minimal CountyData object with only present relationships included.
 */
export function createCountyDataGroup(
  relationshipFiles: readonly string[]
): CountyData {
  const personHasProperty: IPLDRef[] = [];
  const companyHasProperty: IPLDRef[] = [];
  const propertyHasTax: IPLDRef[] = [];
  const propertyHasSalesHistory: IPLDRef[] = [];
  const propertyHasLayout: IPLDRef[] = [];
  const salesHistoryHasPerson: IPLDRef[] = [];
  const salesHistoryHasCompany: IPLDRef[] = [];

  let propertyHasAddress: IPLDRef | undefined;
  let propertyHasLot: IPLDRef | undefined;
  let propertyHasFloodStormInformation: IPLDRef | undefined;
  let propertyHasUtility: IPLDRef | undefined;
  let propertyHasStructure: IPLDRef | undefined;
  let propertyHasFile: IPLDRef | undefined;

  for (const file of relationshipFiles) {
    const lower = file.toLowerCase();
    const ref: IPLDRef = { '/': `./${file}` };

    // Pairings with "property"
    if (lower.includes('person') && lower.includes('property')) {
      personHasProperty.push(ref);
      continue;
    }
    if (lower.includes('company') && lower.includes('property')) {
      companyHasProperty.push(ref);
      continue;
    }

    // Property sub-resources (singletons or arrays)
    if (lower.includes('property_address')) {
      propertyHasAddress = ref;
      continue;
    }
    if (lower.includes('property_lot')) {
      propertyHasLot = ref;
      continue;
    }
    if (lower.includes('property_tax')) {
      propertyHasTax.push(ref);
      continue;
    }
    if (lower.includes('property_sales')) {
      propertyHasSalesHistory.push(ref);
      continue;
    }
    if (lower.includes('property_layout')) {
      propertyHasLayout.push(ref);
      continue;
    }
    if (lower.includes('property_flood_storm_information')) {
      propertyHasFloodStormInformation = ref;
      continue;
    }
    if (lower.includes('property_utility')) {
      propertyHasUtility = ref;
      continue;
    }
    if (lower.includes('property_structure')) {
      propertyHasStructure = ref;
      continue;
    }
    if (lower.includes('property_file')) {
      // Not assigned in the original loop, but present in the schema.
      propertyHasFile = ref;
      continue;
    }

    // Sales relationships linking to person/company
    if (lower.includes('relationship_sales') && lower.includes('person')) {
      salesHistoryHasPerson.push(ref);
      continue;
    }
    if (lower.includes('relationship_sales') && lower.includes('company')) {
      salesHistoryHasCompany.push(ref);
      continue;
    }
  }

  const relationships: Relationships = {};
  if (personHasProperty.length)
    relationships.person_has_property = personHasProperty;
  if (companyHasProperty.length)
    relationships.company_has_property = companyHasProperty;
  if (propertyHasAddress)
    relationships.property_has_address = propertyHasAddress;
  if (propertyHasLot) relationships.property_has_lot = propertyHasLot;
  if (propertyHasTax.length) relationships.property_has_tax = propertyHasTax;
  if (propertyHasSalesHistory.length) {
    relationships.property_has_sales_history = propertyHasSalesHistory;
  }
  if (propertyHasLayout.length)
    relationships.property_has_layout = propertyHasLayout;
  if (propertyHasFloodStormInformation) {
    relationships.property_has_flood_storm_information =
      propertyHasFloodStormInformation;
  }
  if (propertyHasFile) relationships.property_has_file = propertyHasFile;
  if (propertyHasStructure)
    relationships.property_has_structure = propertyHasStructure;
  if (propertyHasUtility)
    relationships.property_has_utility = propertyHasUtility;
  if (salesHistoryHasPerson.length) {
    relationships.sales_history_has_person = salesHistoryHasPerson;
  }
  if (salesHistoryHasCompany.length) {
    relationships.sales_history_has_company = salesHistoryHasCompany;
  }

  return {
    label: 'County',
    relationships,
  };
}
