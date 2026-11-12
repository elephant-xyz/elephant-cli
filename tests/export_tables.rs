//! `elephant-cli export-tables`: a county CAR as Parquet tables.
//!
//! The archive, the expected columns and rows (tests/fixtures/export-tables/
//! expected-tables.json) and the summaries come from elephant-cli 1.58.1.

mod support;

use parquet::file::reader::{FileReader, SerializedFileReader};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::path::Path;
use support::{fixtures, Scratch};

fn fixture(name: &str) -> Value {
    serde_json::from_slice(&std::fs::read(fixtures().join("export-tables").join(name)).unwrap()).unwrap()
}

/// Column names with physical types, and rows as JSON, of every part of a table in order.
fn table(dir: &Path) -> (Vec<(String, String)>, Vec<Value>) {
    let mut parts: Vec<_> = std::fs::read_dir(dir).unwrap().map(|entry| entry.unwrap().path()).collect();
    parts.sort();
    let mut columns = Vec::new();
    let mut rows = Vec::new();
    for part in parts {
        let reader = SerializedFileReader::new(std::fs::File::open(part).unwrap()).unwrap();
        let schema = reader.metadata().file_metadata().schema_descr();
        columns = schema.columns().iter().map(|column| (column.name().to_string(), column.physical_type().to_string())).collect();
        rows.extend(reader.get_row_iter(None).unwrap().map(|row| row.unwrap().to_json_value()));
    }
    (columns, rows)
}

/// The dump of the 1.x parts printed 64-bit integers as `"7n"`.
fn plain(value: &Value) -> Value {
    match value {
        Value::String(text) if text.ends_with('n') && text[..text.len() - 1].parse::<i64>().is_ok() => {
            json!(text[..text.len() - 1].parse::<i64>().unwrap() as f64)
        }
        Value::Number(number) => json!(number.as_f64()),
        Value::Object(fields) => fields.iter().map(|(key, value)| (key.clone(), plain(value))).collect(),
        other => other.clone(),
    }
}

fn export(scratch: &Scratch, extra: &[&str]) -> support::Ran {
    scratch.lexicon();
    scratch.copy("export-tables", "in");
    let mut args = vec!["--json", "export-tables", "in/county.car", "--output", "tables"];
    args.extend(extra);
    scratch.run(&args)
}

#[test]
fn exports_the_tables_columns_and_rows_elephant_cli_1_exported() {
    let scratch = Scratch::new();
    let ran = export(&scratch, &["--output-json", "export.json"]);
    assert_eq!(ran.code, 0, "{}", ran.stderr);
    let summary = ran.json();
    let golden = fixture("export.json");
    assert_eq!(summary["tables"], golden["tables"], "tables, rows and parts, in the order first written");
    assert_eq!((&summary["countyRoot"], &summary["parts"]), (&golden["countyRoot"], &golden["parts"]));
    assert_eq!((&summary["partSizeBytes"], &summary["codec"]), (&json!(1073741824u64), &json!("zstd")));
    assert_eq!(serde_json::from_str::<Value>(&scratch.text("export.json")).unwrap(), summary);

    let expected = fixture("expected-tables.json");
    for (name, rows) in expected["rows"].as_object().unwrap() {
        let (columns, found) = table(&scratch.path("tables").join(name));
        let wanted: Vec<(String, String)> = expected["columns"][name]
            .as_array()
            .unwrap()
            .iter()
            .map(|column| (column[0].as_str().unwrap().to_string(), column[1].as_str().unwrap().to_string()))
            .collect();
        assert_eq!(columns, wanted, "{name} columns");
        let found: Vec<Value> = found.iter().map(plain).collect();
        let rows: Vec<Value> = rows.as_array().unwrap().iter().map(plain).collect();
        assert_eq!(found, rows, "{name} rows");
    }
}

