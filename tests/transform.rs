//! `elephant-cli transform`: prepared source content to lexicon data-group
//! files, with county JavaScript run on the embedded engine.
//!
//! Inputs, scripts and expected `data/` files under tests/fixtures/transform
//! are those of runs of elephant-cli 1.58.1, which ran the same scripts on Node.

mod support;

use serde_json::json;
use std::collections::BTreeMap;
use support::{entries, fixtures, pack, zip_of, Scratch};

/// The files a fixture's `expected/` directory holds, as `data/<name>` entries.
fn expected(fixture: &str) -> BTreeMap<String, Vec<u8>> {
    let dir = fixtures().join("transform").join(fixture).join("expected");
    let mut found = BTreeMap::new();
    for entry in std::fs::read_dir(dir).unwrap() {
        let path = entry.unwrap().path();
        found.insert(format!("data/{}", path.file_name().unwrap().to_string_lossy()), std::fs::read(path).unwrap());
    }
    found
}

fn text(files: &BTreeMap<String, Vec<u8>>) -> BTreeMap<&str, String> {
    files.iter().map(|(name, bytes)| (name.as_str(), String::from_utf8_lossy(bytes).into_owned())).collect()
}

#[test]
fn runs_the_five_county_scripts_and_builds_the_county_and_seed_groups() {
    let scratch = Scratch::new();
    scratch.lexicon();
    pack("transform/scripts-mode/input", &scratch.path("prepared.zip"));
    pack("transform/scripts-mode/scripts", &scratch.path("scripts.zip"));
    let ran = scratch.run(&[
        "--json",
        "transform",
        "--input-zip",
        "prepared.zip",
        "--scripts-zip",
        "scripts.zip",
        "--output-zip",
        "out.zip",
    ]);
    assert_eq!(ran.code, 0, "{}", ran.stderr);
    assert_eq!(text(&entries(&scratch.path("out.zip"))), text(&expected("scripts-mode")));
    assert_eq!(ran.json()["mode"], "scripts");
    // what was written validates, as it did in 1.x
    let checked = scratch.run(&["--json", "validate", "out.zip", "--output-csv", "errors.csv"]);
    assert_eq!(checked.json()["data_groups"], json!(2));
}

