**Purpose**

- Document the end-to-end flow to: generate county extraction scripts, run them with `transform`, optionally hand-fix scripts, and validate the final JSON bundle.

**Overview**

- **generate-transform**: Creates JavaScript extraction scripts from a minimal input ZIP. Runs an LLM pipeline and can leverage prior scripts and error CSVs for iterative improvement.
- **transform**: Runs the generated scripts against your inputs, enriches outputs, generates relationships and fact-sheet assets, and bundles everything.
- **validate**: Validates the single-property output ZIP against schema CIDs and reports errors to CSV.

**Inputs For generate-transform**

- **Required files (inside one ZIP)**:
  - `unnormalized_address.json`: Address and jurisdiction info.
  - `property_seed.json`: Contains `parcel_id`, `source_http_request`, and `request_identifier`.
  - One site file: `input.html` or any single `*.html`/`*.json` file representing the county page/response.
- **Optional (recommended for iterations)**:
  - `scripts/` directory: Prior JS scripts to improve.
  - `submit_errors.csv` or any `*errors*.csv`: Previous validation/submit errors; used to improve scripts.
  - Data dictionary file: Plain-text or JSON reference that lists enum values and source-data hints for fields the generator should map (pass via `--data-dictionary`).

**Command: generate-transform**

- Run: `npx -y @elephant-xyz/cli@latest generate-transform <inputZip> --output-zip generated-scripts.zip`
- Env var required: `OPENAI_API_KEY`.
- Notes:
  - Duration: ~1 hour; Estimated cost: ~$10 USD.
  - The agent auto-detects `unnormalized_address.json`, `property_seed.json`, and the first `*.html` or non-seed `*.json` file.
  - If your ZIP includes `scripts/` and an errors CSV, those are read as prior context and fed into the prompts.
  - Provide a data dictionary with `--data-dictionary <path>` to share curated enum definitions or reference tables with the generator. The file contents are streamed directly to the LLM alongside other inputs.
  - Output: `generated-scripts.zip` containing `*.js` files and a `manifest.json` with metadata.

**What the generated scripts expect**

- Scripts run with working directory set to a temp folder where these files are placed:
  - `unnormalized_address.json`, `property_seed.json`
  - `input.html`
- Expected script entrypoints (found by exact filename anywhere in the bundle):
  - `ownerMapping.js`, `structureMapping.js`, `layoutMapping.js`, `utilityMapping.js`
  - `data_extractor.js`
- Execution contract (from `transform` runner):
  - Each mapping script runs under Node (no args, cwd = temp workdir) and must exit code `0`.
  - `data_extractor.js` runs last to assemble final JSON outputs in a `data/` directory.
  - `node_modules` are linked into the temp workdir; requiring dependencies from the project should work.
  - Enum handling expectations:
    - Always map enum values from source data or the provided data dictionary.
    - Throw an error when an unmapped enum value is encountered using:

      ```json
      {
        "type": "error",
        "message": "Unknown enum value.",
        "path": "<class_name>.<property_name>"
      }
      ```

    - Do not hardcode enum fallbacks (county name remains the only allowed hardcoded enum).
    - Never assign default values to non-nullable enums.

**Using scripts with transform**

- Prepare your inputs ZIP (the same structure you used for generation is fine):
  - Must contain `unnormalized_address.json`, `property_seed.json`, and an HTML/JSON site file.
- Run transform in scripts mode:
  - `npx -y @elephant-xyz/cli@latest transform --input-zip input.zip --scripts-zip generated-scripts.zip --output-zip transformed-data.zip`
- What transform does (scripts mode):
  - Extracts inputs to a temp folder and normalizes names (`input.html` if HTML is present).
  - Extracts your scripts ZIP and locates required filenames anywhere in the extracted tree.
  - Runs the four mapping scripts in parallel, then `data_extractor.js`.
  - Enriches each produced JSON with `source_http_request` and `request_identifier` from `property_seed.json`.
  - Auto-generates relationship JSONs between `property.json` and other entities.
  - Creates a County data group descriptor and runs fact-sheet generation (assets copied into `data/`).
  - Bundles everything as `transformed-data.zip` with a top-level `data/` directory.

**Unpacking and fixing scripts**

- Unzip `generated-scripts.zip` locally.
- Edit any of the entrypoint files listed above. Keep their filenames unchanged.
- Validate assumptions in your code:
  - Read inputs from cwd: `./input.html` (if HTML), `./unnormalized_address.json`, `./property_seed.json`.
  - Write all resulting JSON files to `./data/`.
  - Exit with code `0` on success; write useful messages to stdout/stderr to aid debugging.
- Re-zip the folder (any internal structure is fine) ensuring the filenames remain discoverable.
- Rerun `transform` with the updated `--scripts-zip`.

**Feeding validation errors back into generation**

- After validating (see next section), include the CSV (e.g., `submit_errors.csv`) in your next `input.zip`.
- Optionally include a `scripts/` folder with your latest scripts. The generator will use both as prior context to improve results.

**Validating the output**

- Command: `npx -y @elephant-xyz/cli@latest validate transformed-data.zip -o submit_errors.csv`
- What validate does for a single property ZIP:
  - Extracts the ZIP and validates all `*.json` files in the top-level directory against schema CIDs.
  - Validates seed first; if seed fails, other files in the same directory are skipped.
  - Emits errors to `submit_errors.csv` and warnings to a companion warnings CSV.
- Outcomes:
  - Zero errors: you are schema-valid; proceed to your next step.
  - Errors found: fix scripts or data and rerun `transform`, then `validate` again.

**Practical tips**

- Keep input ZIPs minimal and consistent across runs for determinism.
- If your site is JSON-only, ensure it is the only non-seed JSON in the inputs ZIP.
- Timeouts: script runner kills any script exceeding ~120s; optimize or add internal retries.
- Long runs: generation is slow and costly; iterate by hand-fixing scripts to cut cost and time.
