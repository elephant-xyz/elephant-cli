"""Damage the JSON files of a valid property in many ways and hold `validate`, `hash`
and `export-tables` to their contract: they end in time with exit code 0, 1 or 2.

Usage: fuzz-property.py <binary> <property-dir> <schema-cache> <rounds> [seed]
"""
import json
import os
import random
import shutil
import subprocess
import sys
import tempfile
import time

binary, source, cache, rounds = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4])
random.seed(int(sys.argv[5]) if len(sys.argv) > 5 else 1)
work = tempfile.mkdtemp(prefix='fuzz-property-')
env = dict(os.environ, ELEPHANT_OFFLINE='1', ELEPHANT_SCHEMA_CACHE_DIR=cache)
names = sorted(name for name in os.listdir(source) if name.endswith('.json'))

ODD = [None, True, 0, -1, 1e308, -1e308, 1.5e-320, 2**53 + 1, 2**64, 10**40, '', ' ', '\u0000', '\ud83d', 'é' * 5, '../x.json', './', '/', {'/': './missing.json'},
       {'/': '../../etc/passwd'}, {'/': 'bafkreiaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'}, {'/': 5}, {'/': None}, {'/': ''}, {'/': '.'}, {'/': './'}, [], {}, [[]], {'': 1}, {'__proto__': 1}]


def walk(value, visit):
    """Every (container, key) pair inside a JSON value."""
    if isinstance(value, dict):
        for key in list(value):
            visit(value, key)
            walk(value[key], visit)
    elif isinstance(value, list):
        for index in range(len(value)):
            visit(value, index)
            walk(value[index], visit)


def mutate(directory):
    name = random.choice(names)
    path = os.path.join(directory, name)
    raw = open(path, 'rb').read()
    kind = random.choice(['value', 'value', 'value', 'key', 'drop', 'bytes', 'truncate', 'deep', 'self', 'empty', 'bom', 'dupkey', 'notjson', 'rename', 'extra', 'bigfile', 'dirfile'])
    if kind in ('value', 'key', 'drop'):
        data = json.loads(raw)
        spots = []
        walk(data, lambda holder, key: spots.append((holder, key)))
        if spots:
            holder, key = random.choice(spots)
            if kind == 'value':
                holder[key] = random.choice(ODD)
            elif kind == 'drop':
                del holder[key]
            elif isinstance(holder, dict):
                holder[random.choice(['', 'x' * 300, '\u0000', '/', 'é', '__proto__', 'constructor'])] = holder.pop(key)
        open(path, 'w').write(json.dumps(data))
    elif kind == 'bytes':
        data = bytearray(raw)
        for _ in range(random.choice([1, 2, 8])):
            data[random.randrange(len(data))] = random.randrange(256)
        open(path, 'wb').write(bytes(data))
    elif kind == 'truncate':
        open(path, 'wb').write(raw[:random.randrange(len(raw))])
    elif kind == 'deep':
        depth = random.choice([200, 5000, 100000])
        open(path, 'w').write('[' * depth + ']' * depth if random.random() < 0.5 else '{"a":' * depth + '1' + '}' * depth)
    elif kind == 'self':
        # a file that links to itself, or two that link to each other
        other = random.choice(names)
        open(path, 'w').write(json.dumps({'label': 'x', 'relationships': {'a': {'/': './' + name}, 'b': [{'/': './' + other}]}}))
        if random.random() < 0.5:
            open(os.path.join(directory, other), 'w').write(json.dumps({'from': {'/': './' + name}, 'to': {'/': './' + other}}))
    elif kind == 'empty':
        open(path, 'wb').write(random.choice([b'', b' ', b'null', b'[]', b'{}', b'""', b'0']))
    elif kind == 'bom':
        open(path, 'wb').write(b'\xef\xbb\xbf' + raw)
    elif kind == 'dupkey':
        open(path, 'w').write('{"label":"a","label":"b","relationships":{},"relationships":[]}')
    elif kind == 'notjson':
        open(path, 'wb').write(os.urandom(random.choice([1, 64, 4096])))
    elif kind == 'rename':
        os.rename(path, os.path.join(directory, random.choice(['x.json', 'X.JSON', name.upper(), '.hidden.json', 'a b.json', 'é.json'])))
    elif kind == 'extra':
        os.makedirs(os.path.join(directory, 'sub', 'deeper'), exist_ok=True)
        open(os.path.join(directory, 'sub', 'deeper', 'x.json'), 'w').write('{"a": 1}')
        open(os.path.join(directory, 'photo.png'), 'wb').write(os.urandom(100))
    elif kind == 'bigfile':
        open(path, 'w').write(json.dumps({'label': 'x', 'relationships': {'a': [{'/': './' + random.choice(names)}] * 20000}}))
    elif kind == 'dirfile':
        os.remove(path)
        os.makedirs(path)
    return f'{kind}:{name}'


codes = {}
slowest = (0.0, '')
problems = []
for number in range(rounds):
    directory = os.path.join(work, 'property')
    shutil.rmtree(directory, ignore_errors=True)
    shutil.copytree(source, directory)
    done = []
    for _ in range(random.choice([1, 1, 2])):
        try:
            done.append(mutate(directory))
        except (OSError, ValueError):
            pass  # the file this one aimed at was already renamed, removed or made unreadable
    what = ' + '.join(done)
    for command in (['validate', directory, '--output-csv', os.path.join(work, 'errors.csv')],
                    ['hash', directory, '--output-zip', os.path.join(work, 'hashed.zip'), '--output-csv', os.path.join(work, 'hash.csv'), '--output-car', os.path.join(work, 'out.car')]):
        began = time.time()
        try:
            ran = subprocess.run([binary, *command], capture_output=True, env=env, timeout=30, cwd=work)
            code = ran.returncode
        except subprocess.TimeoutExpired:
            code = 'timeout'
        took = time.time() - began
        if took > slowest[0]:
            slowest = (took, f'{command[0]} {what}')
        codes[(command[0], code)] = codes.get((command[0], code), 0) + 1
        if code not in (0, 1, 2):
            keep = os.path.join(work, f'problem-{number}-{command[0]}')
            shutil.copytree(directory, keep)
            tail = '' if code == 'timeout' else ran.stderr[-500:].decode(errors='replace')
            problems.append((number, command[0], what, code, keep, tail))

print('exit codes:', dict(sorted(codes.items(), key=str)), '| slowest %.2fs (%s)' % slowest)
for problem in problems[:10]:
    print(problem)
print('problems:', len(problems), 'work dir:', work)
