// Scripts take parcel ids and page numbers out of source URLs.
const fs = require('fs');
const path = require('path');

const tryit = (run) => {
  try {
    return run();
  } catch (error) {
    return `${error.name}`;
  }
};
const shape = (url) => [url.href, url.protocol, url.host, url.hostname, url.port, url.pathname, url.search, url.hash, url.origin, url.username, url.password];
const absolute = [
  'https://county.example.com/parcel/details.aspx?ParcelID=12-34-56&tab=sales#top',
  'HTTP://Example.COM:8080/a/b/../c/./d.html?x=1&x=2&y=a%20b+c&z=',
  'https://example.com',
  'https://example.com:443/',
  'http://example.com:80/x',
  'https://example.com/a b/ü?q=é ü&r=%C3%A9#frag ment',
  'https://user:pa ss@example.com/p',
  'https://example.com/p?',
  'https://example.com/p#',
  'https://example.com//double//slash',
  'https://example.com/a?b=c?d=e&f=g=h',
  'file:///tmp/work/input.html',
  'https://example.com/%7Euser/a%2Fb',
  'https://EXAMPLE.com/Path/Case?Q=V',
  'https://example.com/a/..',
  'https://example.com/a/./b/../../c',
];
const relative = [
  ['../c?z=1', 'https://ex.com:8080/a/b/page?x=1#h'],
  ['c/d', 'https://ex.com/a/b/'],
  ['c/d', 'https://ex.com/a/b'],
  ['/root?x=1', 'https://ex.com/a/b'],
  ['?page=2', 'https://ex.com/a/b?page=1#h'],
  ['#frag', 'https://ex.com/a/b?page=1'],
  ['//other.example.org/x', 'https://ex.com/a/b'],
  ['https://abs.example.org/y', 'https://ex.com/a/b'],
  ['', 'https://ex.com/a/b?q=1#h'],
  ['./', 'https://ex.com/a/b/c'],
  ['../../../x', 'https://ex.com/a/b/c'],
  ['x y', 'https://ex.com/a/'],
];
const invalid = ['', 'not a url', '/just/a/path', 'example.com/x', '://x', 'http://'];
const query = new URL('https://ex.com/p?a=1&b=two+words&a=3&c=%26%3D&d&e=&f=x%20y&=nokey').searchParams;
const checks = {
  absolute: absolute.map((text) => tryit(() => shape(new URL(text)))),
  relative: relative.map(([text, base]) => tryit(() => new URL(text, base).href)),
  invalid: invalid.map((text) => tryit(() => new URL(text).href)),
  query_get: ['a', 'b', 'c', 'd', 'e', 'f', '', 'missing'].map((name) => query.get(name)),
  query_all: [query.getAll('a'), query.getAll('missing'), query.has('d'), query.has('missing'), query.size],
  query_walk: [[...query.keys()].join(','), [...query.values()].join('|'), [...query.entries()].length, [...query].length, String(query)],
  query_each: (() => {
    const seen = [];
    query.forEach((value, name) => seen.push(`${name}=${value}`));
    return seen;
  })(),
  from_url: (() => {
    const url = new URL('https://county.example.com/Parcel.aspx?ParcelID=12-34-56&Year=2024&q=a%20b');
    return [url.searchParams.get('ParcelID'), url.searchParams.get('year'), url.searchParams.get('q'), Object.fromEntries(url.searchParams.entries())];
  })(),
  text: [String(new URL('https://ex.com/a?b#c')), JSON.stringify({ url: new URL('https://ex.com/a') }), new URL('https://ex.com/a').toJSON(), `${new URL('https://ex.com')}`],
};

fs.mkdirSync('data', { recursive: true });
fs.writeFileSync(path.join('data', 'probe.json'), JSON.stringify({ checks }, null, 2));
