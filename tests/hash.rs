//! `elephant-cli hash`: turn property outputs into content-addressed blocks,
//! a CSV of data-group CIDs, hashed ZIPs and a county CAR.
//!
//! Expected outputs under tests/fixtures/hash/*/expected were written by
//! elephant-cli 1.58.1 from the same inputs.

mod support;

use serde_json::json;
use support::{entries, fixtures, Scratch};

fn lines(text: &str) -> Vec<&str> {
    text.lines().filter(|line| !line.is_empty()).collect()
}

#[test]
fn hashes_one_property_to_the_same_bytes_as_elephant_cli_1() {
    let scratch = Scratch::new();
    scratch.lexicon();
    scratch.copy("hash/single/property", "property");
    let expected = fixtures().join("hash/single/expected");
    let ran = scratch.run(&[
        "hash",
        "property",
        "--output-zip",
        "out/hashed.zip",
        "--output-csv",
        "out/hash.csv",
        "--output-car",
        "out/county.car",
    ]);
    assert_eq!(ran.code, 0, "{}", ran.stderr);
    assert_eq!(std::fs::read(scratch.path("out/county.car")).unwrap(), std::fs::read(expected.join("county.car")).unwrap());
    let golden = std::fs::read_to_string(expected.join("hash.csv")).unwrap();
    assert_eq!(lines(&scratch.text("out/hash.csv")), lines(&golden));
    assert_eq!(entries(&scratch.path("out/hashed.zip")), entries(&expected.join("hashed.zip")));
    // the line the publication workflow records
    assert!(
        ran.stdout.contains(
            "CAR written: out/county.car (9 blocks, root baguqeeravrfftlcbyywadhwayvslzxzsbko7zekvxll2izwcxqggykouhtlq)"
        ),
        "{}",
        ran.stdout
    );
}

#[test]
fn hashes_a_directory_of_properties_to_the_same_bytes_as_elephant_cli_1() {
    let scratch = Scratch::new();
    scratch.lexicon();
    scratch.copy("hash/batch/county", "county");
    let expected = fixtures().join("hash/batch/expected");
    let ran = scratch.run(&[
        "hash",
        "county",
        "--output-zip",
        "out/hashed",
        "--output-csv",
        "out/hash.csv",
        "--output-car",
        "out/county.car",
    ]);
    assert_eq!(ran.code, 0, "{}", ran.stderr);
    assert_eq!(std::fs::read(scratch.path("out/county.car")).unwrap(), std::fs::read(expected.join("county.car")).unwrap());
    let golden = std::fs::read_to_string(expected.join("hash.csv")).unwrap();
    assert_eq!(lines(&scratch.text("out/hash.csv")), lines(&golden));
    for name in ["prop-a.zip", "prop-b.zip"] {
        assert_eq!(entries(&scratch.path("out/hashed").join(name)), entries(&expected.join("hashed").join(name)), "{name}");
    }
    assert_eq!(
        lines(&ran.stdout),
        [
            "CAR written: out/county.car (20 blocks, root baguqeeralqy4yywn4wf3ovrbb5j2ozhtucwb2mojvtjzupepafzezenwn6oq)",
            "Properties processed: 2, succeeded: 2, failed: 0",
        ]
    );
}

#[test]
fn writes_a_car_that_validate_accepts() {
    let scratch = Scratch::new();
    scratch.lexicon();
    scratch.copy("validate/clean", "county/first");
    scratch.copy("validate/clean", "county/second");
    let ran = scratch.run(&[
        "--json",
        "hash",
        "county",
        "--output-zip",
        "hashed",
        "--output-csv",
        "hash.csv",
        "--output-car",
        "county.car",
    ]);
    let summary = ran.json();
    assert_eq!((ran.code, &summary["properties"], &summary["data_groups"]), (0, &json!(2), &json!(4)), "{}", ran.stderr);
    let checked = scratch.run(&["--json", "validate", "county.car", "--output-csv", "errors.csv"]);
    let report = checked.json();
    assert_eq!(checked.code, 0, "{}", scratch.text("errors.csv"));
    assert_eq!((&report["properties"], &report["data_groups"]), (&json!(2), &json!(4)));
    assert_eq!(report["blocks"], summary["car"]["blocks"]);
}