#[test]
fn reports_the_script_that_failed_with_what_it_threw() {
    let scratch = Scratch::new();
    scratch.lexicon();
    pack("transform/scripts-mode/input", &scratch.path("prepared.zip"));
    pack("transform/failing-scripts/scripts", &scratch.path("scripts.zip"));
    let ran =
        scratch.run(&["transform", "--input-zip", "prepared.zip", "--scripts-zip", "scripts.zip", "--output-zip", "out.zip"]);
    assert_eq!(ran.code, 2);
    assert!(ran.stderr.contains("Script failed (script=data_extractor.js code=1 durationMs="), "{}", ran.stderr);
    // the unmapped-value convention: the thrown message is the JSON the caller parses
    assert!(
        ran.stderr.contains(r#"Error: {"type":"error","message":"Unknown enum value Barn.","path":"property.property_type"}"#),
        "{}",
        ran.stderr
    );
    assert!(ran.stderr.contains("data_extractor.js:2"), "the stack names the file and line: {}", ran.stderr);
    assert!(!scratch.path("out.zip").exists());
}

#[test]
fn turns_a_seed_row_into_the_seed_records() {
    let scratch = Scratch::new();
    scratch.lexicon();
    pack("transform/seed/input", &scratch.path("seed.zip"));
    let ran = scratch.run(&["--json", "transform", "--input-zip", "seed.zip", "--output-zip", "out.zip"]);
    assert_eq!((ran.code, &ran.json()["mode"]), (0, &json!("seed")), "{}", ran.stderr);
    assert_eq!(text(&entries(&scratch.path("out.zip"))), text(&expected("seed")));
}

#[test]
fn runs_a_handler_package_and_builds_the_root_from_its_relationships() {
    let scratch = Scratch::new();
    scratch.lexicon();
    pack("transform/v2/input", &scratch.path("prepared.zip"));
    pack("transform/v2/handler", &scratch.path("handler.zip"));
    // `--transform-version 2` is what 1.x required; the package alone is enough now
    for extra in [&["--transform-version", "2"][..], &[]] {
        let mut args = vec![
            "--json",
            "transform",
            "--input-zip",
            "prepared.zip",
            "--transform-zip",
            "handler.zip",
            "--output-zip",
            "out.zip",
        ];
        args.extend(extra);
        let ran = scratch.run(&args);
        assert_eq!((ran.code, &ran.json()["mode"]), (0, &json!("handler")), "{}", ran.stderr);
        assert_eq!(text(&entries(&scratch.path("out.zip"))), text(&expected("v2")));
    }
}

/// Run a handler given as source text against the v2 fixture input; returns the CLI run.
fn handle(scratch: &Scratch, source: &str) -> support::Ran {
    scratch.lexicon();
    pack("transform/v2/input", &scratch.path("prepared.zip"));
    zip_of(&[("handler.js", source)], &scratch.path("handler.zip"));
    scratch.run(&[
        "--json",
        "transform",
        "--input-zip",
        "prepared.zip",
        "--transform-zip",
        "handler.zip",
        "--output-zip",
        "out.zip",
    ])
}

#[test]
fn gives_handlers_cheerio() {
    let scratch = Scratch::new();
    let ran = handle(
        &scratch,
        "import * as cheerio from 'cheerio';\n\
         export async function handler({ readCapture, writeJson }) {\n\
           const $ = cheerio.load(await readCapture('property-detail'));\n\
           await writeJson('property', { property_legal_description_text: $('#legal').text().trim() });\n\
         }\n",
    );
    assert_eq!(ran.code, 0, "{}", ran.stderr);
    let files = entries(&scratch.path("out.zip"));
    let property: serde_json::Value = serde_json::from_slice(&files["data/property.json"]).unwrap();
    assert_eq!(property["property_legal_description_text"], "LOT 1 BLOCK 2 EXAMPLE SUBDIVISION");
    assert_eq!(property["request_identifier"], "12345");
    // no relationship was written, so there is no data-group root
    assert_eq!(files.len(), 1);
}

#[test]
fn keeps_a_handler_inside_its_working_directory() {
    for read in
        ["fs.readFileSync('/etc/hostname', 'utf8')", "fs.readFileSync('../../../../etc/hostname', 'utf8')", "fs.readdirSync('/')"]
    {
        let scratch = Scratch::new();
        let ran = handle(&scratch, &format!("import fs from 'node:fs';\nexport async function handler() {{ {read}; }}\n"));
        assert_eq!(ran.code, 2, "{read}");
        assert!(ran.stderr.contains("EACCES: permission denied"), "{read}: {}", ran.stderr);
    }
}

#[test]
fn stops_a_handler_at_its_time_limit() {
    let scratch = Scratch::new();
    let began = std::time::Instant::now();
    let ran = handle(&scratch, "export const config = { timeoutMs: 1000 };\nexport async function handler() { for (;;) {} }\n");
    assert_eq!(ran.code, 2);
    assert!(ran.stderr.contains("Transform v2 timed out after 1000ms"), "{}", ran.stderr);
    assert!(began.elapsed().as_secs() < 10);
}

#[test]
fn rejects_what_a_handler_may_not_write() {
    let entity = "await writeJson('property', {}); await writeJson('address', {});";
    for (body, reason) in [
        ("await writeJson('Property', {});", "Invalid output name \"Property\". Output names must be snake_case stems."),
        ("await writeJson('property', {}); await writeJson('property', {});", "Duplicate output name: property"),
        ("await writeRelationship({ type: 'property_has_address', name: 'r', from: 'property', to: 'address' });", "Unknown relationship source: property"),
        (&format!("{entity} await writeRelationship({{ type: 'no_such', name: 'r', from: 'property', to: 'address' }});"), "Relationship type \"no_such\" is not valid for County"),
        (
            &format!("{entity} for (const name of ['a', 'b']) await writeRelationship({{ type: 'property_has_address', name, from: 'property', to: 'address' }});"),
            "Relationship type \"property_has_address\" only allows one relationship",
        ),
        ("await readCapture('missing');", "Unknown capture: missing"),
    ] {
        let scratch = Scratch::new();
        let ran = handle(&scratch, &format!("export async function handler({{ readCapture, writeJson, writeRelationship }}) {{ {body} }}\n"));
        assert_eq!(ran.code, 2, "{body}");
        assert!(ran.stderr.contains(reason), "{body}: {}", ran.stderr);
    }
    let scratch = Scratch::new();
    let ran = handle(&scratch, "export const config = { timeoutMs: 5 };\nexport async function handler() {}\n");
    assert!(ran.stderr.contains("Transform v2 timeoutMs must be between 1000ms and 600000ms"), "{}", ran.stderr);
    let ran = handle(&scratch, "export const nothing = 1;\n");
    assert!(ran.stderr.contains("Transform v2 package must export a handler function"), "{}", ran.stderr);
}

#[test]
fn fails_a_script_that_exits_non_zero_or_leaves_a_rejection_unhandled() {
    let quiet = "require('fs').mkdirSync('owners', { recursive: true });";
    for (extractor, reason) in [
        ("console.error('bad page'); process.exit(3);", "code=3"),
        ("Promise.reject(new Error('lost'));", "Unhandled promise rejection: lost"),
        ("main().catch((error) => { console.error(error.message); process.exit(1); }); async function main() { throw new Error('inside main'); }", "inside main"),
    ] {
        let scratch = Scratch::new();
        scratch.lexicon();
        pack("transform/scripts-mode/input", &scratch.path("prepared.zip"));
        let scripts = [("ownerMapping.js", quiet), ("structureMapping.js", quiet), ("layoutMapping.js", quiet), ("utilityMapping.js", quiet), ("data_extractor.js", extractor)];
        zip_of(&scripts, &scratch.path("scripts.zip"));
        let ran = scratch.run(&["transform", "--input-zip", "prepared.zip", "--scripts-zip", "scripts.zip", "--output-zip", "out.zip"]);
        assert_eq!(ran.code, 2, "{extractor}");
        assert!(ran.stderr.contains("Script failed (script=data_extractor.js") && ran.stderr.contains(reason), "{extractor}: {}", ran.stderr);
    }
}

#[test]
fn refuses_option_combinations_that_make_no_sense() {
    let scratch = Scratch::new();
    pack("transform/seed/input", &scratch.path("seed.zip"));
    for (args, reason) in [
        (vec!["--input-zip", "seed.zip", "--transform-version", "2"], "--transform-zip is required for transform v2"),
        (
            vec!["--input-zip", "seed.zip", "--transform-zip", "seed.zip", "--scripts-zip", "seed.zip"],
            "--scripts-zip cannot be used with --transform-zip",
        ),
        (vec!["--input-zip", "missing.zip"], "input-zip not found: missing.zip"),
    ] {
        let mut all = vec!["transform"];
        all.extend(args);
        let ran = scratch.run(&all);
        assert_eq!(ran.code, 2, "{all:?}");
        assert!(ran.stderr.contains(reason), "{all:?}: {}", ran.stderr);
    }
}
