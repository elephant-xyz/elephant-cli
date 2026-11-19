import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import {
  pack,
  PACKED_LIMIT,
  unpack,
} from '../../../src/utils/packed-data-group.js';

const vector = (name: string) =>
  JSON.parse(
    readFileSync(
      path.join(__dirname, '../../fixtures/packed', name, 'packed.json'),
      'utf-8'
    )
  );

describe('unpack', () => {
  it.each([
    [
      'vector-1',
      'baguqeerad7ribhalqwds5cm4l4mpclt7cr4qbuyrv3rxex4n5bwvga4pewja',
    ],
    [
      'vector-2',
      'baguqeerap73zkcd4lmiy2blzhbmh6hwdivicucv7nfi5kqvrh5y2kvg4z5mq',
    ],
  ])(
    'turns the packed block of %s back into its linked root',
    async (name, cid) => {
      const unpacked = await unpack(vector(name));
      expect(unpacked.cid).toBe(cid);
      expect(unpacked.findings).toEqual([]);
    }
  );

  const PROPERTY =
    'baguqeera2vep6rq3g4gdjfxkn65fx6g3ztgqoszjbezh5afdikupr23oqzha';
  const ADDRESS =
    'baguqeerag55b2l2jd6rdhr7xeyv4bo7skhrry6ng5tj7zm4refxtc6x7numq';

  it('reports entities that is not an object', async () => {
    const unpacked = await unpack({ ...vector('vector-1'), entities: [] });
    expect(unpacked.findings).toEqual([
      { path: '/entities', message: expect.stringContaining('object') },
    ]);
  });

  it('reports an entity key that is not the CID of its value', async () => {
    const packed = vector('vector-1');
    packed.entities[PROPERTY].number_of_units = 2;
    const unpacked = await unpack(packed);
    expect(unpacked.findings).toEqual([
      {
        path: `/entities/${PROPERTY}`,
        message: expect.stringContaining('is not the CID of its value'),
      },
    ]);
    // Entities resolve by key, whatever their value hashes to.
    expect(
      JSON.parse(Buffer.from(unpacked.blocks.get(PROPERTY)!).toString())
    ).toMatchObject({ number_of_units: 2 });
  });

  it('reports a from or to that is not a key of entities', async () => {
    const packed = vector('vector-1');
    delete packed.entities[ADDRESS];
    const unpacked = await unpack(packed);
    expect(unpacked.findings).toEqual([
      {
        path: '/relationships/property_has_address/to',
        message: expect.stringContaining(`"${ADDRESS}" is not a key of`),
      },
    ]);
  });

  it.each([[[0, 1]], [[1, 0]]])(
    'reports a from or to at its index in the linked root, whatever the packed order (%j)',
    async (order) => {
      const packed = vector('vector-2');
      const [first, second] = packed.relationships.property_has_tax;
      second.to = 'nowhere';
      packed.relationships.property_has_tax = order.map(
        (index) => [first, second][index]
      );
      const unpacked = await unpack(packed);
      const links = (unpacked.root.relationships as Record<string, unknown>)
        .property_has_tax as { '/': string }[];
      const index = links.findIndex((link) =>
        Buffer.from(unpacked.blocks.get(link['/'])!).includes('nowhere')
      );
      expect(
        unpacked.findings
          .filter((finding) => finding.message.includes('"nowhere"'))
          .map((finding) => finding.path)
      ).toEqual([`/relationships/property_has_tax/${index}/to`]);
    }
  );

  it('reports an entity no relationship references', async () => {
    const packed = vector('vector-1');
    packed.relationships.property_has_address = null;
    const unpacked = await unpack(packed);
    expect(unpacked.findings.map((finding) => finding.path)).toEqual([
      `/entities/${PROPERTY}`,
      `/entities/${ADDRESS}`,
    ]);
    expect(unpacked.findings[0].message).toContain('no relationship');
  });

  it('leaves a from or to that is not a string as it is', async () => {
    const packed = vector('vector-1');
    packed.relationships.property_has_address.to = 7;
    delete packed.entities[ADDRESS];
    const unpacked = await unpack(packed);
    expect(unpacked.findings).toEqual([]);
    const [link] = Object.values(unpacked.root.relationships as object);
    expect(
      JSON.parse(Buffer.from(unpacked.blocks.get(link['/'])!).toString())
    ).toEqual({ from: { '/': PROPERTY }, to: 7 });
  });

  it('does not let a __proto__ relationship hide an entity', async () => {
    // The canonical form cannot carry a `__proto__` member, so the linked root has no such relationship.
    const packed = JSON.parse(
      JSON.stringify(vector('vector-1')).replace(
        '"property_has_address"',
        '"__proto__"'
      )
    );
    const unpacked = await unpack(packed);
    expect(unpacked.root).toEqual({ label: 'County', relationships: {} });
    expect(unpacked.findings.map((finding) => finding.path)).toEqual([
      `/entities/${PROPERTY}`,
      `/entities/${ADDRESS}`,
    ]);
  });

  it('keeps a relationship value that is not an object as it is, links first', async () => {
    const packed = vector('vector-1');
    const relationship = packed.relationships.property_has_address;
    packed.relationships = { one: 5, many: ['x', relationship, 5] };
    const unpacked = await unpack(packed);
    expect(unpacked.findings).toEqual([]);
    expect(unpacked.root.relationships).toEqual({
      one: 5,
      many: [{ '/': expect.stringMatching(/^bagu/) }, 'x', 5],
    });
    // the linked root, one relationship block and the two entities
    expect(unpacked.blocks.size).toBe(4);
  });

  it('keeps what it cannot unpack in the linked root, for the schema to reject', async () => {
    const unpacked = await unpack({
      entities: {},
      label: 'County',
      relationships: 'none',
      extra: true,
    });
    expect(unpacked.root).toEqual({
      label: 'County',
      relationships: 'none',
      extra: true,
    });
  });
});

