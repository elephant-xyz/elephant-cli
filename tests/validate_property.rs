//! `elephant-cli validate <property>`: property outputs against the lexicon.
//!
//! Fixtures and expected rows were produced by elephant-cli 1.58.1 on the
//! same inputs (see tests/fixtures/validate/*.errors.csv).

mod support;

use serde_json::json;
use support::{csv, fixtures, Scratch};

/// The row elephant-cli 1.58.1 wrote for a fixture, without the file path and timestamp.
fn golden(name: &str) -> Vec<Vec<String>> {
    let text = std::fs::read_to_string(fixtures().join("validate").join(format!("{name}.errors.csv"))).unwrap();
    csv(&text).into_iter().map(|row| [&row[..2], &row[3..6]].concat()).collect()
}

fn found(scratch: &Scratch) -> Vec<Vec<String>> {
    scratch.rows("errors.csv").into_iter().map(|row| [&row[..2], &row[3..6]].concat()).collect()
}

fn prepared(fixture: &str) -> Scratch {
    let scratch = Scratch::new();
    scratch.lexicon();
    scratch.copy(&format!("validate/{fixture}"), fixture);
    scratch
}

#[test]
fn passes_a_property_whose_data_groups_match_the_lexicon() {
    let scratch = prepared("clean");
    let ran = scratch.run(&["--json", "validate", "clean", "--output-csv", "errors.csv"]);
    let summary = ran.json();
    assert_eq!(ran.code, 0, "{}", ran.stderr);
    assert_eq!((&summary["kind"], &summary["valid"]), (&json!("property"), &json!(true)));
    assert_eq!((&summary["data_groups"], &summary["error_count"]), (&json!(2), &json!(0)));
    assert!(scratch.rows("errors.csv").is_empty());
}

#[test]
fn reports_a_value_outside_its_enum_as_elephant_cli_1_did() {
    let scratch = prepared("bad-value");
    let ran = scratch.run(&["--json", "validate", "bad-value", "--output-csv", "errors.csv"]);
    assert_eq!((ran.code, &ran.json()["error_count"]), (1, &json!(1)));
    assert_eq!(found(&scratch), golden("bad-value"));
    let rows = scratch.rows("errors.csv");
    assert!(rows[0][2].ends_with("/bad-value/property_management.json"), "{}", rows[0][2]);
}

#[test]
fn reports_a_json_file_no_data_group_reaches() {
    let scratch = prepared("unused-file");
    let ran = scratch.run(&["--json", "validate", "unused-file", "--output-csv", "errors.csv"]);
    assert_eq!((ran.code, &ran.json()["data_groups"]), (1, &json!(2)));
    assert_eq!(found(&scratch), golden("unused-file"));
    assert!(scratch.rows("errors.csv")[0][2].ends_with("/unused-file/orphan.json"));
}

#[test]
fn validates_every_property_of_a_directory_and_summarises() {
    let scratch = prepared("batch");
    let ran = scratch.run(&["validate", "batch", "--output-csv", "errors.csv"]);
    assert_eq!(ran.code, 1);
    // the summary line elephant-cli 1 printed, which the publication workflow records
    assert!(ran.stdout.starts_with("Properties processed: 2, succeeded: 1, failed: 1\n"), "{}", ran.stdout);
    assert!(ran.stderr.contains("1 of 2 properties failed: beta"), "{}", ran.stderr);
    assert_eq!(found(&scratch), golden("batch"));
    let ran = scratch.run(&["--json", "validate", "batch", "--output-csv", "errors.csv"]);
    let summary = ran.json();
    assert_eq!((&summary["kind"], &summary["properties"], &summary["failed"]), (&json!("batch"), &json!(2), &json!(["beta"])));
}

#[test]
fn validates_a_property_zip() {
    let scratch = prepared("batch");
    let ran = scratch.run(&["--json", "validate", "batch/alpha.zip", "--output-csv", "errors.csv"]);
    assert_eq!((ran.code, &ran.json()["data_groups"]), (0, &json!(2)), "{}", ran.stderr);
}

#[test]
fn reports_a_linked_file_that_is_missing() {
    let scratch = prepared("clean");
    std::fs::remove_file(scratch.path("clean/company.json")).unwrap();
    let ran = scratch.run(&["validate", "clean", "--output-csv", "errors.csv"]);
    assert_eq!(ran.code, 1);
    let rows = scratch.rows("errors.csv");
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0][3], "root");
    assert_eq!(
        rows[0][4],
        "Validation error: Failed to resolve pointer - not a valid CID or accessible file path: ./company.json"
    );
    assert!(rows[0][5].starts_with("{\"label\":\"Property Management\""), "{}", rows[0][5]);
}

#[test]
fn says_why_an_input_cannot_be_checked() {
    let scratch = Scratch::new();
    scratch.lexicon();
    std::fs::create_dir(scratch.path("empty")).unwrap();
    std::fs::create_dir(scratch.path("other")).unwrap();
    std::fs::write(scratch.path("other/note.json"), "{\"note\": 1}").unwrap();
    std::fs::write(scratch.path("notes.txt"), "not a zip").unwrap();
    for (input, reason) in [
        ("missing", "is not a readable file"),
        ("empty", "No data group JSON files found in the property directory"),
        ("other", "No files found to validate"),
        ("notes.txt", "is not a directory or a ZIP file"),
    ] {
        let ran = scratch.run(&["--json", "validate", input, "--output-csv", "errors.csv"]);
        assert_eq!(ran.code, 2, "{input}");
        assert!(ran.stderr.contains(reason), "{input}: {}", ran.stderr);
        // with --json the reason is also on stdout, as one document
        assert!(ran.json()["error"].as_str().unwrap().contains(reason), "{input}");
        assert!(!scratch.path("errors.csv").exists(), "{input}");
    }
}

