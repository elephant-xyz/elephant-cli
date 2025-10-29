# Elephant Network CLI

This guide walks Elephant Network oracles through the complete workflow of transforming county data and submitting proofs on-chain using the Elephant CLI.

## Table of Contents

- [Overview](#overview)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Create an Encrypted Keystore](#create-an-encrypted-keystore)
- [Transform Input Requirements](#transform-input-requirements)
- [Property Improvement Workflow](#property-improvement-workflow)
- [Build the Seed Bundle](#build-the-seed-bundle)
- [Fetch Current Source Content](#fetch-current-source-content)
- [Browser Flow Templates](#browser-flow-templates)
- [Generate Transformation Scripts](#generate-transformation-scripts)
- [Produce the County Dataset](#produce-the-county-dataset)
- [Hash the County Dataset](#hash-the-county-dataset)
- [Upload Datagroups to IPFS](#upload-datagroups-to-ipfs)
- [Submit Hashes to the Contract](#submit-hashes-to-the-contract)
- [Utility Commands](#utility-commands)

## Overview

The Elephant CLI enables oracles to:

- Derive canonical seed files from jurisdiction sourcing metadata (`transform`).
- Download the live county response for reproducible processing (`prepare`).
- Generate and execute extraction scripts for county-specific transformations (`generate-transform` and `transform`).
- Process Property Improvement data groups with HTML extraction and relationship mapping (`transform --data-group "Property Improvement"`).
- Canonicalize outputs, upload to IPFS, and record submissions on the Polygon network (`hash`, `upload`, `submit-to-contract`).

Each section below explains what a command does, the inputs it expects, the resulting artifacts, available options, and a runnable example.

## Prerequisites

- Node.js 20.0 or later (includes `npm`).
- Ability to create and extract ZIP archives (`zip`/`unzip`).
- Access to a Polygon RPC endpoint (e.g., Alchemy, Infura, or internal infrastructure).
- Oracle private key to be stored in an encrypted keystore file.
- Pinata JWT (`PINATA_JWT`) for IPFS uploads.
- OpenAI API key (`OPENAI_API_KEY`) for script generation.
- Stable network connection and sufficient disk space for ZIP artifacts.

## Installation

Install once and reuse:

```bash
npm install -g @elephant-xyz/cli
```

Or run ad-hoc without installing globally:

```bash
npx @elephant-xyz/cli --help
```

## Create an Encrypted Keystore

Use `create-keystore` to encrypt your Polygon private key for later use with `submit-to-contract`.

```bash
elephant-cli create-keystore \
  --private-key 0xYOUR_PRIVATE_KEY \
  --password "your-strong-password" \
  --output oracle-keystore.json
```

**What it does**

- Encrypts the supplied private key with the provided password.
- Writes an encrypted JSON keystore to disk and prints the derived address.

**Inputs**

- Private key (with or without `0x`).
- Password (minimum 8 characters).

**Output**

- `oracle-keystore.json` (or the path provided via `--output`).

**Options**

| Option                      | Description                                     | Default         |
| --------------------------- | ----------------------------------------------- | --------------- |
| `-k, --private-key <key>`   | Private key to encrypt.                         | Required        |
| `-p, --password <password>` | Password used for encryption.                   | Required        |
| `-o, --output <path>`       | Destination file for the keystore JSON.         | `keystore.json` |
| `-f, --force`               | Overwrite the output file if it already exists. | `false`         |

## Transform Input Requirements

The first `transform` run produces canonical seed files from a county sourcing list. Supply a ZIP that contains a single `seed.csv` at its top level:

```
seed-input.zip
└── seed.csv
```

`seed.csv` must include the following headers (one property per row):

| Column                  | Required | Purpose                                                                            |
| ----------------------- | -------- | ---------------------------------------------------------------------------------- |
| `parcel_id`             | ✅       | Parcel identifier used across Elephant datasets.                                   |
| `address`               | ✅       | Human-readable street address for logging and fact sheets.                         |
| `method`                | ✅       | HTTP method (`GET` or `POST`).                                                     |
| `url`                   | ✅       | Base URL to request during `prepare`.                                              |
| `multiValueQueryString` | ➖       | JSON string mapping query keys to string arrays (e.g. `{"parcel":["0745"]}`).      |
| `source_identifier`     | ✅       | Stable identifier for the property request (becomes the file stem in later steps). |
| `county`                | ✅       | County name (case-insensitive; transformed to title case).                         |
| `json`                  | ➖       | JSON request body (stringified). Mutually exclusive with `body`.                   |
| `body`                  | ➖       | Raw request payload string. Mutually exclusive with `json`.                        |
| `headers`               | ➖       | JSON string of HTTP headers (e.g. `{"content-type":"application/json"}`).          |

Only one of `json` or `body` may be present in a row. Leave optional columns blank when not needed.

Example row:

```
parcel_id,address,method,url,multiValueQueryString,source_identifier,county,json
074527L1060260060,123 Example Ave,GET,https://county.example.com/search,"{\"parcel\":[\"074527L1060260060\"]}",ALACHUA-074527L1060260060,Alachua,
```

## Property Improvement Workflow

The Property Improvement workflow extracts structured data from permit websites and creates a Property Improvement data group with all related entities and relationships.

### Overview

The Property Improvement workflow consists of three main steps:

1. **Prepare**: Fetch HTML content from permit websites using HTTP requests
2. **Extract**: Run extraction scripts to parse HTML and create structured JSON files  
3. **Transform**: Create Property Improvement data group with relationships

### Step 1: Prepare HTML Content

Create an `input.csv` file with HTTP request details for the permit website:

```csv
source_http_request,request_identifier
"https://egweb1.cityofbonitasprings.org/energov/selfservice#/permit/e7e6ec95-4042-4710-ad00-f946bb30291f",permit-123
```

Then run the prepare step to fetch the HTML content:

```bash
# Create input.zip with input.csv
elephant-cli prepare input.zip --output-zip prepared-property-improvement.zip
```

**What this does:**
- Reads HTTP request details from `input.csv`
- Fetches HTML content from the permit website
- Creates `prepared-property-improvement.zip` containing both `input.csv` and the fetched HTML file

### Step 2: Create Extraction Scripts

Create a `property-improvement-extractor.js` script that:
- Reads HTML files from the input directory
- Extracts Property Improvement data (permit details, contractors, inspections, etc.)
- Creates structured JSON files for each entity type
- Outputs files to the data directory

Example script structure:
```javascript
// property-improvement-extractor.js
const fs = require('fs');
const cheerio = require('cheerio');

// Read HTML file
const html = fs.readFileSync('input/permit.html', 'utf8');
const $ = cheerio.load(html);

// Extract Property Improvement data
const propertyImprovement = {
  permit_number: $('.permit-number').text(),
  permit_type: $('.permit-type').text(),
  // ... more fields
};

// Write JSON files
fs.writeFileSync('data/property_improvement.json', JSON.stringify(propertyImprovement));
fs.writeFileSync('data/property_improvement_has_contractor_1.json', JSON.stringify(contractorRelationship));
```

Package your script into `property-improvement-scripts.zip`:
```
property-improvement-scripts.zip
└── scripts/
    └── property-improvement-extractor.js
```

### Step 3: Transform to Data Group

Run the transform command to create the Property Improvement data group:

```bash
elephant-cli transform \
  --data-group "Property Improvement" \
  --input-zip prepared-property-improvement.zip \
  --scripts-zip property-improvement-scripts.zip \
  --output-zip property-improvement-output.zip
```

**What this does:**

1. **Runs extraction script**: Executes `property-improvement-extractor.js` to parse HTML and create JSON files
2. **Copies extracted files**: Moves JSON files from `data/` to `input/` for processing
3. **Creates data group**: Builds Property Improvement data group structure with relationships
4. **Validates output**: Ensures all files conform to Property Improvement schema

**Input Requirements:**

- **input.csv**: HTTP request details (same format as seed.csv)
- **HTML file**: Property improvement data from permit website
- **Extraction script**: `property-improvement-extractor.js` that parses HTML and creates JSON files

**Output Structure:**

```
property-improvement-output.zip
└── data/
    ├── <property_improvement_schema_cid>.json    # Data group root file
    ├── property_improvement.json                # Main Property Improvement entity
    ├── company_1.json                           # Contractor/company entities
    ├── file_1.json                              # File attachments
    ├── inspection_1.json                       # Inspection records
    ├── property_improvement_has_contractor_1.json  # Relationships
    ├── property_improvement_has_file_1.json
    └── property_improvement_has_inspection_1.json
```

**Key Differences from County Workflow:**

- **No fact sheet generation**: Property Improvement data groups don't include fact sheet relationships
- **Custom extraction**: Uses `property-improvement-extractor.js` instead of County mapping scripts
- **HTML-based**: Extracts data from HTML content rather than structured CSV data
- **Single script**: Runs one extraction script instead of multiple mapping scripts

**Validation:**

The output can be validated using:
```bash
elephant-cli validate property-improvement-output.zip
```

This ensures all files conform to the Property Improvement schema and relationships are properly structured.

## Build the Seed Bundle

Run `transform` against the seed ZIP to derive the foundational seed files.

```bash
elephant-cli transform \
  --input-zip seed-input.zip \
  --output-zip seed-bundle.zip
```

**What it does**

- Parses `seed.csv` and constructs canonical `property_seed.json`, `unnormalized_address.json`, and relationship scaffolding.
- Generates a seed datagroup JSON (named by the Seed schema CID) and related fact-sheet relationships.
- Packages everything inside a top-level `data/` directory.

**Inputs**

- ZIP containing `seed.csv` at the root.

**Output**

```
seed-bundle.zip
└── data/
    ├── <seed_schema_cid>.json
    ├── property_seed.json
    ├── relationship_property_to_address.json
    ├── unnormalized_address.json
    └── relationship_unnormalized_address_to_fact_sheet.json
```

For the next step, extract `data/property_seed.json` and `data/unnormalized_address.json` into a new working folder (no subdirectories) and zip them as `prepare-input.zip`.

**Options**

| Option                 | Description                                                  | Default                |
| ---------------------- | ------------------------------------------------------------ | ---------------------- |
| `--input-zip <path>`   | Seed ZIP containing `seed.csv`.                              | Required               |
| `--output-zip <path>`  | Destination ZIP for generated seed assets.                   | `transformed-data.zip` |
| `--scripts-zip <path>` | When provided, runs county scripts instead of seed mode.     | None                   |
| `--legacy-mode`        | Use the legacy AI workflow (not used in modern oracle flow). | `false`                |

## Fetch Current Source Content

Package the extracted seed files into a ZIP that looks like this:

```
prepare-input.zip
├── property_seed.json
└── unnormalized_address.json
```

Run `prepare` to reproduce the county response referenced by the seed.

```bash
elephant-cli prepare prepare-input.zip --output-zip prepared-site.zip
```

For sites requiring browser interaction, choose the appropriate approach:

```bash
# Simple disclaimer/agree button only
elephant-cli prepare prepare-input.zip \
  --output-zip prepared-site.zip \
  --continue-button "#acceptDataDisclaimer" \
  --use-browser

# Complex counties requiring multi-step navigation
elephant-cli prepare prepare-input.zip \
  --output-zip prepared-site.zip \
  --browser-flow-template <TEMPLATE_NAME> \
  --browser-flow-parameters '<JSON_PARAMETERS>'

# Sites with CAPTCHA that should be ignored
elephant-cli prepare prepare-input.zip \
  --output-zip prepared-site.zip \
  --use-browser \
  --ignore-captcha

# Using a proxy for browser mode (helpful for bypassing rate limits)
elephant-cli prepare prepare-input.zip \
  --output-zip prepared-site.zip \
  --use-browser \
  --proxy "username:password@192.168.1.1:8080"

# Using multi-request flow for APIs with multiple endpoints
elephant-cli prepare prepare-input.zip \
  --output-zip prepared-site.zip \
  --multi-request-flow-file flow.json
```

**What it does**

- Reads `source_http_request` from `property_seed.json`.
- Performs the HTTP request (direct fetch by default, optional headless browser for GET endpoints, or multi-request flow for multiple API endpoints).
- Writes the response to `<request_identifier>.html` or `<request_identifier>.json` alongside the seed files.

**Inputs**

- ZIP containing `property_seed.json` and `unnormalized_address.json` at the top level.

**Output**

```
prepared-site.zip
├── property_seed.json
├── unnormalized_address.json
└── <request_identifier>.html | <request_identifier>.json
```

**Options**

| Option                               | Description                                                                     | Default  |
| ------------------------------------ | ------------------------------------------------------------------------------- | -------- |
| `--output-zip <path>`                | Destination ZIP containing the fetched response.                                | Required |
| `--use-browser`                      | Fetch GET requests with a headless Chromium browser (needed for dynamic sites). | `false`  |
| `--no-continue`                      | Skip auto-clicking "Continue" modals when browser mode is active.               | `false`  |
| `--continue-button <selector>`       | CSS selector for a simple continue/agree button to click.                       | None     |
| `--ignore-captcha`                   | Ignore CAPTCHA pages and continue processing.                                   | `false`  |
| `--browser-flow-template <name>`     | Use a predefined browser automation template (e.g., `SEARCH_BY_PARCEL_ID`).     | None     |
| `--browser-flow-parameters <json>`   | JSON parameters for the browser flow template.                                  | None     |
| `--browser-flow-file <path>`         | Path to custom browser flow JSON file (takes precedence over template).         | None     |
| `--multi-request-flow-file <path>`   | Path to JSON file defining a multi-request flow (sequence of HTTP requests).    | None     |
| `--proxy <url>`                      | Proxy URL with authentication (format: `username:password@ip:port`).            | None     |

### Browser Flow Templates

Browser flow templates provide reusable automation patterns for complex county websites that require multi-step navigation. Instead of hardcoding browser interactions, templates allow you to configure automation using CSS selectors as parameters. The URL is automatically extracted from `property_seed.json`'s `source_http_request` field.

**Key Benefits:**

- Handles modal dialogs and terms acceptance screens
- Automates form filling and navigation
- Configurable for different county website structures
- No code changes required for new counties

For available templates, parameters, and detailed usage examples, see [Browser Flow Templates Documentation](./docs/browser-flow-templates.md).

**Need Maximum Flexibility?**

For complex, site-specific workflows that don't fit standard templates, you can define custom browser flows using JSON files. This gives you complete control over the automation sequence. See [Custom Browser Flows Documentation](./docs/custom-browser-flows.md) for detailed information and examples.

Quick example using a custom flow:

```bash
elephant-cli prepare input.zip \
  --output-zip output.zip \
  --browser-flow-file my-custom-flow.json
```

### Multi-Request Flows

For counties where property data is distributed across multiple API endpoints, use multi-request flows to fetch and combine data from a sequence of HTTP requests into a single JSON output.

**When to Use Multi-Request Flows:**

- Property data is spread across multiple API endpoints (e.g., owner info, sales history, tax data)
- Different aspects of property information require separate API calls
- The property appraiser provides API access rather than HTML pages
- A single page view or request cannot capture all necessary data

**Key Features:**

- Execute multiple HTTP requests in parallel (GET, POST, PUT, PATCH)
- Automatically substitute `{{=it.request_identifier}}` template variables in URLs, headers, bodies, and query parameters using doT.js syntax
- Support for JSON and form-encoded request bodies
- Automatic response parsing (JSON or string)
- Combined output with all request/response pairs in a single JSON file

For detailed documentation, configuration format, validation rules, and troubleshooting, see [Multi-Request Flow Documentation](./docs/MULTI_REQUEST_FLOW.md).

**Quick Example:**

Create a flow file `manatee-flow.json`:

```json
{
  "requests": [
    {
      "key": "OwnersAndGeneralInformation",
      "request": {
        "method": "POST",
        "url": "https://example.com/api/owner",
        "headers": {
          "content-type": "application/x-www-form-urlencoded"
        },
        "body": "parid={{=it.request_identifier}}"
      }
    },
    {
      "key": "Sales",
      "request": {
        "method": "GET",
        "url": "https://example.com/api/sales?parid={{=it.request_identifier}}"
      }
    }
  ]
}
```

Then run:

```bash
elephant-cli prepare prepare-input.zip \
  --output-zip prepared-site.zip \
  --multi-request-flow-file manatee-flow.json
```

See the [examples directory](./examples/manatee-multi-request-prepare-flow.json) for a complete real-world example.

To use `transform` with a browser on AWS EC2 instances you need to run Ubuntu 22.04 or later and perfrom the following steps:

```bash
# Update package lists
sudo apt update


# Install dependencies
sudo apt install -y \
    dconf-service \
    libasound2t64 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libc6 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libexpat1 \
    libfontconfig1 \
    libgcc-s1 \
    libgdk-pixbuf2.0-0 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libstdc++6 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
    ca-certificates \
    fonts-liberation \
    libayatana-appindicator3-1 \
    libnss3 \
    lsb-release \
    xdg-utils \
    wget \
    libgbm1


# Clean up
sudo apt autoremove -y
sudo apt clean
```

## Generate Transformation Scripts

Provide the prepared site bundle to `generate-transform` to produce county-specific extraction scripts. Set `OPENAI_API_KEY` beforehand.

```bash
export OPENAI_API_KEY=sk-live...
elephant-cli generate-transform prepared-site.zip \
  --output-zip generated-scripts.zip
```

**What it does**

- Runs an LLM pipeline that reads the seed, address, and downloaded county response.
- Generates JavaScript scripts (`ownerMapping.js`, `structureMapping.js`, `layoutMapping.js`, `utilityMapping.js`, `data_extractor.js`) plus a manifest.

**Inputs**

- ZIP containing `property_seed.json`, `unnormalized_address.json`, and one HTML or JSON county response file at the root. Optionally include a `scripts/` directory with prior attempts and CSVs containing previous errors.

**Output**

```
generated-scripts.zip
├── data_extractor.js
├── ownerMapping.js
├── structureMapping.js
├── utilityMapping.js
├── layoutMapping.js
└── manifest.json
```

**Options**

| Option                         | Description                                                                                                                                              | Default                 |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| `-o, --output-zip <path>`      | Destination ZIP for generated scripts or repaired scripts.                                                                                               | `generated-scripts.zip` |
| `-d, --data-dictionary <path>` | Optional reference file fed to the generator.                                                                                                            | None                    |
| `--scripts-zip <path>`         | Existing scripts bundle (must contain `data_extractor.js`) for automatic repair.                                                                         | None                    |
| `-e, --error <string>`         | JSON error payload captured from a failed transform run.                                                                                                 | None                    |
| `--error-csv <path>`           | CSV of validation errors produced by `validate` (e.g., `submit_errors.csv`). Deduplicated and used to guide automatic repair (requires `--scripts-zip`). | None                    |

**Error repair flow**

- Supply `--scripts-zip` and exactly one of:
  - `--error` with a JSON payload like `{"type":"error","message":"Unknown enum value X.","path":"Class.property"}`
  - `--error-csv` with a validation errors CSV generated by `validate` (headers: `property_cid,data_group_cid,file_path,error_path,error_message,timestamp`)
- When `--error-csv` is provided, the CLI:
  - Parses all rows, maps each `error_path` (e.g., `/relationships/<rel>/.../(from|to)/<prop>`) through the given `data_group_cid` to resolve the underlying `<Class>.<property>`.
  - Deduplicates errors by `<Class>.<property>` and aggregates them into a single error payload.
  - Fetches the schema fragment for each unique property and provides all fragments to the repair prompt.
- The CLI extracts `data_extractor.js`, passes the current script, aggregated error(s), and schema fragment(s) to the model, and writes back the fixed `data_extractor.js` into `--output-zip`.
- Only the extraction script is modified; other files remain untouched. The repaired ZIP can be reused with the `transform` command.

Example invocations:

```bash
# Repair using a single JSON error payload
elephant-cli generate-transform prepared-site.zip \
  --scripts-zip generated-scripts.zip \
  --error '{"type":"error","message":"must be one of ...","path":"Owner.first_name"}' \
  --output-zip generated-scripts-fixed.zip

# Repair using a CSV of validation errors produced by `validate`
elephant-cli generate-transform prepared-site.zip \
  --scripts-zip generated-scripts.zip \
  --error-csv submit_errors.csv \
  --output-zip generated-scripts-fixed.zip
```

_Approximate duration: up to one hour per county. The process consumes OpenAI API credits._

## Produce the County Dataset

Run `transform` again, this time supplying both the prepared site ZIP and the generated scripts.

```bash
elephant-cli transform \
  --input-zip prepared-site.zip \
  --scripts-zip generated-scripts.zip \
  --output-zip transformed-data.zip
```

**What it does**

- Normalizes inputs to `input.html`/`input.json`, `property_seed.json`, and `unnormalized_address.json` in a temporary workspace.
- Executes the generated scripts, adding `source_http_request` metadata to every datagroup.
- Builds county relationships and fact-sheet artifacts, then bundles the results.

**Inputs**

- `prepared-site.zip` (from the previous step).
- `generated-scripts.zip` (from the LLM pipeline or a hand-tuned bundle).

**Output**

```
transformed-data.zip
└── data/
    ├── property.json
    ├── *.json (cleaned datagroups named by schema CIDs)
    ├── relationship_*.json
    ├── fact_sheet.json
    └── *.html / media assets for the fact sheet
```

**Options**

| Option                 | Description                                                    | Default                  |
| ---------------------- | -------------------------------------------------------------- | ------------------------ |
| `--input-zip <path>`   | Prepared site ZIP with seed and source response.               | Required                 |
| `--scripts-zip <path>` | ZIP of scripts to execute.                                     | Required in scripts mode |
| `--output-zip <path>`  | Destination ZIP for the transformed county bundle.             | `transformed-data.zip`   |
| `--legacy-mode`        | Use the legacy agent flow (not part of the standard pipeline). | `false`                  |

## Hash the County Dataset

Feed the transformed bundle to `hash` to compute content-addressed JSON and produce the submission CSV.

```bash
elephant-cli hash transformed-data.zip \
  --output-zip hashed-data.zip \
  --output-csv hash-results.csv
```

**What it does**

- Canonicalizes every JSON datagroup.
- Calculates IPFS-compatible multihash CIDs.
- Produces a CSV mapping property, datagroup, and data CIDs, ready for contract submission.

**Inputs**

- ZIP containing a single property directory (such as `transformed-data.zip` from the previous step). The ZIP may contain either files directly or a `data/` folder; both are supported.

**Outputs**

```
hashed-data.zip
└── <property_cid>/
    ├── <data_cid>.json (canonicalized datagroups)
    └── *.html / media copied from the transform bundle

hash-results.csv
propertyCid,dataGroupCid,dataCid,filePath,uploadedAt,htmlLink
...
```

The CSV leaves `uploadedAt` empty (populated after IPFS upload) and populates `htmlLink` when fact-sheet media assets are present.

**Options**

| Option                            | Description                                                                   | Default                    |
| --------------------------------- | ----------------------------------------------------------------------------- | -------------------------- |
| `-o, --output-zip <path>`         | Destination ZIP containing canonicalized JSON (folder named by property CID). | `hashed-data.zip`          |
| `-c, --output-csv <path>`         | CSV file with hash results.                                                   | `hash-results.csv`         |
| `--max-concurrent-tasks <number>` | Target concurrency for hashing (fallback determined automatically).           | Auto                       |
| `--property-cid <cid>`            | Override the property CID used for the output folder and CSV.                 | Seed CID or inferred value |

## Upload Datagroups to IPFS

Upload the hashed bundle to Pinata with the `upload` command. Provide a Pinata JWT via `--pinata-jwt` or `PINATA_JWT`.

```bash
export PINATA_JWT=eyJhbGciOi...
elephant-cli upload hashed-data.zip \
  --output-csv upload-results.csv
```

**What it does**

- Extracts the single property directory from the hashed ZIP.
- Uploads JSON datagroups (and HTML/image assets) to IPFS via Pinata.
- Writes a CSV in the same format as `hash-results.csv`, including upload timestamps and media links when available.

**Inputs**

- `hashed-data.zip` containing one property directory named by property CID.

**Outputs**

- IPFS CID for the JSON directory (printed in the CLI).
- Optional CID for media files when present.
- `upload-results.csv` mirroring the hash CSV headers with populated `uploadedAt` (ISO 8601) and `htmlLink` columns.

**Options**

| Option                    | Description                                               | Default                    |
| ------------------------- | --------------------------------------------------------- | -------------------------- |
| `--pinata-jwt <jwt>`      | Pinata authentication token (falls back to `PINATA_JWT`). | Required if env var absent |
| `-o, --output-csv <path>` | CSV summarizing uploaded datagroups.                      | `upload-results.csv`       |

## Submit Hashes to the Contract

Finalize the workflow by submitting the uploaded hashes to the Elephant smart contract on Polygon.

```bash
elephant-cli submit-to-contract upload-results.csv \
  --keystore-json oracle-keystore.json \
  --keystore-password "your-strong-password" \
  --rpc-url https://polygon.llamarpc.com \
  --gas-price auto
```

Use the CSV generated by `upload` (preferred) or `hash` (if you operate your own uploader) as the input.

**What it does**

- Validates each row, batches submissions, and sends transactions to the Elephant contract.
- Optionally performs dry runs, centralized API submissions, or unsigned transaction export.
- Writes transaction IDs to a CSV for auditing.

**Inputs**

- CSV with headers `propertyCid,dataGroupCid,dataCid,filePath,uploadedAt,htmlLink`.
- Encrypted keystore JSON and password, or centralized API credentials.

**Outputs**

- On-chain transactions (unless `--dry-run` is used).
- Updated reports: `submit_errors.csv`, `submit_warnings.csv`, and a timestamped `transaction-ids-*.csv` (override with `--transaction-ids-csv`).

**Options**

| Option                                | Description                                                                 | Default                                   |
| ------------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------- |
| `--keystore-json <path>`              | Encrypted keystore file containing the oracle key.                          | Required unless using API mode            |
| `--keystore-password <password>`      | Password for decrypting the keystore (or set `ELEPHANT_KEYSTORE_PASSWORD`). | Required with keystore                    |
| `--rpc-url <url>`                     | Polygon RPC endpoint.                                                       | Env `RPC_URL` or Elephant default         |
| `--contract-address <address>`        | Submit contract address.                                                    | Env `SUBMIT_CONTRACT_ADDRESS` or default  |
| `--transaction-batch-size <number>`   | Number of items per transaction.                                            | `200`                                     |
| `--gas-price <value>`                 | Gas price in gwei (`auto` or numeric string).                               | `30`                                      |
| `--dry-run`                           | Validate and produce artifacts without sending transactions.                | `false`                                   |
| `--unsigned-transactions-json <path>` | File to store unsigned transactions (requires `--dry-run`).                 | None                                      |
| `--from-address <address>`            | Sender address to record in unsigned transactions.                          | None                                      |
| `--domain <domain>`                   | Centralized submission API domain.                                          | None                                      |
| `--api-key <key>`                     | API key for centralized submission.                                         | None                                      |
| `--oracle-key-id <id>`                | Oracle key identifier for centralized submission.                           | None                                      |
| `--check-eligibility`                 | Verify consensus and prior submissions before sending.                      | `false`                                   |
| `--transaction-ids-csv <path>`        | Output CSV for transaction hashes.                                          | `reports/transaction-ids-{timestamp}.csv` |

Complete these steps for each property, track generated artifacts, and retain keystore/password information securely. Running the commands in the order above delivers a full seed-to-contract submission for the Elephant Network.

## Utility Commands

These helpers support cross-checking hashes, translating identifiers, and auditing previously submitted payloads.

### Convert Hex Hashes to CID

```bash
elephant-cli hex-to-cid 0x1220e828d7cf579e7a7b2c60cffd66a4663b4857670f2ec16125cb22f1affc6c \
  --validate
```

**What it does**

- Validates an Ethereum-style `0x`-prefixed (or bare) 32-byte hex string.
- Converts the hash to a base32 CIDv1 using the raw codec and prints it to stdout.

**Input**

- One 32-byte hex hash (with or without `0x`).

**Output**

- CID string on stdout. With `--quiet`, emits the CID only; otherwise prefixes output with `CID:`.

**Options**

| Option           | Description                                                       | Default |
| ---------------- | ----------------------------------------------------------------- | ------- |
| `-v, --validate` | Print confirmation that the hex input is valid before conversion. | `false` |
| `-q, --quiet`    | Suppress labels and emit just the CID string.                     | `false` |

### Convert CID to Hex Hash

```bash
elephant-cli cid-to-hex bafkreicfajrgq6qicnclpbg4qolyhm6co74fcwrkm7n6dyx4qw5bpjvlfe \
  --validate
```

**What it does**

- Validates a CIDv1 string.
- Converts the CID into the 32-byte hex hash expected by on-chain contracts.

**Input**

- One CIDv1 string (multibase base32, usually beginning with `b`).

**Output**

- 32-byte hex hash on stdout (prefixed with `Hex:` unless `--quiet` is used).

**Options**

| Option           | Description                                                       | Default |
| ---------------- | ----------------------------------------------------------------- | ------- |
| `-v, --validate` | Print confirmation that the CID input is valid before conversion. | `false` |
| `-q, --quiet`    | Suppress labels and emit just the hex string.                     | `false` |

### Fetch Data from IPFS or Transactions

```bash
elephant-cli fetch-data bafkreicfajrgq6qicnclpbg4qolyhm6co74fcwrkm7n6dyx4qw5bpjvlfe \
  --output-zip fetched-data.zip \
  --gateway https://gateway.pinata.cloud/ipfs
```

You can also supply a Polygon transaction hash (32-byte hex). When a transaction is provided, the CLI resolves its logged dataset hashes via the configured RPC endpoint before downloading referenced CIDs.

**What it does**

- Traverses an IPFS datagroup tree starting from a CID, following relationship links, and saves the resolved JSON to a ZIP archive.
- For transaction hashes, reads on-chain submissions, converts each hex hash back into CID form, and downloads the associated data graph.
- Rewrites CID links inside the fetched JSON to point at the relative paths inside the ZIP for easier offline inspection.

**Inputs**

- Either an IPFS CID or a 32-byte transaction hash. Provide one identifier per invocation.

**Outputs**

```
fetched-data.zip
└── <property_folder>/
    ├── *.json (datagroups named by schema CID when known)
    └── relationship_*.json (local links between files)
```

When media assets are referenced and accessible through the gateway, they are downloaded into sibling files in the same property folder.

**Options**

| Option                    | Description                                                                            | Default                             |
| ------------------------- | -------------------------------------------------------------------------------------- | ----------------------------------- |
| `-g, --gateway <url>`     | IPFS gateway used for downloads (set `IPFS_GATEWAY` to override globally).             | `https://gateway.pinata.cloud/ipfs` |
| `-o, --output-zip <path>` | Destination ZIP that will hold the fetched dataset.                                    | `fetched-data.zip`                  |
| `-r, --rpc-url <url>`     | Polygon RPC endpoint used when resolving transaction hashes (falls back to `RPC_URL`). | Elephant default                    |

Set `--gateway` to match the provider used during uploads if you need consistent access controls. Provide an RPC endpoint with access to Elephant submissions when fetching by transaction hash.
