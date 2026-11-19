#!/usr/bin/env bash
# Run every county's five scripts through elephant-cli 1.x (Node) and 2.x (the
# embedded engine) on the same prepared ZIP and compare the outcomes: exit
# codes, and the output ZIPs file by file.
#
# Usage: ELEPHANT_CLI_V1='node /path/to/1.x/bin/elephant-cli' \
#          county-scripts.sh <Counties-trasform-scripts checkout> <prepared.zip> <out-dir> [county ...]
# Prints one line per county: <county>|v1=<exit>|v2=<exit>|identical(<files>) or DIFFERENT(<lines>).
# `county-failures.py <that output> <out-dir>` then compares how the failing ones failed.
set -u
: "${ELEPHANT_CLI_V1:?set ELEPHANT_CLI_V1 to the command that runs elephant-cli 1.x}"
read -r -a v1 <<< "$ELEPHANT_CLI_V1"
v2="${ELEPHANT_CLI_V2:-$(cd "$(dirname "$0")/../.." && pwd)/target/debug/elephant-cli}"
repo="$(realpath "$1")"
prepared="$(realpath "$2")"
out="$3"
shift 3
mkdir -p "$out"
out="$(realpath "$out")"
cd "$repo"
if [ "$#" -gt 0 ]; then counties=("$@"); else mapfile -t counties < <(find . -mindepth 2 -maxdepth 2 -type d -name scripts | sed 's|^\./||; s|/scripts$||' | sort); fi
for county in "${counties[@]}"; do
  slug="${county// /_}"
  work="$out/$slug"
  rm -rf "$work" && mkdir -p "$work/scripts"
  for name in ownerMapping structureMapping layoutMapping utilityMapping data_extractor; do
    [ -f "$county/scripts/$name.js" ] && cp "$county/scripts/$name.js" "$work/scripts/"
  done
  # helper files some counties require next to the five
  find "$county/scripts" -maxdepth 1 -type f \( -name '*.js' -o -name '*.json' \) ! -name '*.test.js' ! -name 'test_*' ! -name 'package*.json' -exec cp --update=none {} "$work/scripts/" \;
  (cd "$work/scripts" && python3 -m zipfile -c ../scripts.zip ./* > /dev/null)
  (cd "$work" && ELEPHANT_SKIP_UPDATE_CHECK=1 timeout 180 "${v1[@]}" transform --input-zip "$prepared" --scripts-zip scripts.zip --output-zip v1.zip > v1.log 2>&1; echo $? > v1.code)
  (cd "$work" && TZ="${TZ:-UTC}" timeout 180 "$v2" transform --input-zip "$prepared" --scripts-zip scripts.zip --output-zip v2.zip > v2.log 2>&1; echo $? > v2.code)
  same="-"
  if [ -f "$work/v1.zip" ] && [ -f "$work/v2.zip" ]; then
    mkdir -p "$work/a" "$work/b"
    python3 -m zipfile -e "$work/v1.zip" "$work/a" > /dev/null
    python3 -m zipfile -e "$work/v2.zip" "$work/b" > /dev/null
    if diff -r "$work/a" "$work/b" > "$work/diff.txt"; then same="identical($(find "$work/b" -type f | wc -l))"; else same="DIFFERENT($(grep -c . "$work/diff.txt"))"; fi
    rm -rf "$work/a" "$work/b"
  fi
  printf '%s|v1=%s|v2=%s|%s\n' "$county" "$(cat "$work/v1.code")" "$(cat "$work/v2.code")" "$same"
done