describe('pack', () => {
  const link = (cid: string) => ({ '/': cid });
  const blocks: Record<string, unknown> = {
    owner: { name: 'Ada' },
    home: { city: 'Fort Myers' },
    'rel-b': { from: link('owner'), to: link('home') },
    'rel-a': { from: link('owner'), to: link('home'), since: 1987 },
    'rel-linked': { from: link('owner'), to: link('home'), deed: link('home') },
    'rel-lost': { from: link('owner'), to: link('nowhere') },
    'rel-flat': { from: 'owner', to: link('home') },
    nested: { deed: [link('home')] },
    'rel-nested': { from: link('owner'), to: link('nested') },
    // `{"/": ...}` with a second member is not a link, and not dag-json either.
    odd: { deed: { '/': 'home', page: 1 } },
    'rel-odd': { from: link('owner'), to: link('odd') },
  };
  const run = (relationships: unknown, label = 'County') =>
    pack({ label, relationships }, (cid) => blocks[cid]);

  it('embeds entities and keeps the sorted order, duplicates and other members of relationships', () => {
    expect(
      JSON.parse(
        run({
          none: null,
          one: link('rel-b'),
          many: [link('rel-b'), link('rel-a'), link('rel-b')],
        })!
      )
    ).toEqual({
      entities: { owner: { name: 'Ada' }, home: { city: 'Fort Myers' } },
      label: 'County',
      relationships: {
        none: null,
        one: { from: 'owner', to: 'home' },
        many: [
          { from: 'owner', to: 'home', since: 1987 },
          { from: 'owner', to: 'home' },
          { from: 'owner', to: 'home' },
        ],
      },
    });
  });

  it('packs a group with no relationships', () => {
    expect(run({})).toBe('{"entities":{},"label":"County","relationships":{}}');
  });

  it.each([
    ['a Seed root', { one: link('rel-b') }, 'Seed'],
    ['a relationship value that is not a link', { one: 'rel-b' }],
    [
      'an array holding something that is not a link',
      { many: [link('rel-b'), 7] },
    ],
    ['a relationship block that is not in this run', { one: link('gone') }],
    ['a relationship block that is not from/to links', { one: link('owner') }],
    ['a from that is not a link', { one: link('rel-flat') }],
    [
      'a relationship block with another link in it',
      { one: link('rel-linked') },
    ],
    ['an entity that is not in this run', { one: link('rel-lost') }],
    ['an entity containing a link', { one: link('rel-nested') }],
    [
      'a group whose packed block would not be dag-json',
      { one: link('rel-odd') },
    ],
  ])('leaves %s linked', (_name, relationships, label = 'County') => {
    expect(run(relationships, label)).toBeUndefined();
  });

  it('leaves a root that already has entities as it is', () => {
    expect(
      pack(
        {
          entities: { kept: 1 },
          label: 'County',
          relationships: { one: link('rel-b') },
        },
        (cid) => blocks[cid]
      )
    ).toBeUndefined();
  });

  it('packs up to exactly the size limit and not a byte over', () => {
    const size = (pad: number) => {
      const wide = { ...blocks, home: { city: 'x'.repeat(pad) } };
      return pack(
        { label: 'County', relationships: { one: link('rel-b') } },
        (cid) => wide[cid]
      );
    };
    const pad = PACKED_LIMIT - Buffer.byteLength(size(0)!);
    expect(PACKED_LIMIT).toBe(1048576);
    expect(Buffer.byteLength(size(pad)!)).toBe(PACKED_LIMIT);
    expect(size(pad + 1)).toBeUndefined();
  });
});
