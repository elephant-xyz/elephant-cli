export type IPLDRef = { '/': string };

/**
 * Relationships that may appear in the County data structure.
 * Optional keys are omitted when not present (no nulls).
 */
export interface Relationships {
  person_has_property?: IPLDRef[];
  company_has_property?: IPLDRef[];
  person_has_mailing_address?: IPLDRef[];
  company_has_mailing_address?: IPLDRef[];
  property_has_address?: IPLDRef;
  property_has_lot?: IPLDRef;
  property_has_tax?: IPLDRef[];
  property_has_sales_history?: IPLDRef[];
  property_has_layout?: IPLDRef[];
  property_has_flood_storm_information?: IPLDRef;
  property_has_file?: IPLDRef[];
  property_has_structure?: IPLDRef;
  property_has_utility?: IPLDRef;
  property_has_property_improvement?: IPLDRef[];
  parcel_has_geometry?: IPLDRef;
  address_has_geometry?: IPLDRef;
  layout_has_geometry?: IPLDRef[];
  sales_history_has_person?: IPLDRef[];
  sales_history_has_company?: IPLDRef[];
  deed_has_file?: IPLDRef[];
  sales_history_has_deed?: IPLDRef[];
  layout_has_layout?: IPLDRef[];
  layout_has_utility?: IPLDRef[];
  layout_has_structure?: IPLDRef[];
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
  const personHasMailingAddress: IPLDRef[] = [];
  const companyHasMailingAddress: IPLDRef[] = [];
  const propertyHasTax: IPLDRef[] = [];
  const propertyHasSalesHistory: IPLDRef[] = [];
  const propertyHasLayout: IPLDRef[] = [];
  const propertyHasPropertyImprovement: IPLDRef[] = [];
  const salesHistoryHasPerson: IPLDRef[] = [];
  const salesHistoryHasCompany: IPLDRef[] = [];
  const deedHasFile: IPLDRef[] = [];
  const salesHistoryHasDeed: IPLDRef[] = [];
  const propertyHasFile: IPLDRef[] = [];

  const layoutHasLayout: IPLDRef[] = [];
  const layoutHasUtility: IPLDRef[] = [];
  const layoutHasStructure: IPLDRef[] = [];

  let propertyHasAddress: IPLDRef | undefined;
  let propertyHasLot: IPLDRef | undefined;
  let propertyHasFloodStormInformation: IPLDRef | undefined;
  let parcelHasGeometry: IPLDRef | undefined;
  let addressHasGeometry: IPLDRef | undefined;
  const layoutHasGeometry: IPLDRef[] = [];

  for (const file of relationshipFiles) {
    const lower = file.toLowerCase();
    const ref: IPLDRef = { '/': `./${file}` };

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
    if (lower.includes('parcel_geometry') || (lower.includes('parcel') && lower.includes('geometry') && !lower.includes('property'))) {
      parcelHasGeometry = ref;
      continue;
    }
    if (lower.includes('address_geometry') || (lower.includes('address') && lower.includes('geometry'))) {
      addressHasGeometry = ref;
      continue;
    }
    if (lower.includes('layout_geometry') || (lower.includes('layout') && lower.includes('geometry') && !lower.includes('property'))) {
      layoutHasGeometry.push(ref);
      continue;
    }
    if (lower.includes('property_file')) {
      // Not assigned in the original loop, but present in the schema.
      propertyHasFile.push(ref);
      continue;
    }
    if (lower.includes('property_improvement')) {
      propertyHasPropertyImprovement.push(ref);
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

    // Deed relationships
    if (lower.includes('relationship_deed') && lower.includes('file')) {
      deedHasFile.push(ref);
      continue;
    }
    if (lower.includes('relationship_sales') && lower.includes('deed')) {
      salesHistoryHasDeed.push(ref);
      continue;
    }

    // Person/Company mailing address relationships
    if (
      lower.includes('person') &&
      lower.includes('mailing_address') &&
      lower.includes('relationship')
    ) {
      personHasMailingAddress.push(ref);
      continue;
    }
    if (
      lower.includes('company') &&
      lower.includes('mailing_address') &&
      lower.includes('relationship')
    ) {
      companyHasMailingAddress.push(ref);
      continue;
    }

    // Layout relationships
    if (
      lower.includes('relationship') &&
      lower.includes('layout') &&
      lower.includes('layout') &&
      (lower.match(/layout/g) || []).length >= 2
    ) {
      layoutHasLayout.push(ref);
      continue;
    }
    if (
      lower.includes('relationship') &&
      lower.includes('layout') &&
      lower.includes('utility')
    ) {
      layoutHasUtility.push(ref);
      continue;
    }
    if (
      lower.includes('relationship') &&
      lower.includes('layout') &&
      lower.includes('structure')
    ) {
      layoutHasStructure.push(ref);
      continue;
    }
  }

  const relationships: Relationships = {};
  if (personHasProperty.length)
    relationships.person_has_property = personHasProperty;
  if (companyHasProperty.length)
    relationships.company_has_property = companyHasProperty;
  if (personHasMailingAddress.length)
    relationships.person_has_mailing_address = personHasMailingAddress;
  if (companyHasMailingAddress.length)
    relationships.company_has_mailing_address = companyHasMailingAddress;
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
  if (parcelHasGeometry) {
    relationships.parcel_has_geometry = parcelHasGeometry;
  }
  if (addressHasGeometry) {
    relationships.address_has_geometry = addressHasGeometry;
  }
  if (layoutHasGeometry.length) {
    relationships.layout_has_geometry = layoutHasGeometry;
  }
  if (propertyHasFile.length) relationships.property_has_file = propertyHasFile;
  if (propertyHasPropertyImprovement.length)
    relationships.property_has_property_improvement =
      propertyHasPropertyImprovement;
  if (salesHistoryHasPerson.length) {
    relationships.sales_history_has_person = salesHistoryHasPerson;
  }
  if (salesHistoryHasCompany.length) {
    relationships.sales_history_has_company = salesHistoryHasCompany;
  }
  if (deedHasFile.length) {
    relationships.deed_has_file = deedHasFile;
  }
  if (salesHistoryHasDeed.length) {
    relationships.sales_history_has_deed = salesHistoryHasDeed;
  }
  if (layoutHasLayout.length) relationships.layout_has_layout = layoutHasLayout;
  if (layoutHasUtility.length)
    relationships.layout_has_utility = layoutHasUtility;
  if (layoutHasStructure.length)
    relationships.layout_has_structure = layoutHasStructure;

  return {
    label: 'County',
    relationships,
  };
}
