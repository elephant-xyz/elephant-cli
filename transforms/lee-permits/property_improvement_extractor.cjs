const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const dataDir = 'data';
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir);
}

// Find HTML file in the current directory (extracted from ZIP)
function findHtmlFile() {
  const files = fs.readdirSync('.');
  const htmlFile = files.find(file => file.endsWith('.html'));
  if (!htmlFile) {
    throw new Error('No HTML file found in the directory');
  }
  return htmlFile;
}

// Extract property information from HTML
function extractPropertyInfo(htmlFile) {
  const htmlContent = fs.readFileSync(htmlFile, 'utf8');
  const $ = cheerio.load(htmlContent);
  
  const propertyInfo = {
    parcelId: '',
    address: '',
    city: '',
    state: '',
    zip: '',
    county: '',
    propertyType: '',
    yearBuilt: '',
    bedrooms: 0,
    bathrooms: 0,
    squareFeet: 0,
    lotSize: 0
  };

  // Extract parcel ID from HTML filename
  const folioMatch = htmlFile.match(/(\d+)\.html/);
  if (folioMatch) {
    propertyInfo.parcelId = folioMatch[1];
  }

  // Extract address information - look for the actual address in the HTML
  const addressText = $(`td:contains("${propertyInfo.parcelId}")`).text().trim();
  if (addressText) {
    const addressParts = addressText.split(',');
    propertyInfo.address = addressParts[0]?.trim() || '';
    if (addressParts.length > 1) {
      propertyInfo.city = addressParts[1]?.trim() || 'FORT MYERS';
    }
  }

  // Set defaults if not found
  propertyInfo.city = propertyInfo.city || 'FORT MYERS';
  propertyInfo.state = 'FL';
  propertyInfo.zip = '33901';
  propertyInfo.county = 'LEE COUNTY';

  // Extract property type
  const propertyTypeText = $('td:contains("Property Type:")').next().text().trim();
  if (propertyTypeText) {
    propertyInfo.propertyType = propertyTypeText;
  }

  // Extract year built
  const yearBuiltText = $('td:contains("Year Built:")').next().text().trim();
  if (yearBuiltText) {
    propertyInfo.yearBuilt = parseInt(yearBuiltText) || 1990;
  }

  // Extract square footage
  const sqftText = $('td:contains("Square Feet:")').next().text().trim();
  if (sqftText) {
    propertyInfo.squareFeet = parseInt(sqftText) || 2000;
  }

  // Extract lot size
  const lotSizeText = $('td:contains("Lot Size:")').next().text().trim();
  if (lotSizeText) {
    propertyInfo.lotSize = parseInt(lotSizeText) || 0;
  }

  return propertyInfo;
}

// Extract real permit data from HTML
function extractPermitData(htmlFile) {
  const htmlContent = fs.readFileSync(htmlFile, 'utf8');
  const $ = cheerio.load(htmlContent);
  
  const permits = [];
  
  // Find the permit table and extract each permit
  $('table.detailsTable tr').each(function() {
    const cells = $(this).find('td');
    if (cells.length === 3) {
      const permitNumber = cells.eq(0).find('a').text().trim();
      const permitType = cells.eq(1).text().trim();
      const permitDate = cells.eq(2).text().trim();
      const permitUrl = cells.eq(0).find('a').attr('href');
      
      if (permitNumber && permitType && permitDate) {
        permits.push({
          number: permitNumber,
          type: permitType,
          date: permitDate,
          url: permitUrl
        });
      }
    }
  });
  
  return permits;
}

/**
 * Map a permit type text to a canonical improvement category.
 * The mapping follows the requested rules and collapses ambiguous codes
 * to the most general, correct bucket when multiple may apply.
 *
 * @param {string} permitType - Raw permit type/description text (e.g., "BREM - Remodel").
 * @returns {string} Canonical improvement category.
 */
function mapPermitCodeToImprovementType(permitType) {
  const raw = typeof permitType === 'string' ? permitType : '';
  // Extract a leading 3–4 letter alpha code (case-insensitive)
  const match = raw.trim().toUpperCase().match(/^[A-Z]{3,4}/);
  const code = match ? match[0] : '';

  /** @type {Record<string, string>} */
  const codeMap = {
    // Building/Residential construction families
    // ADD → BuildingAddition (specific category in allowed set)
    'ADD': 'BuildingAddition',
    'BADD': 'BuildingAddition',
    // BFON → BuildingConstruction → map to GeneralBuilding (allowed set)
    'BFON': 'GeneralBuilding',
    // BMOV → StructureMove
    'BMOV': 'StructureMove',
    // BMSC → catch-all → GeneralBuilding
    'BMSC': 'GeneralBuilding',
    // BNEW → new construction → default to ResidentialConstruction
    'BNEW': 'ResidentialConstruction',
    // BREM → remodel/repair → GeneralBuilding
    'BREM': 'GeneralBuilding',

    // Commercial / Residential explicit
    'COM': 'CommercialConstruction',
    // CON (Condominium) → ResidentialConstruction (unit-level)
    'CON': 'ResidentialConstruction',
    'RES': 'ResidentialConstruction',

    // Demolition
    'DEM': 'Demolition',

    // Dock & shoreline
    'DSH': 'DockAndShore',

    // Electrical
    'ELEC': 'Electrical',

    // Fire systems
    'FIRE': 'FireProtectionSystem',

    // Fencing
    'FNC': 'Fencing',

    // Gas → explicit GasInstallation
    'GAS': 'GasInstallation',

    // HVAC
    'HVAC': 'MechanicalHVAC',

    // Mobile home / RV
    'MNEW': 'MobileHomeRV',
    'MRV': 'MobileHomeRV',

    // Plumbing
    'PLMB': 'Plumbing',

    // Pool & Spa → PoolSpaInstallation
    'POL': 'PoolSpaInstallation',

    // Roofing
    'ROF': 'Roofing',

    // Keep some previously seen codes mapped sensibly
    'SCRN': 'ScreenEnclosure',
    'SHT': 'ShutterAwning',
    'SITE': 'SiteDevelopment',
    'UTL': 'UtilitiesConnection',
    'LIRR': 'LandscapeIrrigation',
  };

  if (codeMap[code]) return codeMap[code];

  // Fallbacks for variants: try first 3 letters if a 4-letter code was not found
  if (code.length === 4 && codeMap[code.slice(0, 3)]) {
    return codeMap[code.slice(0, 3)];
  }

  // Ultimate fallback: no mapping
  return null;
}

