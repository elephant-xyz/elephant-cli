"""Validate the same damaged properties with elephant-cli 1.x and 2.x and compare the findings.

Each property is a copy of a valid one with one schema-relevant change: a value
of the wrong type, a missing field, an extra field, an enum or format violation,
a broken link. Findings are compared as (property, file, error_path, error_message).

Usage: ELEPHANT_CLI_V1='node /path/to/1.x/bin/elephant-cli' validate-diff.py <v2-binary> <property-dir> <schema-cache> <count> [seed]
"""
import csv
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
work = tempfile.mkdtemp(prefix='validate-diff-')
county = os.path.join(work, 'county')
os.makedirs(county)
names = sorted(name for name in os.listdir(source) if name.endswith('.json'))

VALUES = [None, True, False, 0, -1, 1.5, 10**12, '', ' ', 'x', 'not-a-date', '2020-13-45', '2020-01-05', '2020-01-05T10:00:00Z', 'http://example.com', 'https://example.com/a?b=c', 'not a url',
          'ipfs://x', 'A', 'a' * 300, '12345', '12345-6789', 'FL', 'fl', 'Florida', 'GET', 'POST', 'get', [], [1], ['x'], {}, {'a': 1}, {'/': './missing.json'}, {'/': 'bafkreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7aqa4s52zy'},
          '1', '1.5', 'true', 'null', 1e21, -0.0, 0.1, 2**31, 'RESIDENTIAL', 'Unknown', 'N/A', '00000', 'abc@example.com', '+1 555 0100', '2020', '01/05/2020', 'T10:00:00']


def spots(value, found, holder=None, key=None):
    if holder is not None:
        found.append((holder, key))
    if isinstance(value, dict):
        for name in list(value):
            spots(value[name], found, value, name)
    elif isinstance(value, list):
        for index in range(len(value)):
            spots(value[index], found, value, index)


def damage(directory):
    name = random.choice(names)
    path = os.path.join(directory, name)
    data = json.load(open(path))
    found = []
    spots(data, found)
    kind = random.choice(['value', 'value', 'value', 'drop', 'add', 'retype'])
    if kind == 'add' or not found:
        target = data if isinstance(data, dict) else None
        if target is not None:
            target[random.choice(['extra_field', 'x', 'request_identifier', 'label', 'relationships', 'source_http_request'])] = random.choice(VALUES)
    else:
        holder, key = random.choice(found)
        if kind == 'drop':
            del holder[key]
        elif kind == 'retype':
            old = holder[key]
            holder[key] = str(old) if isinstance(old, (int, float)) and not isinstance(old, bool) else [old] if not isinstance(old, list) else None
        else:
            holder[key] = random.choice(VALUES)
    json.dump(data, open(path, 'w'))
    return f'{kind}:{name}'


what = {}
for index in range(count):
    target = os.path.join(county, f'property-{index:04d}')
    shutil.copytree(source, target)
    what[f'property-{index:04d}'] = damage(target)

env = dict(os.environ, ELEPHANT_SKIP_UPDATE_CHECK='1', ELEPHANT_OFFLINE='1', ELEPHANT_SCHEMA_CACHE_DIR=cache)
found = {}
for name, command in {'v1': v1, 'v2': [v2]}.items():
    folder = os.path.join(work, name)
    os.makedirs(folder)
    ran = subprocess.run([*command, 'validate', county, '--output-csv', os.path.join(folder, 'errors.csv')], capture_output=True, env=env, cwd=folder, timeout=1200)
    rows = set()
    if os.path.exists(os.path.join(folder, 'errors.csv')):
        for row in csv.DictReader(open(os.path.join(folder, 'errors.csv'))):
            file = row.get('file_path') or ''
            if row.get('error_message') is None:
                print(name, 'wrote a row with too few columns:', dict(row))
                continue
            marker = file.find('/county/')
            relative = file[marker + 8:] if marker >= 0 else file
            rows.add((relative, row['error_path'], row['error_message']))
    found[name] = rows
    print(name, 'exit', ran.returncode, 'rows', len(rows), (ran.stdout[-120:]).decode(errors='replace').strip().replace('\n', ' | '))

a, b = found['v1'], found['v2']
print('same rows:', len(a & b), '| only v1:', len(a - b), '| only v2:', len(b - a))
by_property = {}
for row in sorted(a ^ b):
    by_property.setdefault(row[0].split('/')[0], []).append(('v1' if row in a else 'v2', row))
print('properties with a difference:', len(by_property), 'of', count)
shown = 0
for name, rows in by_property.items():
    if shown >= int(os.environ.get('SHOW', '12')):
        break
    shown += 1
    print(f'-- {name} ({what[name]})')
    for side, row in rows[:6]:
        print(f'   {side}: {row[0].split("/", 1)[-1]} | {row[1]} | {row[2][:170]}')
print('work dir:', work)
