import * as cheerio from 'cheerio';
export async function handler({ readCapture, writeJson }) {
  const $ = cheerio.load(await readCapture('property-detail'));
  await writeJson('property', { parcel_identifier: $('#parcel').text() });
}
