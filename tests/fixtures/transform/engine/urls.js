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
const query = new URLSearchParams('a=1&b=two+words&a=3&c=%26%3D&d&e=&f=x%20y&=nokey');
const built = new URLSearchParams({ parcel: '12 34', tab: 'a&b', empty: '' });
const pairs = new URLSearchParams([['k', 'v1'], ['k', 'v2'], ['z', 'é/ü?']]);
const live = new URL('https://ex.com/p?a=1&b=2');
live.searchParams.set('a', 'x y');
live.searchParams.append('c', '3');
live.searchParams.delete('b');
const moved = new URL('https://ex.com/p?a=1#h');
moved.pathname = '/q r';
moved.search = '?z=9';
moved.hash = 'end';
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
  query_build: [String(built), String(pairs), String(new URLSearchParams('?x=1')), String(new URLSearchParams()), String(new URLSearchParams('a=b c&d=e+f'))],
  query_sort: (() => {
    const sorted = new URLSearchParams('b=2&a=1&c=3&a=0');
    sorted.sort();
    return String(sorted);
  })(),
  from_url: (() => {
    const url = new URL('https://county.example.com/Parcel.aspx?ParcelID=12-34-56&Year=2024&q=a%20b');
    return [url.searchParams.get('ParcelID'), url.searchParams.get('year'), url.searchParams.get('q'), Object.fromEntries(url.searchParams.entries())];
  })(),
  live: [live.href, live.search, String(live.searchParams)],
  moved: [moved.href, moved.pathname, moved.search, moved.hash],
  text: [String(new URL('https://ex.com/a?b#c')), JSON.stringify({ url: new URL('https://ex.com/a') }), new URL('https://ex.com/a').toJSON(), `${new URL('https://ex.com')}`],
  statics: [typeof URL.canParse === 'function' ? URL.canParse('https://ex.com') : true, typeof URL.canParse === 'function' ? URL.canParse('nope') : false],
  module: (() => {
    const url = require('url');
    return [typeof url.URL, typeof url.URLSearchParams, url.fileURLToPath('file:///tmp/a%20b.txt'), url.pathToFileURL('/tmp/a b.txt').href];
  })(),
  querystring: (() => {
    const querystring = require('querystring');
    return [querystring.parse('a=1&b=x%20y&a=2'), querystring.stringify({ a: [1, 2], b: 'x y' })];
  })(),
};

fs.mkdirSync('data', { recursive: true });
fs.writeFileSync(path.join('data', 'probe.json'), JSON.stringify({ checks }, null, 2));
