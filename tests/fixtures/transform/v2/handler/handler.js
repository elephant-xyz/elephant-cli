import { createHash } from 'node:crypto';
import { textById } from './lib/parse.js';

export const config = { timeoutMs: 30000 };

const types = { 'Single Family': 'SingleFamily' };

export async function handler({ input, readCapture, writeJson, writeRelationship, logger }) {
  const html = await readCapture('property-detail');
  logger.info(`capture sha256 ${createHash('sha256').update(html).digest('hex')}`);

  await writeJson('property', {
    parcel_identifier: input.parcel.parcel_identifier,
    property_legal_description_text: textById(html, 'legal'),
    property_type: types[textById(html, 'use')],
  });
  await writeJson('address', input.address);
  await writeJson('parcel', input.parcel);
  await writeRelationship({
    type: 'property_has_address',
    name: 'relationship_property_address',
    from: 'property',
    to: 'address',
  });
}