#[test]
fn records_every_part_by_cid_in_tables_car() {
    let scratch = Scratch::new();
    let ran = export(&scratch, &[]);
    let summary = ran.json();
    let car = std::fs::read(scratch.path("tables/tables.car")).unwrap();
    // one block: the CountyTables document, as compact JSON after the header and the block's CID
    let start = car.windows(8).position(|window| window == b"{\"codec\"").unwrap();
    let document: Value = serde_json::from_slice(&car[start..]).unwrap();
    assert_eq!(document["label"], "CountyTables");
    assert_eq!(document["county_root"]["/"], summary["countyRoot"]);
    let names: Vec<&String> = document["tables"].as_object().unwrap().keys().collect();
    let mut sorted = names.clone();
    sorted.sort();
    assert_eq!(names, sorted, "tables by name");
    let hash = Sha256::digest(&car[start..]);
    let root = cid::Cid::new_v1(0x0129, cid::multihash::Multihash::<64>::wrap(0x12, &hash).unwrap());
    assert_eq!(summary["root"], root.to_string());
    for (name, table) in document["tables"].as_object().unwrap() {
        let bytes = std::fs::read(scratch.path("tables").join(name).join("part-00000.parquet")).unwrap();
        let part = &table["parts"][0];
        // a part of one chunk is a raw block: its CID is the hash of the file
        let raw = cid::Cid::new_v1(0x55, cid::multihash::Multihash::<64>::wrap(0x12, &Sha256::digest(&bytes)).unwrap());
        assert_eq!((&part["cid"]["/"], &part["bytes"]), (&json!(raw.to_string()), &json!(bytes.len())), "{name}");
        assert_eq!(part["rows"], table["rows"]);
    }
    assert!(ran.stderr.is_empty(), "{}", ran.stderr);
}

#[test]
fn splits_tables_into_parts_where_elephant_cli_1_did() {
    let scratch = Scratch::new();
    let ran = export(&scratch, &["--part-size", "300"]);
    let golden = fixture("small.json");
    let summary = ran.json();
    assert_eq!((&summary["tables"], &summary["parts"]), (&golden["tables"], &golden["parts"]));
    let expected = fixture("expected-tables.json");
    let (_, rows) = table(&scratch.path("tables/tax"));
    assert_eq!(rows.iter().map(plain).collect::<Vec<_>>(), expected["rows"]["tax"].as_array().unwrap().iter().map(plain).collect::<Vec<_>>());
}

#[test]
fn writes_a_new_atlas_page() {
    let scratch = Scratch::new();
    scratch.lexicon();
    scratch.copy("export-tables", "in");
    let ran = scratch.run(&[
        "export-tables", "in/county.car", "--output", "tables", "--atlas-page", "atlas/counties/IL/test.json",
        "--county", "test", "--state", "IL", "--fips", "17161",
    ]);
    assert_eq!(ran.code, 0, "{}", ran.stderr);
    let lines: Vec<&str> = ran.stdout.lines().collect();
    assert!(lines[0].starts_with("Tables written: tables (8 tables, 8 parts, root baguqeera"), "{}", ran.stdout);
    assert_eq!(lines[1], "Atlas page written: atlas/counties/IL/test.json group county");
    let root = lines[0].rsplit(' ').next().unwrap().trim_end_matches(')');
    let golden = fixture("page.json");
    let text = scratch.text("atlas/counties/IL/test.json");
    // the page 1.x wrote, but for the tables root: the Parquet encoder differs
    let mut expected = golden.clone();
    expected["groups"]["county"]["tables"] = json!(root);
    assert_eq!(text, format!("{}\n", serde_json::to_string_pretty(&expected).unwrap()));
}

#[test]
fn updates_an_existing_atlas_page_in_place() {
    let scratch = Scratch::new();
    let ran = export(&scratch, &["--atlas-page", "in/existing.before.json"]);
    assert_eq!(ran.code, 0, "{}", ran.stderr);
    let mut expected = fixture("existing.json");
    expected["groups"]["county"]["tables"] = ran.json()["root"].clone();
    let text = scratch.text("in/existing.before.json");
    assert_eq!(text, format!("{}\n", serde_json::to_string_pretty(&expected).unwrap()));
}

#[test]
fn refuses_bad_options_before_writing_tables() {
    let scratch = Scratch::new();
    for (extra, reason) in [
        (vec!["--part-size", "1.5g"], "--part-size must be a positive byte count such as 1g, got 1.5g"),
        (vec!["--atlas-page", "page.json", "--county", "test", "--state", "IL"], "--fips is required to create page.json"),
        (vec!["--atlas-page", "page.json", "--county", "t", "--state", "il", "--fips", "17161"], "--state must be a two-letter code, got il"),
        (vec!["--atlas-page", "in/existing.before.json", "--fips", "99999"], "--fips 99999 does not match fips \"17161\" in in/existing.before.json"),
    ] {
        let ran = export(&scratch, &extra);
        assert_eq!(ran.code, 2, "{extra:?}");
        assert!(ran.stderr.contains(reason), "{extra:?}: {}", ran.stderr);
        assert!(!scratch.path("tables/properties").exists(), "{extra:?}");
    }
}
