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
export const SEED = (await text('seed data group schema')).cid.toString();

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
  [SEED]: {
    type: 'object',
    title: 'Seed',
    properties: {
      label: { type: 'string' },
      relationships: { type: 'object', properties: {} },
    },
  },
};

export const schemaCacheService = {
  get: async (cid: string) => SCHEMAS[cid],
  warm: async () => undefined,
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
  /** Every property also carries a Seed data group with no relationships. */
  seed?: boolean;
  /** One shard per property, each written right after its property's blocks. */
  split?: boolean;
  /** Split, and property `b` links to property `a`'s address block instead of carrying its own. */
  shared?: boolean;
  /** Split, and property `b`'s blocks include a second copy of `a`'s address block that `b` does not link. */
  spare?: boolean;
  /** Split, and property `b`'s address block is written among property `a`'s blocks. */
  late?: boolean;
  /** The same blocks written in reverse order: the county index first. */
  reversed?: boolean;
  /** The index lists its only shard twice. */
  twice?: boolean;
  /** The index lists no shards although the file holds one. */
  unlisted?: boolean;
  /** Split, and property `b`'s shard block is listed by the index but not written. */
  gone?: boolean;
  /** Property `a`'s address block is written twice in a row. */
  doubled?: boolean;
  /** Split, property `a`'s address links to a block that is not in the car, and `b`'s shard lists that block as a data group. */
  claimed?: boolean;
}

/**
 * Two properties `a` and `b`, each a data-group root -> one
 * `property_has_address` relationship block -> a property and an address
 * entity, in that block order, then the shard and the county index (and the
 * extra block last). `entities` lists property a, address a, property b and
 * the address b links to; `nowhere` is the link used by `dangling` and `lost`.
 */
export async function buildCountyCar(
  file: string,
  tweaks: Tweaks = {}
): Promise<{ root: CID; blocks: Block[]; entities: CID[]; nowhere: CID }> {
  const blocks: Block[] = [];
  const entries: { property_cid: CID; data_groups: Record<string, CID> }[] = [];
  const entities: CID[] = [];
  const nowhere = (await text('nowhere')).cid;
  const split = Boolean(
    tweaks.split ||
      tweaks.shared ||
      tweaks.spare ||
      tweaks.late ||
      tweaks.gone ||
      tweaks.claimed
  );
  const shards: Block[] = [];
  const addresses: Block[] = [];
  const addressOf = (suffix: string) =>
    json({
      city: `City ${suffix}`,
      request_identifier: `req-${suffix}`,
      ...((tweaks.dangling && suffix === 'b') ||
      (tweaks.claimed && suffix === 'a')
        ? { extra: nowhere }
        : {}),
    });
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
    addresses.push(await addressOf(suffix));
    const address = addresses[tweaks.shared ? 0 : index];
    const link = await json({ from: property.cid, to: address.cid });
    const root = await json({
      label: 'County',
      relationships: {
        property_has_address: [tweaks.lost && b ? nowhere : link.cid],
      },
    });
    blocks.push(root, link, property);
    if (!(b && (tweaks.shared || tweaks.late))) {
      blocks.push(address);
    }
    if (!b && tweaks.late) {
      blocks.push(await addressOf('b'));
    }
    if (!b && tweaks.doubled) {
      blocks.push(address);
    }
    if (b && tweaks.spare) {
      blocks.push(addresses[0]);
    }
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
    const seed = await json({ label: 'Seed', relationships: {} });
    if (tweaks.seed) {
      blocks.push(seed);
    }
    entries.push({
      property_cid: root.cid,
      data_groups: {
        [GROUP]: root.cid,
        ...(tweaks.twin && b ? { [OTHER_GROUP]: other.cid } : {}),
        ...(tweaks.seed ? { [SEED]: seed.cid } : {}),
        ...(tweaks.claimed && b ? { [SEED]: nowhere } : {}),
      },
    });
    if (split) {
      shards.push(await json({ properties: [entries[index]] }));
      blocks.push(...(tweaks.gone && b ? [] : [shards[index]]));
    }
  }
  if (!split && !tweaks.empty) {
    shards.push(await json({ properties: entries }));
    blocks.push(shards[0]);
  }
  const index = await json({
    label: 'CountyIndex',
    version: 1,
    properties: entries.length,
    shards: [...shards, ...(tweaks.twice ? shards : [])]
      .filter(() => !tweaks.unlisted)
      .map((shard) => shard.cid),
  });
  blocks.push(index);
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
  for (const block of tweaks.reversed ? [...blocks].reverse() : blocks) {
    await channel.writer.put(block);
  }
  await channel.writer.close();
  await drained;
  await fsPromises.writeFile(file, Buffer.concat(chunks));
  return { root: index.cid, blocks, entities, nowhere };
}