#[test]
fn fails_a_property_whose_link_cannot_be_followed() {
    let scratch = Scratch::new();
    scratch.lexicon();
    scratch.copy("hash/single/property", "property");
    std::fs::remove_file(scratch.path("property/parcel.json")).unwrap();
    std::fs::write(scratch.path("property/page.html"), "<html></html>").unwrap();
    let county = scratch.text("property/county.json").replace("./relationship_property_has_address.json", "./page.html");
    std::fs::write(scratch.path("property/county.json"), county).unwrap();
    let ran = scratch.run(&["--json", "hash", "property", "--output-zip", "hashed.zip", "--output-csv", "hash.csv"]);
    let summary = ran.json();
    assert_eq!((ran.code, &summary["ok"], &summary["data_groups"]), (1, &json!(false), &json!(0)));
    let errors: Vec<&str> = summary["errors"].as_array().unwrap().iter().map(|error| error.as_str().unwrap()).collect();
    assert_eq!(errors.len(), 2);
    assert!(
        errors[0].starts_with("property: seed.json: Processing error: ENOENT: no such file or directory, open '"),
        "{}",
        errors[0]
    );
    assert!(errors[0].ends_with("/property/parcel.json'"), "{}", errors[0]);
    assert_eq!(
        errors[1],
        "property: county.json: Processing error: cannot link ./page.html: only JSON and image files can be linked"
    );
    assert!(ran.stderr.contains("error: property: county.json: Processing error: cannot link"), "{}", ran.stderr);
}

#[test]
fn keeps_going_past_a_property_without_a_seed_and_leaves_it_out_of_the_car() {
    let scratch = Scratch::new();
    scratch.lexicon();
    scratch.copy("hash/single/property", "county/good");
    scratch.copy("hash/single/property", "county/bad");
    std::fs::remove_file(scratch.path("county/bad/seed.json")).unwrap();
    let ran = scratch.run(&[
        "--json",
        "hash",
        "county",
        "--output-zip",
        "hashed",
        "--output-csv",
        "hash.csv",
        "--output-car",
        "county.car",
    ]);
    let summary = ran.json();
    assert_eq!((ran.code, &summary["failed"], &summary["succeeded"]), (1, &json!(["bad"]), &json!(1)));
    assert!(ran.stderr.contains("1 of 2 properties failed: bad"), "{}", ran.stderr);
    // the good property alone gives the single-property archive
    let single = fixtures().join("hash/single/expected/county.car");
    assert_eq!(std::fs::read(scratch.path("county.car")).unwrap(), std::fs::read(single).unwrap());
    assert!(!scratch.path("hashed/bad.zip").exists());
}

#[test]
fn refuses_a_file_as_the_zip_output_of_a_batch() {
    let scratch = Scratch::new();
    scratch.lexicon();
    scratch.copy("hash/batch/county", "county");
    std::fs::write(scratch.path("hashed.zip"), "").unwrap();
    let ran = scratch.run(&["hash", "county", "--output-zip", "hashed.zip", "--output-csv", "hash.csv"]);
    assert_eq!(ran.code, 2);
    assert!(ran.stderr.contains("with a directory input it must be a directory"), "{}", ran.stderr);
}

#[test]
fn reports_a_batch_as_a_batch_when_every_property_fails() {
    let scratch = Scratch::new();
    scratch.lexicon();
    scratch.copy("hash/single/property", "county/only");
    std::fs::remove_file(scratch.path("county/only/seed.json")).unwrap();
    let ran = scratch.run(&["hash", "county", "--output-zip", "hashed", "--output-csv", "hash.csv"]);
    assert_eq!(ran.code, 1, "{}", ran.stderr);
    assert_eq!(ran.stdout, "Properties processed: 1, succeeded: 0, failed: 1\n");
    let ran = scratch.run(&["--json", "hash", "county", "--output-zip", "hashed", "--output-csv", "hash.csv"]);
    assert_eq!(ran.json()["kind"], "batch");
}
