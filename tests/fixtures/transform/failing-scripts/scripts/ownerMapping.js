// CommonJS + cheerio (resolved through the node_modules symlink the CLI places in cwd)
const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const $ = cheerio.load(fs.readFileSync('input.html', 'utf8'));
const id = $('#parcel').text().trim();
const owners = $('#owners td.owner')
  .map((_, el) => $(el).text().trim())
  .get()
  .map((raw) => {
    const parts = raw.split(/\s+/);
    return { type: 'person', first_name: parts[0], middle_name: parts.length > 2 ? parts[1] : null, last_name: parts[parts.length - 1] };
  });
fs.mkdirSync('owners', { recursive: true });
fs.writeFileSync(path.join('owners', 'owner_data.json'), JSON.stringify({ [`property_${id}`]: { owners_by_date: { current: owners } } }, null, 2));
console.log(JSON.stringify({ owners: owners.length }));
