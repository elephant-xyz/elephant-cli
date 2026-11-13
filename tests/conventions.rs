//! Rules every command follows, checked across commands: what goes to stdout,
//! what a closed pipe does to the exit code, and options that cannot apply.

mod support;

use std::process::{Command, Stdio};
use support::Scratch;

fn prepared() -> Scratch {
    let scratch = Scratch::new();
    scratch.lexicon();
    scratch.copy("validate/bad-value", "bad-value");
    scratch
}

/// Run the CLI with a reader that has already gone away, as in `elephant-cli ... | head -0`.
fn unread(scratch: &Scratch, args: &[&str]) -> (i32, String) {
    let mut child = Command::new(env!("CARGO_BIN_EXE_elephant-cli"))
        .args(args)
        .current_dir(&scratch.0)
        .env("ELEPHANT_SCHEMA_CACHE_DIR", scratch.path("schemas"))
        .env("ELEPHANT_OFFLINE", "1")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    drop(child.stdout.take());
    let output = child.wait_with_output().unwrap();
    (output.status.code().unwrap_or(-1), String::from_utf8_lossy(&output.stderr).into_owned())
}

#[test]
fn keeps_its_exit_code_when_nobody_reads_stdout() {
    let scratch = prepared();
    // the findings as CSV on stdout, and the text report on stdout: the property has one finding either way
    for args in [vec!["validate", "bad-value", "--output-csv", "-"], vec!["validate", "bad-value", "--output-csv", "errors.csv"]]
    {
        let (code, stderr) = unread(&scratch, &args);
        assert_eq!(code, 1, "{args:?}: {stderr}");
        assert!(!stderr.contains("Broken pipe") && !stderr.contains("panicked"), "{args:?}: {stderr}");
    }
}

#[test]
fn refuses_json_and_csv_both_on_stdout() {
    let scratch = prepared();
    let ran = scratch.run(&["--json", "validate", "bad-value", "--output-csv", "-"]);
    assert_eq!(ran.code, 2, "{}", ran.stdout);
    assert!(ran.json()["error"].as_str().unwrap().contains("--json and --output-csv - both write to stdout"), "{}", ran.stdout);
}

#[test]
fn refuses_schema_options_on_commands_that_read_no_schemas() {
    let scratch = prepared();
    for args in [
        vec!["--offline", "upload", "county.car"],
        vec!["upload", "county.car", "--schema-cache", "schemas"],
        vec!["prepare", "seed.zip", "--output-zip", "out.zip", "--offline"],
        vec!["--schema-cache", "schemas", "prepare", "seed.zip", "--output-zip", "out.zip"],
    ] {
        let ran = scratch.run(&args);
        assert_eq!(ran.code, 2, "{args:?}");
        assert!(ran.stderr.contains("does not apply to"), "{args:?}: {}", ran.stderr);
    }
}
