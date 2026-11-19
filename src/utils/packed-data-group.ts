import {
  CidCalculatorService,
  decodeDagJson,
} from '../services/cid-calculator.service.js';
import { IPLDCanonicalizerService } from '../services/ipld-canonicalizer.service.js';

/**
 * Packed data groups: one block per data group of a property instead of a
 * root, one block per relationship and one per class file ("linked").
 *
 *   { "entities":      { "<entity cid>": <entity value>, ... },
 *     "label":         <label of the linked root>,
 *     "relationships": { "<key>": null | REL | [REL, ...] } }
 *
 * REL is a relationship block with `from` and `to` replaced by the CID string
 * of the entity it linked to; never `{"/": ...}`, which dag-json reads as a
 * real link to a block that is not there. Bytes and CID are those of any
 * other block: canonical JSON, dag-json, sha2-256, CIDv1. A root is packed if
 * and only if it is a JSON object with an `entities` member.
 */

type Json = Record<string, unknown>;

export interface Finding {
  path: string;
  message: string;
}

export interface Unpacked {
  /** The linked root `{label, relationships}`, as its canonical JSON parses. */
  root: Json;
  /** CID of the linked root. */
  cid: string;
  /** Canonical JSON bytes by CID: the linked root, entities by key, relationship blocks by computed CID. */
  blocks: Map<string, Uint8Array>;
  /** What is wrong with the packed form itself; empty for a block `pack` wrote. */
  findings: Finding[];
}

const canonicalizer = new IPLDCanonicalizerService();
const calculator = new CidCalculatorService();

