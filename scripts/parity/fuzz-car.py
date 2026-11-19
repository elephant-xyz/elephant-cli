"""Corrupt a valid county CAR in many ways and hold `elephant-cli validate` to its contract:
it ends in time, with exit code 0, 1 or 2, and never passes a file whose bytes changed
inside a block.

Usage: fuzz-car.py <binary> <car> <schema-cache> <rounds> [seed]
"""
import os
import random
import subprocess
import sys
import tempfile
import time

binary, source, cache, rounds = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4])
random.seed(int(sys.argv[5]) if len(sys.argv) > 5 else 1)
good = open(source, 'rb').read()
work = tempfile.mkdtemp(prefix='fuzz-car-')
env = dict(os.environ, ELEPHANT_OFFLINE='1', ELEPHANT_SCHEMA_CACHE_DIR=cache)


def varint(value):
    out = bytearray()
    while True:
        byte = value & 0x7F
        value >>= 7
        out.append(byte | (0x80 if value else 0))
        if not value:
            return bytes(out)


def mutate(data):
    data = bytearray(data)
    kind = random.choice(['flip', 'flip', 'flip', 'truncate', 'insert', 'delete', 'dup', 'zero', 'huge', 'head', 'swap', 'ff'])
    at = random.randrange(len(data))
    if kind == 'flip':
        for _ in range(random.choice([1, 1, 1, 2, 8])):
            data[random.randrange(len(data))] ^= 1 << random.randrange(8)
    elif kind == 'truncate':
        del data[at:]
    elif kind == 'insert':
        data[at:at] = os.urandom(random.choice([1, 2, 8, 64]))
    elif kind == 'delete':
        del data[at:at + random.choice([1, 2, 8, 64])]
    elif kind == 'dup':
        size = random.choice([16, 64, 256])
        data[at:at] = data[at:at + size]
    elif kind == 'zero':
        size = random.choice([1, 4, 32])
        data[at:at + size] = bytes(size)
    elif kind == 'huge':
        # a length prefix claiming far more than the file holds
        data[at:at] = varint(random.choice([2**31, 2**40, 2**63 - 1, 2**64 - 1]))
    elif kind == 'head':
        data[random.randrange(min(64, len(data)))] = random.randrange(256)
    elif kind == 'swap':
        size = random.choice([8, 64])
        other = random.randrange(len(data))
        data[at:at + size], data[other:other + size] = data[other:other + size], data[at:at + size]
    elif kind == 'ff':
        size = random.choice([1, 9, 10, 11])
        data[at:at + size] = b'\xff' * size
    return kind, bytes(data)


codes = {}
slowest = 0.0
problems = []
passed_changed = 0
for number in range(rounds):
    kind, data = mutate(good)
    path = os.path.join(work, 'case.car')
    open(path, 'wb').write(data)
    began = time.time()
    try:
        ran = subprocess.run([binary, 'validate', path, '--output-csv', os.path.join(work, 'errors.csv')], capture_output=True, env=env, timeout=20, cwd=work)
        code = ran.returncode
    except subprocess.TimeoutExpired:
        code = 'timeout'
    took = time.time() - began
    slowest = max(slowest, took)
    codes[code] = codes.get(code, 0) + 1
    if code not in (0, 1, 2):
        keep = os.path.join(work, f'problem-{number}-{kind}.car')
        open(keep, 'wb').write(data)
        tail = b'' if code == 'timeout' else ran.stderr[-400:]
        problems.append((number, kind, code, keep, tail.decode(errors='replace')))
    if code == 0 and data != good:
        passed_changed += 1
        keep = os.path.join(work, f'passed-{number}-{kind}.car')
        open(keep, 'wb').write(data)
        problems.append((number, kind, 'PASSED A CHANGED FILE', keep, ran.stdout[-300:].decode(errors='replace')))

print('exit codes:', codes, '| slowest %.2fs' % slowest, '| changed files passed:', passed_changed)
for problem in problems[:12]:
    print(problem)
print('work dir:', work)