#[test]
fn refuses_a_batch_with_two_properties_of_the_same_name() {
    let scratch = prepared("batch");
    scratch.copy("validate/clean", "batch/alpha");
    let ran = scratch.run(&["validate", "batch", "--output-csv", "errors.csv"]);
    assert_eq!(ran.code, 2);
    assert!(ran.stderr.contains("Duplicate property names in batch: alpha"), "{}", ran.stderr);
}

#[test]
fn fails_a_data_group_whose_schema_cannot_be_loaded_offline() {
    let scratch = prepared("clean");
    // the Property Management data group schema
    std::fs::remove_file(scratch.path("schemas/bafkreigqszh64fy5ra7lrkjytsaefr5iauv36fta2vkscniom4echf2v4y.json")).unwrap();
    let ran = scratch.run(&["validate", "clean", "--output-csv", "errors.csv"]);
    assert_eq!(ran.code, 1);
    let rows = scratch.rows("errors.csv");
    assert_eq!(rows.len(), 1);
    assert!(
        rows[0][4].starts_with("Processing error: schema bafkreigqszh64fy5ra7lrkjytsaefr5iauv36fta2vkscniom4echf2v4y is not in "),
        "{}",
        rows[0][4]
    );
}

#[test]
fn fetches_the_manifest_and_missing_schemas_then_works_offline() {
    use support::http::{ok, serve, status};
    let scratch = Scratch::new();
    scratch.copy("validate/clean", "clean");
    let lexicon = fixtures().join("lexicon");
    // The first gateway serves bytes that do not hash to the CID; the second serves the schema.
    let wrong = serve(|_| ok("{\"type\":\"object\"}"));
    let good = serve(move |request| {
        if request.path == "/manifest" {
            return ok(std::fs::read(lexicon.join("manifest.json")).unwrap());
        }
        let cid = request.path.trim_start_matches("/ipfs/").trim_end_matches("?format=raw");
        match std::fs::read(lexicon.join(format!("{cid}.json"))) {
            Ok(bytes) if request.path.ends_with("?format=raw") => ok(bytes),
            _ => status(404),
        }
    });
    let gateways = format!("{}, {}/", wrong.url, good.url);
    let manifest = format!("{}/manifest", good.url);
    let online = [
        ("ELEPHANT_OFFLINE", "0"),
        ("ELEPHANT_IPFS_GATEWAYS", gateways.as_str()),
        ("ELEPHANT_SCHEMA_MANIFEST_URL", manifest.as_str()),
    ];
    let ran = scratch.run_with(&["--json", "validate", "clean", "--output-csv", "errors.csv"], &online);
    assert_eq!((ran.code, &ran.json()["data_groups"]), (0, &json!(2)), "{}", ran.stderr);
    let asked = good.requests();
    assert!(asked
        .iter()
        .all(|request| request.path == "/manifest" || request.header("accept") == Some("application/vnd.ipld.raw")));
    assert_eq!(asked.len(), 16, "the manifest and 15 schemas, once each");
    // everything fetched was kept: the same run now passes without the network
    let ran = scratch.run(&["--json", "validate", "clean", "--output-csv", "errors.csv"]);
    assert_eq!(ran.code, 0, "{}", ran.stderr);
}

/// The rows of a fixture, ours and those of elephant-cli 1.58.1, in one order.
fn sorted(mut rows: Vec<Vec<String>>) -> Vec<Vec<String>> {
    rows.sort();
    rows
}

#[test]
fn reports_a_failed_then_branch_where_elephant_cli_1_did() {
    // `method` is missing from the seed's request: each `if`/`then` it fails gets a row of its own
    let scratch = prepared("then-branch");
    let ran = scratch.run(&["validate", "then-branch", "--output-csv", "errors.csv"]);
    assert_eq!(ran.code, 1, "{}", ran.stderr);
    assert_eq!(sorted(found(&scratch)), sorted(golden("then-branch")));
}

#[test]
fn names_the_types_a_value_may_have_in_the_order_the_schema_does() {
    let scratch = prepared("type-list");
    let ran = scratch.run(&["validate", "type-list", "--output-csv", "errors.csv"]);
    assert_eq!(ran.code, 1, "{}", ran.stderr);
    assert_eq!(sorted(found(&scratch)), sorted(golden("type-list")));
}

#[test]
fn does_not_validate_against_an_old_manifest_when_the_fetch_fails() {
    let scratch = prepared("clean");
    // online, the lexicon unreachable, and a manifest from an earlier run in the cache
    let online = [("ELEPHANT_OFFLINE", "0"), ("ELEPHANT_SCHEMA_MANIFEST_URL", "http://127.0.0.1:1/manifest")];
    assert!(scratch.path("schemas/manifest.json").is_file());
    let ran = scratch.run_with(&["validate", "clean", "--output-csv", "errors.csv"], &online);
    assert_eq!(ran.code, 2, "{}", ran.stdout);
    assert!(ran.stderr.contains("Failed to load schema manifest from Elephant Network"), "{}", ran.stderr);
    // asked to stay offline, the copy in the cache is what there is
    let ran = scratch.run_with(&["--offline", "validate", "clean", "--output-csv", "errors.csv"], &online);
    assert_eq!(ran.code, 0, "{}", ran.stderr);
}
