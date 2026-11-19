#!/usr/bin/env bash
# Writes <case>.json for every <case>.js here by running it on Node, the
# engine county scripts were written for. The tests then hold the embedded
# engine to those answers. Run it as `tests/fixtures/transform/engine/golden.sh`.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
for script in "$here"/*.js; do
  # a directory of its own: outside this package, where .js files are CommonJS as county scripts are
  work="$(mktemp -d)"
  cp "$script" "$work/data_extractor.js"
  (cd "$work" && TZ=UTC node data_extractor.js)
  cp "$work/data/probe.json" "${script%.js}.json"
  rm -rf "$work"
done
