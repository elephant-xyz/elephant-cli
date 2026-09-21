import { promises as fsPromises } from 'fs';
import { CarWriter } from '@ipld/car';
import * as dagJSON from '@ipld/dag-json';
import * as raw from 'multiformats/codecs/raw';
import { CID } from 'multiformats/cid';
import { sha256 } from 'multiformats/hashes/sha2';
import { SchemaCacheService } from '../../src/services/schema-cache.service.js';

export interface Block {
  cid: CID;
  bytes: Uint8Array;
}

export async function json(value: unknown): Promise<Block> {
  const bytes = dagJSON.encode(value);
  return {
    cid: CID.create(1, dagJSON.code, await sha256.digest(bytes)),
    bytes,
  };
}

export async function text(value: string): Promise<Block> {
  const bytes = new TextEncoder().encode(value);
  return { cid: CID.create(1, raw.code, await sha256.digest(bytes)), bytes };
}

export const GROUP = (await text('county data group schema')).cid.toString();
export const LINK = (await text('property_to_address schema')).cid.toString();
export const PROPERTY = (await text('property class schema')).cid.toString();
export const ADDRESS = (await text('address class schema')).cid.toString();
export const OTHER_GROUP = (
  await text('other data group schema')
).cid.toString();
export const OTHER_LINK = (
  await text('property_to_property schema')
).cid.toString();
export const OTHER_PROPERTY = (
  await text('another property class schema')
).cid.toString();

/** Data group -> relationship -> class schemas, shaped like the lexicon. */
export const SCHEMAS: Record<string, object> = {
  [GROUP]: {
    type: 'object',
    title: 'County',
    properties: {
      label: { type: 'string' },
      relationships: {
        type: 'object',
        properties: {
          property_has_address: {
            type: ['array', 'null'],
            items: { type: 'string', cid: LINK },
          },
        },
      },
    },
  },
  [LINK]: {
    type: 'object',
    title: 'property_to_address',
    properties: {
      from: { type: 'string', cid: PROPERTY },
      to: { type: 'string', cid: ADDRESS },
    },
  },
  [PROPERTY]: {
    type: 'object',
    title: 'property',
    properties: {
      parcel_identifier: { type: 'string' },
      units: { type: ['integer', 'null'] },
      area: { type: 'number' },
      historic: { type: 'boolean' },
      source_http_request: { type: 'object' },
      request_identifier: { type: 'string' },
    },
    required: ['parcel_identifier'],
  },
  [ADDRESS]: {
    type: 'object',
    title: 'Address',
    properties: {
      city: { type: 'string' },
      request_identifier: { type: 'string' },
    },
  },
  // A second class schema titled `property` with other columns, reached through another data group.
  [OTHER_GROUP]: {
    type: 'object',
    title: 'Other',
    properties: {
      label: { type: 'string' },
      relationships: {
        type: 'object',
        properties: { property_has_twin: { type: 'string', cid: OTHER_LINK } },
      },
    },
  },
  [OTHER_LINK]: {
    type: 'object',
    title: 'property_to_property',
    properties: {
      from: { type: 'string', cid: PROPERTY },
      to: { type: 'string', cid: OTHER_PROPERTY },
    },
  },
  [OTHER_PROPERTY]: {
    type: 'object',
    title: 'property',
    properties: { nickname: { type: 'string' } },
  },
};

export const schemaCacheService = {
  get: async (cid: string) => SCHEMAS[cid],
} as unknown as SchemaCacheService;

export interface Tweaks {
  /** Property `b` gets a number where its schema wants a string. */
  bad?: boolean;
  /** Property `b`'s address links to a block that is not in the car. */
  dangling?: boolean;
  /** Property `b`'s relationship points at a block that is not in the car. */
  lost?: boolean;
  /** One block nothing links to. */
  extra?: boolean;
  /** Property `b` also carries a second data group whose class is another schema titled `property`. */
  twin?: boolean;
  /** No properties at all: an index with zero shards. */
  empty?: boolean;
}

/**
 * Two properties `a` and `b`, each a data-group root -> one
 * `property_has_address` relationship block -> a property and an address
 * entity, in that block order, then the shard and the county index (and the
 * extra block last). `entities` lists property a, address a, property b,
 * address b; `nowhere` is the link used by `dangling` and `lost`.
 */
export async function buildCountyCar(
  file: string,
  tweaks: Tweaks = {}
): Promise<{ root: CID; blocks: Block[]; entities: CID[]; nowhere: CID }> {
  const blocks: Block[] = [];
  const entries: { property_cid: CID; data_groups: Record<string, CID> }[] = [];
  const entities: CID[] = [];
  const nowhere = (await text('nowhere')).cid;
  for (const [index, suffix] of tweaks.empty ? [] : ['a', 'b'].entries()) {
    const b = suffix === 'b';
    const property = await json({
      parcel_identifier: tweaks.bad && b ? 7 : `parcel-${suffix}`,
      units: index === 0 ? 3 : null,
      area: 12.5 + index,
      historic: b,
      source_http_request: { method: 'GET', url: `https://x/${suffix}` },
      request_identifier: `req-${suffix}`,
    });
    const address = await json({
      city: `City ${suffix}`,
      request_identifier: `req-${suffix}`,
      ...(tweaks.dangling && b ? { extra: nowhere } : {}),
    });
    const link = await json({ from: property.cid, to: address.cid });
    const root = await json({
      label: 'County',
      relationships: {
        property_has_address: [tweaks.lost && b ? nowhere : link.cid],
      },
    });
    blocks.push(root, link, property, address);
    entities.push(property.cid, address.cid);
    const twin = await json({ nickname: `twin-${suffix}` });
    const twinLink = await json({ from: property.cid, to: twin.cid });
    const other = await json({
      label: 'Other',
      relationships: { property_has_twin: twinLink.cid },
    });
    if (tweaks.twin && b) {
      blocks.push(other, twinLink, twin);
    }
    entries.push({
      property_cid: root.cid,
      data_groups: {
        [GROUP]: root.cid,
        ...(tweaks.twin && b ? { [OTHER_GROUP]: other.cid } : {}),
      },
    });
  }
  const shard = await json({ properties: entries });
  const index = await json({
    label: 'CountyIndex',
    version: 1,
    properties: entries.length,
    shards: tweaks.empty ? [] : [shard.cid],
  });
  blocks.push(...(tweaks.empty ? [] : [shard]), index);
  if (tweaks.extra) {
    blocks.push(await text('unreachable'));
  }
  const channel = CarWriter.create([index.cid]);
  const chunks: Uint8Array[] = [];
  const drained = (async () => {
    for await (const chunk of channel.out) {
      chunks.push(chunk);
    }
  })();
  for (const block of blocks) {
    await channel.writer.put(block);
  }
  await channel.writer.close();
  await drained;
  await fsPromises.writeFile(file, Buffer.concat(chunks));
  return { root: index.cid, blocks, entities, nowhere };
}
