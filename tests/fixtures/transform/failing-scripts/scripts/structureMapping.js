// ES module syntax in a .js file with no package.json: Node >= 22.7 detects it and runs it as ESM
import fs from 'node:fs';
import * as cheerio from 'cheerio';

const $ = cheerio.load(fs.readFileSync('input.html', 'utf8'));
fs.mkdirSync('owners', { recursive: true });
fs.writeFileSync('owners/structure_data.json', JSON.stringify({ [`property_${$('#parcel').text().trim()}`]: {} }));
