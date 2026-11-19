"""For counties whose scripts fail under both elephant-cli 1.x and 2.x: do they fail in the same script, at the same line?

Prints the counties that do not, then how many do.

Usage: county-failures.py <output of county-scripts.sh> <out-dir>
"""
import pathlib
import re
import sys

sweep, out = sys.argv[1], pathlib.Path(sys.argv[2])
same = 0
for row in open(sweep):
    county, v1, v2, _ = row.strip().split('|')
    if v1 == 'v1=0' or v2 == 'v2=0':
        continue
    work = out / county.replace(' ', '_')
    a = (work / 'v1.log').read_text(errors='replace')
    b = (work / 'v2.log').read_text(errors='replace')
    script = lambda text: (re.search(r'Script failed \(script=(\S+) code=(\d+)', text) or [None, '?', '?'])
    sa, sb = script(a), script(b)
    # the first place inside the county's own script that each stack names
    place = lambda text: (re.search(r'scripts/(\w+\.js):(\d+)', text) or [None, '?', '?'])
    pa, pb = place(a), place(b)
    # the error's own message, without engine-specific wording
    message = lambda text: next((line.strip() for line in text.splitlines() if re.match(r'\s*(\w*Error|Uncaught)\b.*:', line.strip()) and 'Script failed' not in line and 'Transform failed' not in line), '?')
    ma, mb = message(a), message(b)
    # a thrown value that is not an Error has no stack in one engine or the other; a line can be off by one for a call spread over lines
    known = pa[2] != '?' and pb[2] != '?'
    agree = sa[1] == sb[1] and (not known or (pa[1] == pb[1] and abs(int(pa[2]) - int(pb[2])) <= 1))
    same += agree
    if not agree:
        print(f'{county}:\n  v1 {sa[1]} code {sa[2]} at {pa[1]}:{pa[2]}  {ma[:150]}\n  v2 {sb[1]} code {sb[2]} at {pb[1]}:{pb[2]}  {mb[:150]}')
print(f'{same} counties fail in the same script, at the same line where both engines name one')
