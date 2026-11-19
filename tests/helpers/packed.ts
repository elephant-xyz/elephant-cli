import { promises as fsPromises } from 'fs';
import os from 'os';
import path from 'path';
import { afterAll } from 'vitest';
import AdmZip from 'adm-zip';
import { CarReader } from '@ipld/car';
import { handleHash } from '../../src/commands/hash.js';
import { SEED_DATAGROUP_SCHEMA_CID } from '../../src/config/constants.js';
import { SchemaCacheService } from '../../src/services/schema-cache.service.js';
import { SchemaManifestService } from '../../src/services/schema-manifest.service.js';
import { text } from './county-car.js';

/** The reference vectors of the packed format: `property/` input and the exact `packed.json`. */
export const VECTORS = path.join(__dirname, '../fixtures/packed');

/** Expected CIDs of the reference vectors, from the format specification. */
export const EXPECTED = {
  property: 'baguqeeraslstwpvmi2374m2of5bczxuiq2wkblbbbnwyvxr4fgmpm5dojefq',
  'vector-1': {
    linked: 'baguqeerad7ribhalqwds5cm4l4mpclt7cr4qbuyrv3rxex4n5bwvga4pewja',
    packed: 'baguqeera23v62rlo33fvnrvqrdnmuikiya4l7gfqrka2ibejfvtroigtaweq',
    bytes: 858,
    zip: { linked: 7, packed: 5 },
    car: { linked: 9, packed: 7 },
  },
  'vector-2': {
    linked: 'baguqeerap73zkcd4lmiy2blzhbmh6hwdivicucv7nfi5kqvrh5y2kvg4z5mq',
    packed: 'baguqeeratngekt6ads2xrr7m6h5wnub7oikbjjeivydruacc2euzpxmi5uba',
    bytes: 1473,
    zip: { linked: 11, packed: 5 },
    car: { linked: 13, packed: 7 },
  },
} as const;

export type Vector = 'vector-1' | 'vector-2';

/**
 * A scratch directory for one test file, removed when the file ends. The
 * result makes a new empty directory inside it on every call.
 */
export async function scratch(prefix: string) {
  const root = await fsPromises.mkdtemp(
    path.join(path.resolve(os.tmpdir()), prefix)
  );
  afterAll(() => fsPromises.rm(root, { recursive: true, force: true }));
  return () => fsPromises.mkdtemp(path.join(root, 'case-'));
}

const cid = async (name: string) =>
  (await text(`packed fixtures: ${name}`)).cid.toString();

export const SEED = SEED_DATAGROUP_SCHEMA_CID;
export const COUNTY = await cid('county data group');
const ADDRESS_HAS_PARCEL = await cid('address_has_parcel');
const PROPERTY_HAS_ADDRESS = await cid('property_has_address');
const PROPERTY_HAS_TAX = await cid('property_has_tax');
const PROPERTY = await cid('property class');
const ADDRESS = await cid('address class');
const PARCEL = await cid('parcel class');
const TAX = await cid('tax class');

const group = (title: string, relationships: object) => ({
  type: 'object',
  title,
  properties: {
    label: { type: 'string' },
    relationships: {
      type: 'object',
      properties: relationships,
      additionalProperties: false,
    },
  },
  required: ['label', 'relationships'],
  additionalProperties: false,
});

const relationship = (title: string, from: string, to: string) => ({
  type: 'object',
  title,
  properties: {
    from: { type: 'string', cid: from },
    to: { type: 'string', cid: to },
  },
  required: ['from', 'to'],
  additionalProperties: false,
});

/**
 * Lexicon-shaped schemas for the vectors: data group -> relationship -> class.
 * `strict` makes the tax class want a string `tax_year`, so vector 2 fails
 * lexicon on both tax entities.
 */
