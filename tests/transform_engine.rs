//! County scripts were written for Node. These tests hold the embedded engine
//! to Node's answers for what the scripts rely on.
//!
//! Each case under tests/fixtures/transform/engine is a script that reports
//! what it observed in `data/probe.json`; `<case>.json` is what Node reported
//! for the same file (`golden.sh` there writes it).

mod support;

use serde_json::Value;
use support::{entries, fixtures, pack, zip_of, Scratch};

/// What Node reported for a case.
fn node(case: &str) -> Value {
    let file = fixtures().join("transform/engine").join(format!("{case}.json"));
    serde_json::from_slice::<Value>(&std::fs::read(file).unwrap()).unwrap()["checks"].clone()
}

/// Run a case as a county's `data_extractor.js`; returns what it reported.
fn engine(scratch: &Scratch, case: &str, extra: &[&str], env: &[(&str, &str)]) -> Value {
    scratch.lexicon();
    pack("transform/scripts-mode/input", &scratch.path("prepared.zip"));
    let source = std::fs::read_to_string(fixtures().join("transform/engine").join(format!("{case}.js"))).unwrap();
    zip_of(
        &[
            ("ownerMapping.js", ""),
            ("structureMapping.js", ""),
            ("layoutMapping.js", ""),
            ("utilityMapping.js", ""),
            ("data_extractor.js", &source),
        ],
        &scratch.path("scripts.zip"),
    );
    let mut args = vec!["transform", "--input-zip", "prepared.zip", "--scripts-zip", "scripts.zip", "--output-zip", "out.zip"];
    args.extend(extra);
    let mut vars = vec![("TZ", "UTC")];
    vars.extend(env);
    let ran = scratch.run_with(&args, &vars);
    assert_eq!(ran.code, 0, "{}", ran.stderr);
    serde_json::from_slice::<Value>(&entries(&scratch.path("out.zip"))["data/probe.json"]).unwrap()["checks"].clone()
}

/// Every check of a case, compared one by one so a failure names the check.
fn same(case: &str) {
    let scratch = Scratch::new();
    let found = engine(&scratch, case, &[], &[]);
    let wanted = node(case);
    let differing: Vec<String> = wanted
        .as_object()
        .unwrap()
        .iter()
        .filter(|(name, value)| found.get(name.as_str()) != Some(value))
        .map(|(name, value)| {
            format!("{name}:\n  node    {value}\n  engine  {}", found.get(name.as_str()).unwrap_or(&Value::Null))
        })
        .collect();
    assert!(differing.is_empty(), "{case} differs from Node:\n{}", differing.join("\n"));
}

#[test]
fn runs_the_main_function_a_script_guards_with_require_main() {
    same("main");
}
