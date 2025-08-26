/**
 * Centralized filename constants for the generate-transform command
 */
const FILENAMES = {
  // Input files
  INPUT_FILE: 'input.html',
  UNNORMALIZED_ADDRESS: 'unnormalized_address.json',
  PROPERTY_SEED: 'property_seed.json',

  // Owner data files
  OWNER_DATA: 'owners/owner_data.json',
  UTILITIES_DATA: 'owners/utilities_data.json',
  LAYOUT_DATA: 'owners/layout_data.json',
  STRUCTURE_DATA: 'owners/structure_data.json',

  // Script files
  DATA_EXTRACTOR_SCRIPT: 'scripts/data_extractor.js',
  STRUCTURE_MAPPING_SCRIPT: 'scripts/structureMapping.js',
  UTILITY_MAPPING_SCRIPT: 'scripts/utilityMapping.js',
  LAYOUT_MAPPING_SCRIPT: 'scripts/layoutMapping.js',
  OWNER_MAPPING_SCRIPT: 'scripts/ownerMapping.js',

  // Directory for scripts
  SCRIPTS_DIR: 'scripts',

  // Output data directory
  DATA_DIR: 'data',

  // Output data files
  OUTPUT_PROPERTY: 'data/property.json',
  OUTPUT_ADDRESS: 'data/address.json',
  OUTPUT_LOT: 'data/lot.json',
  OUTPUT_TAX_PREFIX: 'data/tax_',
  OUTPUT_FLOOD: 'data/flood_storm_information.json',
  OUTPUT_SALES_PREFIX: 'data/sales_',
  OUTPUT_PERSON_PREFIX: 'data/person_',
  OUTPUT_COMPANY_PREFIX: 'data/company_',
  OUTPUT_STRUCTURE: 'data/structure.json',
  OUTPUT_UTILITY: 'data/utility.json',
  OUTPUT_LAYOUT_PREFIX: 'data/layout_',
  OUTPUT_RELATIONSHIP_SALES_PERSON: 'data/relationship_sales_person.json',
  OUTPUT_RELATIONSHIP_SALES_COMPANY: 'data/relationship_sales_company.json',
};

export function buildFilename(inputFilename: string): typeof FILENAMES {
  const filenames = { ...FILENAMES };
  filenames.INPUT_FILE = inputFilename;
  return filenames;
}

export type FilenameKey = keyof typeof FILENAMES;
export type FilenameValue = (typeof FILENAMES)[FilenameKey];
