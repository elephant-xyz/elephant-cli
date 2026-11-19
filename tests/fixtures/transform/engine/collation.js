// Scripts order owners, sales and keys with `a.localeCompare(b)`.
const fs = require('fs');
const path = require('path');

const ascii = [];
for (let code = 32; code < 127; code++) ascii.push(String.fromCharCode(code));
const words = [
  'apple', 'Apple', 'APPLE', 'banana', 'Banana', 'a-b', 'ab', 'a b', 'a_b', 'aB', 'Ab', 'AB', 'a', 'B', 'b', 'A',
  '10', '9', '2', '1a', 'a1', 'Z', 'z', 'é', 'e', 'f', 'E', 'É', 'résumé', 'resume', 'Resume', 'ñ', 'n', 'o',
  'SMITH JOHN', 'SMITH, JOHN', 'SMITH-JONES', 'SMITHSON', 'SMITH  JOHN', "O'BRIEN", 'OBRIEN', 'O BRIEN',
  '2020-01-05', '2019-12-31', '', ' ', 'co-op', 'coop', 'CO-OP', 'a.b', 'a,b', 'a;b', 'a:b', 'a/b', 'a&b', 'a(b', 'a#b',
  'ä', 'ae', 'ß', 'ss', 'æ', 'Ø', 'L.L.C.', 'LLC', 'llc', 'MC DONALD', 'MCDONALD', 'McDonald', 'Mc Donald',
  'person_1.json', 'person_10.json', 'person_2.json', 'company_1.json', 'relationship_sales_person_1.json',
  'property_has_address', 'property_has_lot', 'PropertyHasAddress', '100 MAIN ST', '99 MAIN ST', '100 Main St',
  'DOE JOHN & JANE', 'DOE JOHN AND JANE', 'DOE, JOHN', 'DOE JOHN', 'DOE JOHN JR', 'DOE JOHN  JR',
  'TRUST #1', 'TRUST 1', 'TRUST (1)', '$100', '100%', '1/5/2020', '01/05/2020', '12/31/1999', 'naïve', 'naive', 'Naive',
  'ç', 'c', 'd', 'ö', 'oe', 'œ', 'ü', 'u', 'v', 'Å', 'à', 'à', 'À', 'á', 'â', 'a\tb', 'a\nb', ' ', 'a b',
  '·', '—', '–', '-', '‘', '’', '“', '”', '©', '®', '°', '€', '£', '¢', 'ø', 'Ł', 'ł', 'l', 'm',
];
const pairs = [
  ['a', 'B'], ['B', 'a'], ['a', 'a'], ['a', 'A'], ['A', 'a'], ['ab', 'a'], ['', 'a'], ['é', 'f'], ['e', 'é'],
  ['aé', 'af'], ['ae', 'aE'], ['aE', 'áe'], ['ab', 'Ab'], ['Ab', 'aB'], ['a', 'ä'], ['A', 'ä'], ['ß', 'ss'], ['ß', 'st'],
  ['a b', 'ab'], ['a-b', 'ab'], ['a', 'a '], ['x', undefined], ['undefined', undefined], ['1', 1], ['10', '9'],
];
// name-like strings from a fixed pseudo-random sequence
let seed = 20261112;
const next = (below) => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return Math.floor((seed / 2147483648) * below);
};
const alphabet = "abcdeilmnorstuABCDEILMNORSTU0123456789  --,,..''&#/()_\u00e9\u00f1\u00fc\u00c9";
const random = [];
for (let count = 0; count < 400; count++) {
  let word = '';
  for (let length = next(9); length >= 0; length--) word += alphabet[next(alphabet.length)];
  random.push(word);
}
const sorted = (list, ...options) => list.slice().sort((a, b) => a.localeCompare(b, ...options));
const checks = {
  ascii: sorted(ascii).join(''),
  words: sorted(words),
  words_reversed: sorted(words.slice().reverse()),
  signs: pairs.map(([a, b]) => Math.sign(a.localeCompare(b))),
  numeric: sorted(['a10', 'a9', 'a2', 'A10', '10', '9', '1.5', '1.10', 'x', '007', '7', 'a007', 'a7'], undefined, { numeric: true }),
  base: [['a', 'A'], ['a', 'á'], ['a', 'b'], ['ab', 'AB'], ['é', 'E']].map(([a, b]) => a.localeCompare(b, undefined, { sensitivity: 'base' })),
  accent: [['a', 'A'], ['a', 'á'], ['a', 'b'], ['é', 'E']].map(([a, b]) => Math.sign(a.localeCompare(b, 'en', { sensitivity: 'accent' }))),
  cased: [['a', 'A'], ['a', 'á'], ['a', 'b'], ['é', 'E']].map(([a, b]) => Math.sign(a.localeCompare(b, 'en', { sensitivity: 'case' }))),
  english: sorted(['b', 'a', 'B', 'A', 'ä', 'z'], 'en-US'),
  random: sorted(random),
  random_numeric: sorted(random, undefined, { numeric: true }),
};

fs.mkdirSync('data', { recursive: true });
fs.writeFileSync(path.join('data', 'probe.json'), JSON.stringify({ checks }, null, 2));