function isObject(value: unknown): value is Json {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function isPacked(value: unknown): value is Json {
  return isObject(value) && Object.hasOwn(value, 'entities');
}

/** A JSON object with exactly one member `"/"` whose value is a string. */
function isLink(value: unknown): value is { '/': string } {
  return (
    isObject(value) &&
    Object.keys(value).length === 1 &&
    typeof value['/'] === 'string'
  );
}

/** Largest packed block, in bytes of canonical JSON. */
export const PACKED_LIMIT = 1_048_576;

/**
 * The canonical JSON of the packed block of a linked data-group root, or
 * undefined when the group has to stay linked: a Seed root (its CID is the
 * property CID), a relationship value that is not null, a link or an array of
 * links, a relationship block that is not an object whose `from` and `to`
 * link to blocks `block` knows with no other link in it, an entity holding a
 * link, or a packed block that is over `PACKED_LIMIT` or not dag-json (its
 * CID would be raw, which no reader takes for a data-group root). `block`
 * returns the JSON value of a block of this run by CID.
 */
export function pack(
  root: unknown,
  block: (cid: string) => unknown
): string | undefined {
  // The canonical form sorts link arrays by CID; packed arrays keep that order.
  const linked: unknown = JSON.parse(canonicalizer.canonicalize(root));
  if (
    !isObject(linked) ||
    linked.label === 'Seed' ||
    !isObject(linked.relationships)
  ) {
    return undefined;
  }
  const entities: Json = {};
  const relationship = (link: unknown): Json | undefined => {
    const body = isLink(link) ? block(link['/']) : undefined;
    if (
      !isObject(body) ||
      !isLink(body.from) ||
      !isLink(body.to) ||
      calculator.hasIPLDLinks({ ...body, from: null, to: null })
    ) {
      return undefined;
    }
    for (const end of [body.from['/'], body.to['/']]) {
      // An entity most relationships share (the property) is read once.
      const entity = Object.hasOwn(entities, end) ? entities[end] : block(end);
      if (entity === undefined || calculator.hasIPLDLinks(entity)) {
        return undefined;
      }
      entities[end] = entity;
    }
    return { ...body, from: body.from['/'], to: body.to['/'] };
  };
  const relationships: Json = {};
  for (const [key, value] of Object.entries(linked.relationships)) {
    const items = value === null ? [] : [value].flat().map(relationship);
    if (items.includes(undefined)) {
      return undefined;
    }
    relationships[key] =
      value === null ? null : Array.isArray(value) ? items : items[0];
  }
  const json = canonicalizer.canonicalize({
    entities,
    label: linked.label,
    relationships,
  });
  const bytes = Buffer.from(json, 'utf-8');
  return bytes.length <= PACKED_LIMIT && decodeDagJson(bytes) !== undefined
    ? json
    : undefined;
}

/**
 * The blocks of an unpacked root as a block source for
 * `JsonValidatorService.validate`. A CID it lacks is an error that names the
 * packed data group, whatever container the root came in.
 */
export function unpackedSource(unpacked: Unpacked) {
  return async (cid: string): Promise<Uint8Array> => {
    const bytes = unpacked.blocks.get(cid);
    if (!bytes) {
      throw new Error(`block ${cid} is not in the packed data group`);
    }
    return bytes;
  };
}

/** The linked form of a packed root: what the linked-only code already reads. */
export async function unpack(packed: Json): Promise<Unpacked> {
  const blocks = new Map<string, Uint8Array>();
  const findings: Finding[] = [];
  const block = async (value: unknown, key?: string): Promise<string> => {
    const json = canonicalizer.canonicalize(value);
    const cid = await calculator.calculateCidFromCanonicalJson(json);
    blocks.set(key ?? cid, Buffer.from(json, 'utf-8'));
    return cid;
  };
  if (!isObject(packed.entities)) {
    findings.push({
      path: '/entities',
      message: 'packed data group: "entities" is not an object',
    });
  }
  const entities = isObject(packed.entities) ? packed.entities : {};
  for (const [key, value] of Object.entries(entities)) {
    const cid = await block(value, key);
    if (cid !== key) {
      findings.push({
        path: `/entities/${key}`,
        message: `packed data group: entity key ${key} is not the CID of its value (${cid})`,
      });
    }
  }
  const used = new Set<string>();
  const link = async (relationship: unknown) => {
    const body = isObject(relationship) ? { ...relationship } : relationship;
    const missing: Finding[] = [];
    for (const end of isObject(body) ? ['from', 'to'] : []) {
      const target = (body as Json)[end];
      if (typeof target !== 'string') {
        continue;
      }
      used.add(target);
      if (isObject(packed.entities) && !Object.hasOwn(entities, target)) {
        missing.push({
          path: end,
          message: `packed data group: ${end} ${JSON.stringify(target)} is not a key of "entities"`,
        });
      }
      (body as Json)[end] = { '/': target };
    }
    return { cid: await block(body), missing };
  };
  const relationships: Json = {};
  // Canonical JSON cannot carry a `__proto__` member, so the linked root has
  // no such relationship; skipped here, what only it references is reported.
  for (const [key, value] of Object.entries(
    isObject(packed.relationships) ? packed.relationships : {}
  ).filter(([key]) => key !== '__proto__')) {
    const items = await Promise.all(
      value === null ? [] : [value].flat().map(link)
    );
    // The linked root sorts an array by CID; finding paths are its paths.
    const sorted = [...items].sort((a, b) => a.cid.localeCompare(b.cid));
    for (const [index, item] of sorted.entries()) {
      const path = `/relationships/${key}${Array.isArray(value) ? `/${index}` : ''}`;
      findings.push(
        ...item.missing.map((finding) => ({
          ...finding,
          path: `${path}/${finding.path}`,
        }))
      );
    }
    const links = sorted.map((item) => ({ '/': item.cid }));
    relationships[key] =
      value === null ? null : Array.isArray(value) ? links : links[0];
  }
  for (const key of Object.keys(entities).filter((key) => !used.has(key))) {
    findings.push({
      path: `/entities/${key}`,
      message: `packed data group: entity ${key} is referenced by no relationship`,
    });
  }
  // Every member but `entities` stays, so the schema rejects what a linked root may not have.
  const json = canonicalizer.canonicalize(
    Object.fromEntries(
      Object.entries(packed)
        .filter(([key]) => key !== 'entities')
        .map(([key, value]) => [
          key,
          key === 'relationships' && isObject(value) ? relationships : value,
        ])
    )
  );
  const cid = await calculator.calculateCidFromCanonicalJson(json);
  blocks.set(cid, Buffer.from(json, 'utf-8'));
  return { root: JSON.parse(json), cid, blocks, findings };
}