export function schemas(strict = false): Record<string, object> {
  return {
    [SEED]: group('Seed', {
      address_has_parcel: { type: 'string', cid: ADDRESS_HAS_PARCEL },
    }),
    [COUNTY]: group('County', {
      property_has_address: {
        type: ['string', 'null'],
        cid: PROPERTY_HAS_ADDRESS,
      },
      property_has_tax: {
        type: ['array', 'null'],
        items: { type: 'string', cid: PROPERTY_HAS_TAX },
      },
    }),
    [ADDRESS_HAS_PARCEL]: relationship('address_has_parcel', ADDRESS, PARCEL),
    [PROPERTY_HAS_ADDRESS]: relationship(
      'property_has_address',
      PROPERTY,
      ADDRESS
    ),
    [PROPERTY_HAS_TAX]: relationship('property_has_tax', PROPERTY, TAX),
    [PROPERTY]: {
      type: 'object',
      title: 'property',
      properties: {
        parcel_identifier: { type: 'string' },
        property_type: { type: 'string' },
        property_structure_built_year: { type: 'integer' },
        livable_floor_area: { type: 'string' },
        number_of_units: { type: ['integer', 'null'] },
        historic_designation: { type: 'boolean' },
        subdivision: { type: ['string', 'null'] },
        request_identifier: { type: 'string' },
      },
      required: ['parcel_identifier'],
    },
    [ADDRESS]: {
      type: 'object',
      title: 'address',
      properties: {
        unnormalized_address: { type: 'string' },
        county_name: { type: 'string' },
        longitude: { type: 'number' },
        latitude: { type: 'number' },
        source_http_request: { type: 'object' },
        request_identifier: { type: 'string' },
      },
    },
    [PARCEL]: {
      type: 'object',
      title: 'parcel',
      properties: {
        parcel_identifier: { type: 'string' },
        source_http_request: { type: 'object' },
        request_identifier: { type: 'string' },
      },
    },
    [TAX]: {
      type: 'object',
      title: 'tax',
      properties: {
        tax_year: { type: strict ? 'string' : 'integer' },
        property_assessed_value_amount: { type: 'number' },
        request_identifier: { type: 'string' },
      },
    },
  };
}

export function services(strict = false) {
  const known = schemas(strict);
  return {
    schemaCacheService: {
      get: async (schema: string) => known[schema],
      warm: async () => undefined,
    } as unknown as SchemaCacheService,
    schemaManifestService: {
      loadSchemaManifest: async () => ({}),
      getDataGroupCidByLabel: (label: string) =>
        ({ Seed: SEED, County: COUNTY })[label] ?? null,
    } as unknown as SchemaManifestService,
  };
}

/** `hash` a property directory (or a directory of them) into `out`, linked or packed. */
export async function hash(
  input: string,
  out: string,
  packed: boolean,
  overrides = services()
) {
  await fsPromises.mkdir(out, { recursive: true });
  const outputs = {
    outputZip: path.join(out, 'hashed.zip'),
    outputCsv: path.join(out, 'hash.csv'),
    outputCar: path.join(out, 'county.car'),
  };
  await handleHash(
    { input, ...outputs, packed, silent: true, cwd: out },
    overrides
  );
  const reader = await CarReader.fromBytes(
    await fsPromises.readFile(outputs.outputCar)
  );
  const blocks = new Map<string, Uint8Array>();
  for await (const block of reader.blocks()) {
    blocks.set(block.cid.toString(), block.bytes);
  }
  const csv = await fsPromises.readFile(outputs.outputCsv, 'utf-8');
  return {
    ...outputs,
    /** CSV rows keyed by `filePath`: the data CID of each data group. */
    data: Object.fromEntries(
      csv
        .trim()
        .split('\n')
        .slice(1)
        .map((line) => line.split(','))
        .map((row) => [row[3], row[2]])
    ) as Record<string, string>,
    blocks,
  };
}

/** JSON entries of a hashed ZIP: `<propertyCid>/<cid>.json` -> bytes. */
export function zipped(file: string): Map<string, Buffer> {
  return new Map(
    new AdmZip(file)
      .getEntries()
      .filter((entry) => entry.entryName.endsWith('.json'))
      .map((entry) => [entry.entryName, entry.getData()])
  );
}
