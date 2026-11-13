# Elephant CLI

`elephant-cli` prepares, transforms, validates, hashes, exports and uploads Elephant county data. Version 2 is a single native binary written in Rust.

## Table of Contents

- [Overview](#overview)
- [Installation](#installation)
- [Conventions](#conventions)
- [Workflow](#workflow)
- [Commands](#commands)
  - [prepare](#prepare)
  - [transform](#transform)
  - [validate](#validate)
  - [hash](#hash)
  - [export-tables](#export-tables)
  - [upload](#upload)
- [Publish a County](#publish-a-county)
- [Environment Variables](#environment-variables)
- [Migrating from 1.x](#migrating-from-1x)
- [Development](#development)

## Overview

A county dataset moves through six steps. Each step is one command; the output of one is the input of the next.

| Step | Command | Input | Output |
| --- | --- | --- | --- |
| 1 | [`prepare`](#prepare) | A seed ZIP naming the request for one parcel | The seed ZIP plus the fetched source content |
| 2 | [`transform`](#transform) | The prepared ZIP and county scripts or a handler package | A ZIP of lexicon data-group files |
| 3 | [`validate`](#validate) | Property outputs, or a county CAR | A CSV of findings |
| 4 | [`hash`](#hash) | A directory of property outputs | Hashed ZIPs, a CSV of CIDs and a county CAR |
| 5 | [`export-tables`](#export-tables) | A county CAR | Parquet tables, `tables.car` and an Atlas page entry |
| 6 | [`upload`](#upload) | A county CAR or a tables directory | The content on an IPFS node, verified |

## Installation

Choose one. Node is not needed.

**Download a binary.** Each release at <https://github.com/elephant-xyz/elephant-cli/releases> has one archive per platform, `elephant-cli-<target>.tar.gz`, and their sums in `SHA256SUMS`:

| Platform | `<target>` |
| --- | --- |
| Linux x86_64 | `x86_64-unknown-linux-gnu` |
| Linux arm64 | `aarch64-unknown-linux-gnu` |
| macOS Apple silicon | `aarch64-apple-darwin` |
| macOS Intel | `x86_64-apple-darwin` |

```bash
target=aarch64-apple-darwin
curl -fsSL "https://github.com/elephant-xyz/elephant-cli/releases/latest/download/elephant-cli-$target.tar.gz" | tar -xz
sudo mv elephant-cli /usr/local/bin/
elephant-cli --version
```

Every commit on `main` is published the same way as the pre-release `build-<commit>`, so the current `main`, or a pinned commit, installs without a release:

```bash
commit=$(git ls-remote https://github.com/elephant-xyz/elephant-cli main | cut -f1)
curl -fsSL "https://github.com/elephant-xyz/elephant-cli/releases/download/build-$commit/elephant-cli-$target.tar.gz" | tar -xz
```

**Build with cargo** (needs Rust 1.85 or newer, from <https://rustup.rs>):

```bash
cargo install --git https://github.com/elephant-xyz/elephant-cli --locked
```

The browser mechanisms of `prepare` also need the obscura headless browser. Download it from <https://github.com/h4ckf0r0day/obscura/releases> and put `obscura` on your `PATH`. Nothing else needs it.

## Conventions

Every command follows the same rules, so the CLI is easy to script and to drive from an agent.

- **stdout carries the result.** Without options it is a short text report. With `--json` it is exactly one JSON document.
- **stderr carries everything else**: warnings, per-item errors and the reason a command could not run.
- **Exit codes:** `0` success; `1` the input was checked and failed (validation findings, a property that could not be hashed); `2` the command could not run (bad arguments, unreadable input, network or browser failure).
- **Errors with `--json`:** when a command exits `2`, stdout holds `{"error": "<reason>"}`.
- **Nothing prompts** and nothing needs a terminal. There is no update check.
- **`--help` on every command** lists its options, modes and examples.

Global options, accepted before or after the command:

| Option | Description | Default |
| --- | --- | --- |
| `--json` | Print one JSON document describing the result on stdout instead of text. | Off |
| `--schema-cache <DIR>` | Directory holding the lexicon manifest and schemas, one `<cid>.json` per schema. Also `ELEPHANT_SCHEMA_CACHE_DIR`. | `~/.elephant-cli/schema-cache` |
| `--offline` | Fetch no schemas (one missing from the cache is an error) and keep `transform` scripts off the network. Also `ELEPHANT_OFFLINE=1`. | Off |

Examples of piping:

```bash
# Exit status alone
elephant-cli validate county.car --output-csv errors.csv && echo clean

# One field of the result
elephant-cli --json hash ./county-outputs --output-car county.car | jq -r .car.root

# The findings themselves on stdout (the report moves to stderr)
elephant-cli validate county.car --output-csv - | cut -d, -f4 | sort | uniq -c
```

The lexicon manifest and every schema fetched are kept in the schema cache, so a later run with `--offline` needs no network. Without `--offline` the manifest is fetched on every run, and a fetch that fails stops the command (exit `2`): a copy from an earlier run is never used unasked.

`--schema-cache` and `--offline` belong to the commands that read lexicon schemas: `transform`, `validate`, `hash` and `export-tables`. Given on the command line to `prepare` or `upload` they are refused; set through the environment they are ignored there.

## Workflow

```text
seed.zip ──prepare──▶ prepared.zip ──transform──▶ transformed.zip
                                                        │
              one ZIP or folder per property ◀──────────┘
                             │
                         validate ──▶ errors.csv
                             │
                           hash ──▶ county.car, hash.csv, hashed ZIPs
                             │
                         validate county.car ──▶ car-errors.csv
                             │
                      export-tables ──▶ tables/, tables.car, Atlas page
                             │
                          upload ──▶ IPFS node, read back through a gateway
```

## Commands

### prepare

**Purpose:** fetch the source content for one parcel and add it to its seed ZIP.

**Required inputs**

- A seed ZIP holding `parcel.json` or `property_seed.json` (with `source_http_request` and `request_identifier`) and `address.json` or `unnormalized_address.json`. [`transform`](#transform) in seed mode writes these files.
- Or `--input-csv`: a CSV with a `request_identifier` column, together with `--multi-request-flow-file`.
- `--output-zip`.

**Mechanisms.** The first one that applies answers the seed's request:

| Order | Applies when | What it does | File written |
| --- | --- | --- | --- |
| 1 | `--browser-flow-zip` | Runs a Browser Flow v2 package: its `handler.js` drives the page and saves named captures. | `captures/<name>.html`, `captures.json` |
| 2 | `--multi-request-flow-file` | Sends every request of the flow and gathers the answers under their keys. | `<request_identifier>.json` |
| 3 | The seed's `county_name` or `county_jurisdiction` is `Orange` | Walks the Orange County, FL property appraiser API. | `<request_identifier>.json` |
| 4 | `--browser-flow-file` | Runs a browser flow, a small state machine written as JSON, and captures the page it ends on. | `<request_identifier>.html` |
| 5 | `--use-browser` and the request is a GET | Loads the page in the browser. | `<request_identifier>.html` |
| 6 | Otherwise | Sends the request as one HTTP request. | `<request_identifier>.html` or `.json` |

Mechanisms 1, 4 and 5 use the obscura browser. `prepare` starts `obscura serve` itself and stops it when done.

**Outputs**

- The output ZIP: every file of the seed ZIP plus the file or files in the table above.
- After a browser flow (mechanism 4) the seed files point at the page the flow ended on: `source_http_request` becomes that page's URL and the original request moves to `entry_http_request`.
- Captured HTML from mechanisms 1 and 4 is cleaned: scripts, styles and inline styles are removed. Mechanisms 5 and 6 keep the content as received.

**Options**

| Option | Description | Default |
| --- | --- | --- |
| `[INPUT_ZIP]` | The seed ZIP. | None |
| `--output-zip <PATH>` | ZIP to write. Required. | None |
| `--input-csv <PATH>` | A CSV with a `request_identifier` column; one output file per row, answered by the multi-request flow. | None |
| `--multi-request-flow-file <PATH>` | A multi-request flow (JSON). | None |
| `--browser-flow-file <PATH>` | A browser flow (JSON). | None |
| `--browser-flow-zip <PATH>` | A Browser Flow v2 package. | None |
| `--browser-flow-version <VERSION>` | Accepted for compatibility: `2`, with `--browser-flow-zip`. | None |
| `--use-browser` | Load the page in the browser. | Off |
| `--no-continue` | With `--use-browser`: do not click the "Continue" notice some county sites show first. | Clicks it |
| `--continue-button <SELECTOR>` | With `--use-browser`: click this element once the page has loaded. | None |
| `--ignore-captcha` | With `--use-browser`: do not wait for a reCAPTCHA redirect or treat the word as an error page. | Off |
| `--proxy <URL>` | Proxy for the browser, `http://user:password@host:port`. | None |
| `--browser <PATH>` | The obscura binary to start. Also `OBSCURA_BIN`. | `obscura` on `PATH` |
| `--cdp-url <WS_URL>` | Attach to a running browser's DevTools WebSocket instead of starting obscura. Also `ELEPHANT_CDP_URL`. | None |

**Multi-request flow.** A JSON file listing requests. `{{=it.request_identifier}}` in any string is replaced by the parcel's identifier (in a browser flow, `{{=it.<name>}}` names any stored value). Nothing else of the doT template language is filled; another `{{=...}}` expression is an error:

```json
{
  "requests": [
    {
      "key": "Sales",
      "request": {
        "method": "GET",
        "url": "https://county.example.com/api/sales",
        "multiValueQueryString": { "parid": ["{{=it.request_identifier}}"] }
      }
    }
  ]
}
```

**Browser flow.** A JSON state machine. Step types: `open_page`, `wait_for_selector`, `wait_for_selector_race`, `click`, `type`, `keyboard_press`. Strings directly under `input` may use `{{=it.request_identifier}}`, `{{=it.url}}` and the `result` of earlier wait steps:

```json
{
  "starts_at": "open",
  "states": {
    "open": { "type": "open_page", "input": { "url": "{{=it.url}}" }, "next": "fill" },
    "fill": { "type": "type", "input": { "selector": "#parcel", "value": "{{=it.request_identifier}}" }, "next": "submit" },
    "submit": { "type": "keyboard_press", "input": { "key": "Enter" }, "next": "result" },
    "result": { "type": "wait_for_selector", "input": { "selector": "#details", "timeout": 30000 }, "end": true }
  }
}
```

**Browser Flow v2 package.** A ZIP with `handler.js` at its root. The handler receives `page`, `input`, `saveHtml({ name, html? })`, `saveSourceUrl(url)` and `logger`. `page` offers the part of Puppeteer's `Page` that flows use: `goto`, `url`, `content`, `evaluate`, `waitForSelector`, `waitForFunction`, `waitForNavigation`, `click`, `type`, `select`, `$`, `$$`, `$eval`, `$$eval`, `keyboard.press` and `keyboard.type`.

```js
export async function handler({ page, input, saveHtml, saveSourceUrl }) {
  await page.goto(input.url, { waitUntil: 'domcontentloaded' });
  await page.type('#parcel', input.request_identifier);
  await Promise.all([page.waitForNavigation(), page.keyboard.press('Enter')]);
  await page.waitForSelector('#details');
  await saveSourceUrl(page.url());
  await saveHtml({ name: 'property-detail' });
}
```

**Examples**

```bash
# One HTTP request
elephant-cli prepare seed.zip --output-zip prepared.zip

# A Browser Flow v2 package
elephant-cli prepare seed.zip --output-zip prepared.zip --browser-flow-zip flow.zip

# Many parcels through a multi-request flow
elephant-cli prepare --input-csv parcels.csv --multi-request-flow-file flow.json --output-zip prepared.zip
```

obscura refuses loopback and private addresses unless `OBSCURA_ALLOW_PRIVATE_NETWORK=1` is set; set it to prepare against a local test server.

### transform

**Purpose:** turn what `prepare` captured for one parcel into lexicon data-group files.

**Required inputs**

- `--input-zip`: the prepared ZIP, or for seed mode a ZIP holding `seed.csv`.
- For scripts mode, `--scripts-zip`; for handler mode, `--transform-zip`.

**Modes.** The options given choose the mode:

| Mode | Options | What happens |
| --- | --- | --- |
| Seed | `--input-zip` only | The first row of `seed.csv` becomes `address.json`, `parcel.json`, `unnormalized_address.json`, `property_seed.json` and the Seed data-group root. |
| Scripts | `--scripts-zip` | `ownerMapping.js`, `structureMapping.js`, `layoutMapping.js`, `utilityMapping.js` and then `data_extractor.js` run with `input.html` (or `input.json`) and the seed files in their working directory, and write `data/*.json`. The CLI then stamps `source_http_request` and `request_identifier` on each entity, links entities to `property.json`, and writes the County and Seed data-group roots. |
| Handler | `--transform-zip` | The package's `handler.js` reads captures with `readCapture(name)` and writes through `writeJson(name, value)` and `writeRelationship({ type, name, from, to })`. The CLI builds the data-group root from the relationships written. |

**Where the JavaScript runs.** County scripts and handlers run on an embedded JavaScript engine (QuickJS), not on Node. What they get:

It offers the part of Node the published county scripts use, and no more. A script that reaches for anything else fails with the name of what is missing.

- Modules: `fs` (the sync functions for reading, writing, listing and removing, and `fs/promises` with `readFile`, `writeFile`, `readdir`, `unlink`), `path`, `vm` (`runInNewContext`), `crypto` (`createHash('sha256')`), `http` and `https` (`get`), and `cheerio`. CommonJS `require` and ES module `import` both work.
- Globals: `process` (`argv`, `env`, `cwd`, `exit`, `stdout`, `stderr`), `console`, `Buffer` (UTF-8 and hex), `setTimeout`, `clearTimeout`, and `URL` to read a URL's parts and `searchParams` (assigning to a part has no effect).
- `toLocaleString` on numbers and `localeCompare` give the answers Node gives for `en-US`. There is no `Intl` object, and the `toLocale...` methods of dates throw: build a date's text from its parts.
- Files: only the working directory, which holds the scripts, the seed files and `input.html` or `input.json`.
- Network: `http.get` and `https.get` only, and nothing with `--offline`.
- Time: 120 seconds per script; `config.timeoutMs` for a handler.

Other npm packages are not available. `tests/fixtures/transform/engine` holds the scripts that check these behaviours against Node.

**Outputs**

- The output ZIP with a `data/` directory: entity files, relationship files, and one `<schema CID>.json` root per data group.
- In scripts mode the Seed root and `address_has_parcel.json` are written when `data/address.json` and `data/parcel.json` exist.

**Options**

| Option | Description | Default |
| --- | --- | --- |
| `--input-zip <PATH>` | The prepared ZIP. Required. | None |
| `--output-zip <PATH>` | ZIP to write. | `transformed-data.zip` |
| `--scripts-zip <PATH>` | ZIP of the five county scripts. | None |
| `--transform-zip <PATH>` | Transform v2 handler package. | None |
| `--transform-version <VERSION>` | Accepted for compatibility: `2`, with `--transform-zip`. | None |
| `--data-group <LABEL>` | Label of the data group a handler package builds; refused without `--transform-zip`. | `County` |

**Examples**

```bash
# Seed records from a seed.csv
elephant-cli transform --input-zip seed.zip --output-zip seed-records.zip

# County scripts
elephant-cli transform --input-zip prepared.zip --scripts-zip scripts.zip --output-zip transformed.zip

# A handler package
elephant-cli transform --input-zip prepared.zip --transform-zip handler.zip --output-zip transformed.zip
```

When a script fails, the reason on stderr names the script, its exit code, and the last lines it printed.

### validate

**Purpose:** check property outputs, or a county CAR, against the lexicon.

**Required inputs**

- One property ZIP or directory; or a directory whose children are property ZIPs and directories, one property each (children starting with `.` or `__` are skipped, and two children with the same name stop the run); or a county CAR (any input ending in `.car`).

**What is checked for a property**

- Every data-group root (a JSON file holding exactly `label` and `relationships`) validates against the schema the lexicon manifest gives its label, following `{"/": "./file.json"}` links to relationship and entity files.
- Every JSON file is reached by a data group. A file that is not is reported as unused.

**What is checked for a county CAR**

- **integrity:** every block's bytes hash to its CID.
- **root:** exactly one root, a `CountyIndex` version 1 with a numeric `properties` count and a `shards` array of links.
- **index:** every shard decodes, the entries add up to `properties`, and every `property_cid` and `data_groups` link is in the file.
- **graph:** every link below the root is in the file.
- **lexicon:** every data-group root listed in a shard validates against the schema it is keyed by, with links resolved from the CAR.
- **orphans:** every block is reachable from the root.

The CAR is read start to end twice and never indexed as a whole. Both the layout `hash --output-car` writes (a shard's blocks right before the shard block) and a gateway export (`?format=car`: a shard's blocks right after it) are checked this way. A CAR laid out some other way gets the same findings, but the whole file is indexed in memory and the report says how many blocks were looked up by CID.

**Outputs**

- `--output-csv`: one row per finding, with the columns `property_cid,data_group_cid,file_path,error_path,error_message,currentValue,timestamp`. For a CAR, `file_path` holds the block CID and `error_path` the check name, or the JSON path for a schema error.
- stdout: the report. For a directory of properties it is `Properties processed: <n>, succeeded: <n>, failed: <n>`. For a CAR it lists blocks, properties, data groups validated and errors per check.
- Exit code `1` when anything was found.

**Options**

| Option | Description | Default |
| --- | --- | --- |
| `<INPUT>` | The property, the directory of properties, or the county CAR. | None |
| `-o, --output-csv <PATH>` | CSV file for the findings; `-` writes them to stdout. | `submit_errors.csv` |

**Examples**

```bash
elephant-cli validate ./property-dir
elephant-cli validate ./county-outputs --output-csv county-errors.csv
elephant-cli validate county.car --output-csv car-errors.csv
elephant-cli --json validate county.car | jq .errors
```

### hash

**Purpose:** give every JSON file a data group reaches its canonical bytes and CID, and pack the result.

**Required inputs**

- One property ZIP or directory, or a directory of properties (the same rules as [`validate`](#validate)). Each property needs a Seed data group: its CID is the property CID.

**What happens**

- Links `{"/": "./file.json"}` are replaced by `{"/": "<cid>"}`, deepest first. A link to an image becomes the raw CID of its bytes; an `ipfs_url` naming an image becomes `ipfs://<cid>`. A link to anything else fails the data group.
- JSON is canonicalised (RFC 8785, with arrays of links sorted) and given a CIDv1: dag-json, sha2-256.
- Bytes and CIDs are identical to those of elephant-cli 1.x.

**Outputs**

- `--output-zip`: for one property, a ZIP with `<property CID>/<cid>.json` for every block and the property's images. For a directory of properties, a directory that receives one such ZIP per property.
- `--output-csv`: `propertyCid,dataGroupCid,dataCid,filePath,uploadedAt`, one row per data group.
- `--output-car`: the county CAR. Each property's blocks, a shard block after every 5000 properties, and the `CountyIndex` last, as the root.
- stdout: `CAR written: <path> (<n> blocks, root <cid>)`, and for a directory `Properties processed: <n>, succeeded: <n>, failed: <n>`.
- Exit code `1` when a data group or a property could not be hashed; each one is named on stderr and under `errors` in the `--json` document.

**Options**

| Option | Description | Default |
| --- | --- | --- |
| `<INPUT>` | The property or the directory of properties. | None |
| `-o, --output-zip <PATH>` | Hashed ZIP, or directory of hashed ZIPs. | `hashed-data.zip` |
| `-c, --output-csv <PATH>` | CSV of data-group CIDs. | `hash-results.csv` |
| `--output-car <PATH>` | County CAR to write. | Not written |

**Example**

```bash
elephant-cli hash ./county-outputs \
  --output-zip ./county-hashed --output-csv county-hash.csv --output-car county.car
```

### export-tables

**Purpose:** turn a validated county CAR into Parquet tables, and write its Atlas page entry.

**Required inputs**

- A county CAR written by `hash --output-car`.
- `--output`.
- For a new Atlas page: `--atlas-page` with `--county`, `--state` and `--fips`.

**Outputs**

- `<output>/<table>/part-NNNNN.parquet`: one table per lexicon class, one per relationship type, and `properties` from the index. Which table a block belongs to comes from the schemas, never from a file name. Parts are zstd-compressed and split at `--part-size`.
- `<output>/tables.car`: one dag-json block, the `CountyTables` document, recording every part by CID, rows and bytes. Part CIDs are UnixFS CIDs as `ipfs add --cid-version 1 --raw-leaves` computes them.
- `--output-json`: the summary (`output`, `car`, `root`, `countyRoot`, `partSizeBytes`, `codec`, `tables`, `parts`, `exportedAt`, `atlas`), under the names 1.x gave them.
- `--json`: the same values under snake_case names (`county_root`, `part_size_bytes`, `exported_at`), with `command` and `input`, like every other command's document.
- `--atlas-page`: the county page, created or updated with `groups.<label> = { cid, schema, tables }`. Other groups and unknown keys are kept.
- stdout: `Tables written: <output> (<n> tables, <n> parts, root <cid>)` and `Atlas page written: <path> group <key>`.

**Options**

| Option | Description | Default |
| --- | --- | --- |
| `<INPUT>` | The county CAR. | None |
| `--output <DIR>` | Directory for the tables. Required. | None |
| `--part-size <BYTES>` | Largest part file, a byte count with an optional `k`, `m` or `g`. | `1g` |
| `--output-json <PATH>` | Also write the summary to this file. | Not written |
| `--atlas-page <PATH>` | Create or update the Atlas county page. | Not written |
| `--county <KEY>` | County key for a new Atlas page. | From the page |
| `--state <ST>` | Two-letter state code for a new Atlas page. | From the page |
| `--fips <CODE>` | Five-digit county FIPS code for a new Atlas page. | From the page |

**Example**

```bash
elephant-cli export-tables county.car --output ./county-tables \
  --output-json county-tables.json \
  --atlas-page ./atlas/counties/IL/rock-island.json --county rock-island --state IL --fips 17161
```

### upload

**Purpose:** send a county CAR or a tables directory to an IPFS node over the Kubo RPC API, and prove it arrived.

**Required inputs**

- A county CAR (`.car`), or a tables directory written by `export-tables` (one holding `tables.car`).
- A node: a local kubo daemon by default, or `--api` with a pinning provider such as `https://rpc.filebase.io`.

**What is verified**

- For a CAR: the node reports the root the archive declares, and the gateway serves the root block with bytes that hash to its CID.
- For a tables directory: every part has the size `tables.car` records before anything is sent; the node's CID for every part equals the recorded one; then `tables.car` is imported as above and the first part is read back.

**Outputs**

- stdout and `--output-json`: `api`, `root`, `blocks` (CAR) or `countyRoot` and `parts` (tables), `gatewayUrl`, `uploadedAt`, under the names 1.x gave them.
- `--json`: the same values under snake_case names (`county_root`, `gateway_url`, `uploaded_at`), with `command` and `input`.

**Options**

| Option | Description | Default |
| --- | --- | --- |
| `<INPUT>` | The CAR or the tables directory. | None |
| `--api <URL>` | Kubo RPC API of the node. Also `IPFS_API`. | `http://127.0.0.1:5001` |
| `--token <BEARER>` | Bearer token for the API. Also `IPFS_API_TOKEN`, or the three `FILEBASE_*` variables. | None |
| `--gateway <URL>` | Gateway to read back from. Also `ELEPHANT_CAR_GATEWAY`. | The node's, or Filebase's for its API |
| `--timeout <SECONDS>` | How long to wait for the gateway to serve what was uploaded. | `300` |
| `--output-json <PATH>` | Also write the summary to this file. | Not written |

**Examples**

```bash
elephant-cli upload county.car --output-json county-upload.json

export FILEBASE_ACCESS_KEY=... FILEBASE_SECRET_KEY=... FILEBASE_BUCKET=...
elephant-cli upload ./county-tables --api https://rpc.filebase.io --output-json tables-upload.json
```

## Publish a County

Once every property of a data group has been transformed, run this sequence once per data group:

```bash
county=lee; state=FL; fips=12071; group=county

elephant-cli validate ./$group-outputs --output-csv $county-$group-errors.csv

elephant-cli hash ./$group-outputs \
  --output-zip ./$county-$group-hashed \
  --output-csv $county-$group-hash.csv \
  --output-car $county-$group.car

elephant-cli validate $county-$group.car --output-csv $county-$group-car-errors.csv

elephant-cli export-tables $county-$group.car --output ./$county-$group-tables \
  --output-json $county-$group-tables-export.json \
  --atlas-page ./atlas/counties/$state/$county.json --county $county --state $state --fips $fips

elephant-cli upload $county-$group.car --output-json $county-$group-upload.json
elephant-cli upload ./$county-$group-tables --output-json $county-$group-tables-upload.json
```

Each command stops the sequence with a non-zero exit code when its step fails, so the block can run under `set -e`.

## Environment Variables

| Variable | Used by | Effect |
| --- | --- | --- |
| `ELEPHANT_SCHEMA_CACHE_DIR` | `transform`, `validate`, `hash`, `export-tables` | The schema cache directory (`--schema-cache`). |
| `ELEPHANT_OFFLINE` | `transform`, `validate`, `hash`, `export-tables` | `1` is `--offline`. |
| `ELEPHANT_SCHEMA_MANIFEST_URL` | `validate`, `hash`, `transform` | The lexicon manifest; a URL or a local file path. Default `https://lexicon.elephant.xyz/api/manifest`. |
| `ELEPHANT_IPFS_GATEWAYS` | `validate`, `transform`, `export-tables` | Comma-separated gateway origins for schema fetches; replaces the defaults. |
| `IPFS_API`, `IPFS_API_TOKEN`, `ELEPHANT_CAR_GATEWAY` | `upload` | The node, its token and the readback gateway. |
| `FILEBASE_ACCESS_KEY`, `FILEBASE_SECRET_KEY`, `FILEBASE_BUCKET` | `upload` | Together they make the Filebase token when none is given. |
| `OBSCURA_BIN`, `ELEPHANT_CDP_URL` | `prepare` | The obscura binary to start, or a running browser to attach to. |
| `OBSCURA_ALLOW_PRIVATE_NETWORK` | `prepare` | `1` lets obscura reach loopback and private addresses. |
| `ELEPHANT_ORANGE_API` | `prepare` | Base URL of the Orange County API, for testing. |

## Migrating from 1.x

The commands a county publication uses keep their names and options: `validate <input> --output-csv`, `hash <input> --output-zip --output-csv --output-car`, `export-tables` with its Atlas options, and `upload` with `--api`, `--token`, `--gateway`, `--timeout` and `--output-json` all work as before. `hash` produces the same bytes and CIDs.

What changed:

| Area | 1.x | 2.x |
| --- | --- | --- |
| Runtime | Node 22+ | A native binary; Node is not needed |
| Install | `npm i @elephant-xyz/cli`, or from git with npm | A binary from the releases page, or `cargo install`; there is no npm package |
| Library | `@elephant-xyz/cli/lib` | Gone; run the binary with `--json` |
| Removed commands | `validate-and-upload`, `submit-to-contract`, `check-transaction-status`, `check-gas-price`, `create-keystore`, `hex-to-cid`, `cid-to-hex`, `fetch-data`, `generate-transform` | Not available; use `@elephant-xyz/cli@1` from npm if you need one |
| Exit codes | `1` for every failure | `1` the input failed its checks, `2` the command could not run |
| Output | Banners and emoji on stdout, a log file in the working directory | A plain report on stdout, or one JSON document with `--json`; no log file |
| Update check | Exits `1` when a newer version is published | None |
| `.env` | Loaded from the working directory | Not loaded |
| Gateways | The global `--ipfs-gateway <url>` | `ELEPHANT_IPFS_GATEWAYS`, a comma-separated list |
| `validate` on properties | Writes `submit_warnings.csv`; a property that cannot be checked exits `1` silently | No warnings file; the reason is on stderr, exit `2` |
| `validate` on a CAR | Indexes the whole file | Two sequential reads; gateway exports stay on the fast path |
| `hash` | A data group that cannot be hashed is only written to `submit_errors.csv`, exit `0` | Named on stderr and in `--json`, exit `1`; `--property-cid` and `--max-concurrent-tasks` are gone; every core is used |
| `export-tables` | hyparquet writer | Apache parquet writer: same tables, columns and rows; part bytes, part CIDs and the tables root differ |
| `upload` | Also uploads a hashed ZIP to Pinata | County CARs and tables directories only |
| `transform` | Scripts run as Node child processes with the CLI's `node_modules` | Scripts run on embedded QuickJS with the Node modules listed under [transform](#transform), confined to their working directory; legacy mode and the Property Improvement extractor mode are gone |
| `transform` scripts | The four mapping scripts run at once; links in a data-group root array follow directory order, which varies | They run one after another (`ownerMapping`, `structureMapping`, `layoutMapping`, `utilityMapping`, then `data_extractor`); links follow file-name order. CIDs after `hash` are the same |
| `transform` handlers | `--transform-version 2` required; no npm packages | `--transform-zip` alone is enough; `cheerio` can be imported |
| `prepare` flows | doT templates; the built-in `SEARCH_BY_PARCEL_ID` flow | Only `{{=it.<name>}}` is filled; write the flow as a `--browser-flow-file` (`--browser-flow-template` and `--browser-flow-parameters` are gone) |
| `prepare` browser | Bundled Chromium through Puppeteer | The obscura browser, installed separately; `--no-headless` is gone |
| `prepare --input-csv` | With a multi-request flow or a browser flow | With a multi-request flow only |
| `prepare` captures | Cleaned and formatted with Prettier | Cleaned, not reformatted |
| Browser Flow v2 `page` | The whole Puppeteer `Page` | The methods listed under [prepare](#prepare) |

## Development

```bash
cargo test                                   # unit and CLI tests
OBSCURA_BIN=/path/to/obscura cargo test      # also the browser tests of prepare
cargo fmt && cargo clippy --all-targets -- -D warnings
```

- The tests run the built binary on real files. Expected outputs under `tests/fixtures` were produced by elephant-cli 1.58.1 on the same inputs.
- `assets/cheerio.js` is cheerio's browser build as one file; `scripts/bundle-cheerio.sh` rebuilds it.
- `scripts/parity` holds the checks against elephant-cli 1.x and the fuzzers; its README says what each one needs.
- `CONTEXT.md` defines the terms used in code and documentation.
