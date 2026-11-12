"""Hash the same properties with elephant-cli 1.x and 2.x and compare every CID and the CAR bytes.

The properties are copies of a valid one whose entity files are filled with JSON
that is awkward to canonicalise: number spellings, escapes, non-ASCII keys,
deep nesting, arrays of links in shuffled order.

Usage: ELEPHANT_CLI_V1='node /path/to/1.x/bin/elephant-cli' hash-diff.py <v2-binary> <property-dir> <schema-cache> <count> [seed]
"""
import json
import os
import random
import shlex
import shutil
import subprocess
import sys
import tempfile

v2, source, cache, count = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4])
v1 = shlex.split(os.environ.get('ELEPHANT_CLI_V1', ''))
if not v1:
    sys.exit('set ELEPHANT_CLI_V1 to the command that runs elephant-cli 1.x, such as "node /path/to/elephant-cli-1.x/bin/elephant-cli"')
random.seed(int(sys.argv[5]) if len(sys.argv) > 5 else 1)
work = tempfile.mkdtemp(prefix='hash-diff-')
county = os.path.join(work, 'county')
os.makedirs(county)

NUMBERS = ['0', '-0', '0.0', '-0.0', '1', '-1', '1.0', '1.50', '100', '1e2', '1E2', '1e+2', '1.0e2', '0.1', '1e-1', '0.000001', '1e-6', '0.0000001', '1e-7', '123456789', '1234567890123456789',
           '12345678901234567890', '123456789012345678901', '1e21', '1e20', '999999999999999999999', '9007199254740991', '9007199254740992', '9007199254740993', '0.1e1', '1.7976931348623157e308',
           '5e-324', '2.2250738585072014e-308', '4.35', '0.3', '2.675', '1.005', '123.456e3', '-1.5e-10', '3.14159265358979323846', '0.30000000000000004', '100.0', '1e0', '25.50', '-123.0e-2',
           '4294967296', '18446744073709551615', '18446744073709551616', '-9223372036854775808', '-9223372036854775809', '1.0000000000000002', '0.5e-323', '7.0e22', '1e23', '6.02214076e23']
STRINGS = ['', ' ', 'plain', 'é', 'ñandú', '日本語', '😀', 'à', 'é', 'é', 'tab\there', 'line\nbreak', 'quote"inside', 'back\\slash', 'slash/forward', '\u0000', '\u001f', '\u007f',
           '\u0080', ' ', ' ', '﻿', '�', '<script>', '&amp;', 'ipfs://bafkreiaaaa', './file.json', '{"/": "x"}', 'null', 'true', '1e5', ' padded ', 'A' * 300, ' ', 'ß', 'İ', 'ǅ']
KEYS = ['a', 'b', 'A', 'aa', 'a1', 'a_b', 'a-b', 'é', 'é', 'z', 'Z', '0', '1', '10', '2', '', ' ', '😀', '𐀀', '￿', 'key with space', '$ref', 'type', '/', 'ä', 'aä', 'b\u0000', '€', '€', '_']


def number():
    return random.choice(NUMBERS)


def value(depth=0):
    """A JSON value as text, so the number spellings reach the file as written."""
    kind = random.choice(['number', 'number', 'string', 'string', 'bool', 'null', 'array', 'object'] if depth < 4 else ['number', 'string', 'bool', 'null'])
    if kind == 'number':
        return number()
    if kind == 'string':
        text = random.choice(STRINGS)
        # sometimes spelled with \u escapes rather than raw characters
        return json.dumps(text, ensure_ascii=random.random() < 0.5)
    if kind == 'bool':
        return random.choice(['true', 'false'])
    if kind == 'null':
        return 'null'
    if kind == 'array':
        return '[' + random.choice([',', ' , ', ',\n']).join(value(depth + 1) for _ in range(random.randrange(5))) + ']'
    keys = random.sample(KEYS, random.randrange(6))
    return '{' + ','.join(json.dumps(key, ensure_ascii=random.random() < 0.5) + random.choice([':', ' : ']) + value(depth + 1) for key in keys) + '}'


names = sorted(os.listdir(source))
for index in range(count):
    target = os.path.join(county, f'property-{index:04d}')
    shutil.copytree(source, target)
    for name in names:
        path = os.path.join(target, name)
        if not name.endswith('.json'):
            continue
        data = json.load(open(path))
        if not isinstance(data, dict):
            continue
        if set(data) == {'label', 'relationships'}:
            # a data-group root: keep its links, shuffle arrays of them
            for links in data['relationships'].values():
                if isinstance(links, list):
                    random.shuffle(links)
            open(path, 'w').write(json.dumps(data))
            continue
        if 'from' in data and 'to' in data and len(data) == 2:
            continue  # a relationship file: links only
        # an entity: keep what it has (the seed needs its fields), add awkward content, vary per property
        extra = ','.join(json.dumps(f'fuzz_{at}_{index}') + ':' + value() for at in range(random.randrange(1, 6)))
        text = json.dumps(data)
        open(path, 'w', encoding='utf-8').write(text[:-1] + (',' if len(data) else '') + extra + '}')

env = dict(os.environ, ELEPHANT_SKIP_UPDATE_CHECK='1', ELEPHANT_OFFLINE='1', ELEPHANT_SCHEMA_CACHE_DIR=cache)
runs = {
    'v1': v1,
    'v2': [v2],
}
out = {}
for name, command in runs.items():
    folder = os.path.join(work, name)
    os.makedirs(folder)
    ran = subprocess.run([*command, 'hash', county, '--output-zip', os.path.join(folder, 'hashed'), '--output-csv', os.path.join(folder, 'hash.csv'), '--output-car', os.path.join(folder, 'county.car')],
                         capture_output=True, env=env, cwd=folder, timeout=900)
    rows = sorted(','.join(line.split(',')[:4]) for line in open(os.path.join(folder, 'hash.csv')).read().splitlines()[1:]) if os.path.exists(os.path.join(folder, 'hash.csv')) else []
    car = open(os.path.join(folder, 'county.car'), 'rb').read() if os.path.exists(os.path.join(folder, 'county.car')) else b''
    out[name] = (ran.returncode, rows, car, (ran.stdout[-300:] + ran.stderr[-600:]).decode(errors='replace'))
    print(name, 'exit', ran.returncode, 'rows', len(rows), 'car bytes', len(car))

same_rows = out['v1'][1] == out['v2'][1]
print('hash.csv rows identical:', same_rows, '| CAR identical:', out['v1'][2] == out['v2'][2])
if not same_rows:
    a, b = set(out['v1'][1]), set(out['v2'][1])
    print('only v1:', sorted(a - b)[:4])
    print('only v2:', sorted(b - a)[:4])
    for name in runs:
        print(name, 'said:', out[name][3][-500:])
print('work dir:', work)
