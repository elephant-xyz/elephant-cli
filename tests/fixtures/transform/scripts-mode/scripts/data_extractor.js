const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const html = fs.readFileSync('input.html', 'utf8');
const seed = JSON.parse(fs.readFileSync('property_seed.json', 'utf8'));
const address = JSON.parse(fs.readFileSync('unnormalized_address.json', 'utf8'));
const owners = JSON.parse(fs.readFileSync(path.join('owners', 'owner_data.json'), 'utf8'));
const $ = cheerio.load(html);

const types = { 'Single Family': 'SingleFamily' };
const use = $('#use').text().trim();
if (!types[use]) {
  throw new Error(JSON.stringify({ type: 'error', message: `Unknown enum value ${use}.`, path: 'property.property_type' }));
}

fs.mkdirSync('data', { recursive: true });
fs.writeFileSync(path.join('data', 'property.json'), JSON.stringify({
  parcel_identifier: seed.parcel_id,
  property_legal_description_text: $('#legal').text().trim(),
  property_type: types[use],
}, null, 2));
fs.writeFileSync(path.join('data', 'address.json'), JSON.stringify({
  unnormalized_address: address.full_address,
  county_name: address.county_jurisdiction,
}, null, 2));
console.log(`cwd files: ${fs.readdirSync('.').sort().join(' ')}`);
console.log(`owner groups: ${Object.keys(owners).length}`);