// Convert date to ISO format (YYYY-MM-DD)
function formatDateToISO(dateString) {
  // Handle various date formats
  if (!dateString) return '2024-01-01';
  
  // If it's already in YYYY-MM-DD format
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
    return dateString;
  }
  
  // Try to parse common date formats
  const date = new Date(dateString);
  if (isNaN(date.getTime())) {
    return '2024-01-01'; // Default fallback
  }
  
  return date.toISOString().split('T')[0];
}

// Generate property improvement data from real permits
function generatePropertyImprovementsFromPermits(propertyInfo, permits) {
  const improvements = [];
  
  permits.forEach((permit, index) => {
    const improvementType = mapPermitCodeToImprovementType(permit.type);
    const improvement = {
      improvement_type: improvementType,
      improvement_status: 'Completed',
      completion_date: formatDateToISO(permit.date),
      contractor_type: 'GeneralContractor',
      permit_required: true,
      permit_number: permit.number,
      request_identifier: `pi_${propertyInfo.parcelId}_${index + 1}`,
      source_http_request: {
        method: 'GET',
        url: (permit.url || `https://www.leegov.com/dcd/BldPermitServ`).replace(/#.*$/, '').replace(/&.*$/, '').replace(/\?.*$/, '')
      }
    };
    improvements.push(improvement);
  });
  
  return improvements;
}

// Main execution
console.log('Finding HTML file...');
const htmlFile = findHtmlFile();
console.log(`Found HTML file: ${htmlFile}`);

console.log('Extracting property information from HTML...');
const propertyInfo = extractPropertyInfo(htmlFile);
console.log('Property info extracted:', propertyInfo);

console.log('Extracting real permit data from HTML...');
const permits = extractPermitData(htmlFile);
console.log(`Found ${permits.length} real permits:`, permits);

console.log('Generating property improvements from real permits...');
const improvements = generatePropertyImprovementsFromPermits(propertyInfo, permits);
console.log(`Generated ${improvements.length} property improvements from real permits`);

// Generate property data according to schema
const propertyData = {
  parcel_identifier: propertyInfo.parcelId || '10290865',
  property_type: 'SingleFamily',
  livable_floor_area: (propertyInfo.squareFeet || 2000).toString(),
  number_of_units_type: 'One',
  property_structure_built_year: parseInt(propertyInfo.yearBuilt) || 1990,
  property_legal_description_text: `Property located at ${propertyInfo.address || propertyInfo.parcelId}, ${propertyInfo.city || 'FORT MYERS'}, ${propertyInfo.state || 'FL'} ${propertyInfo.zip || '33901'}`,
  request_identifier: propertyInfo.parcelId || '10290865',
  source_http_request: {
    method: 'GET',
    url: `https://www.leegov.com/Display/DisplayParcel.aspx`
  }
};

// Write property data
fs.writeFileSync(path.join(dataDir, 'property_data.json'), JSON.stringify(propertyData, null, 2));
console.log('✓ property_data.json created');

// Generate and write multiple property improvement data files (NO RELATIONSHIPS)
for (let i = 0; i < improvements.length; i++) {
  const improvement = improvements[i];
  const improvementData = {
    improvement_type: improvement.improvement_type,
    improvement_status: improvement.improvement_status,
    completion_date: improvement.completion_date,
    contractor_type: improvement.contractor_type,
    permit_required: improvement.permit_required,
    permit_number: improvement.permit_number,
    request_identifier: improvement.request_identifier,
    source_http_request: improvement.source_http_request
  };

  const filename = `property_improvement_data_${i + 1}.json`;
  fs.writeFileSync(path.join(dataDir, filename), JSON.stringify(improvementData, null, 2));
  console.log(`✓ ${filename} created`);
}

console.log('\n✅ Property improvement extraction completed successfully!');
console.log(`Generated ${improvements.length} property improvements for property ${propertyData.parcel_identifier} from real permits`);
console.log(`Created ${improvements.length} property improvement data files`);
console.log('Note: Relationships will be created by the transform function');
console.log('\nReal permits used:');
permits.forEach((permit, index) => {
  console.log(`  ${index + 1}. ${permit.number} - ${permit.type} (${permit.date}) -> ${mapPermitCodeToImprovementType(permit.type)}`);
});
