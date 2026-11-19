#!/bin/sh
# Rebuild assets/cheerio.js: cheerio's browser build as one CommonJS file,
# which `transform` gives county scripts as `require('cheerio')`.
# Needs Node and network access; run it only to change the cheerio version.
set -eu
version="${1:-1.1.2}"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
cd "$work"
npm init -y >/dev/null
npm install --no-audit --no-fund "cheerio@$version" esbuild@0.21.5 >/dev/null
echo "module.exports = require('cheerio');" > entry.cjs
npx esbuild entry.cjs --bundle --platform=browser --format=cjs --target=es2020 --minify --legal-comments=none --outfile=cheerio.js
cp cheerio.js "$OLDPWD/assets/cheerio.js"
echo "assets/cheerio.js rebuilt from cheerio@$version"
