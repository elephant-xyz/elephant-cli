//! `elephant-cli validate <county.car>`: the six checks on a county archive.

mod support;

use serde_json::{json, Value};
use support::county::{build, schemas, Tweaks};
use support::Scratch;

/// Validate `county.car` in the scratch directory; returns the exit code and the JSON summary.
fn validate(scratch: &Scratch) -> (i32, Value) {
    let ran = scratch.run(&["--json", "validate", "county.car", "--output-csv", "errors.csv"]);
    (ran.code, ran.json())
}

fn clean() -> Value {
    json!({ "integrity": 0, "root": 0, "index": 0, "graph": 0, "lexicon": 0, "orphans": 0 })
}

#[test]
fn passes_a_well_formed_county_car_with_the_right_counts() {
    let scratch = Scratch::new();
    let ids = schemas(&scratch);
    build(&scratch.path("county.car"), &ids, Tweaks::default());
    let (code, summary) = validate(&scratch);
    assert_eq!(code, 0);
    assert_eq!(summary["valid"], true);
    assert_eq!(summary["blocks"], 10);
    assert_eq!(summary["properties"], 2);
    assert_eq!(summary["data_groups"], 2);
    assert_eq!(summary["lookups"], 0);
    assert_eq!(summary["errors"], clean());
    assert_eq!(scratch.rows("errors.csv"), Vec::<Vec<String>>::new());
}

/// Build the county with `tweaks`, validate it, and return what the CLI said and wrote.
fn check(tweaks: Tweaks) -> (Scratch, support::county::County, support::county::Schemas, i32, Value) {
    let scratch = Scratch::new();
    let ids = schemas(&scratch);
    let county = build(&scratch.path("county.car"), &ids, tweaks);
    let (code, summary) = validate(&scratch);
    (scratch, county, ids, code, summary)
}

fn errors(changed: &[(&str, u64)]) -> Value {
    let mut errors = clean();
    for (check, count) in changed {
        errors[check] = json!(count);
    }
    errors
}

#[test]
fn counts_every_property_when_the_index_has_several_shards() {
    let (scratch, _, _, code, summary) = check(Tweaks { split: true, ..Tweaks::default() });
    assert_eq!((code, &summary["blocks"], &summary["properties"]), (0, &json!(11), &json!(2)));
    assert_eq!(summary["errors"], clean());
    assert!(scratch.rows("errors.csv").is_empty());
}

#[test]
fn follows_a_link_into_a_block_stored_under_another_shard() {
    let (_, _, _, code, summary) = check(Tweaks { shared: true, ..Tweaks::default() });
    // one block, property a's address, is looked up from property b's shard
    assert_eq!((code, &summary["lookups"], &summary["errors"]), (0, &json!(1), &clean()));
}

#[test]
fn does_not_call_a_spare_copy_of_a_linked_block_an_orphan() {
    let (_, _, _, code, summary) = check(Tweaks { spare: true, ..Tweaks::default() });
    assert_eq!((code, &summary["blocks"], &summary["errors"]), (0, &json!(12), &clean()));
}

#[test]
fn does_not_call_a_block_an_orphan_when_an_earlier_shard_links_to_it() {
    let (_, _, _, code, summary) = check(Tweaks { trailing: true, ..Tweaks::default() });
    assert_eq!((code, &summary["blocks"], &summary["lookups"], &summary["errors"]), (0, &json!(11), &json!(1), &clean()));
}

#[test]
fn does_not_call_a_block_an_orphan_when_a_later_shard_links_to_it() {
    let (_, _, _, code, summary) = check(Tweaks { late: true, ..Tweaks::default() });
    assert_eq!((code, &summary["blocks"], &summary["lookups"], &summary["errors"]), (0, &json!(11), &json!(1), &clean()));
}

#[test]
fn checks_a_root_first_file_without_indexing_it() {
    let (_, _, _, code, summary) = check(Tweaks { reversed: true, ..Tweaks::default() });
    assert_eq!((code, &summary["lookups"], &summary["errors"]), (0, &json!(0), &clean()));
    let (scratch, county, _, code, summary) = check(Tweaks { reversed: true, bad: true, ..Tweaks::default() });
    assert_eq!((code, &summary["errors"]), (1, &errors(&[("lexicon", 1)])));
    let rows = scratch.rows("errors.csv");
    assert_eq!(rows.iter().map(|row| row[0].clone()).collect::<Vec<_>>(), [county.blocks[4].cid.to_string()]);
}

#[test]
fn checks_a_gateway_export_without_indexing_it() {
    let scratch = Scratch::new();
    let ids = schemas(&scratch);
    build(&scratch.path("county.car"), &ids, Tweaks { exported: true, ..Tweaks::default() });
    let ran = scratch.run(&["--json", "validate", "county.car", "--output-csv", "errors.csv"]);
    let summary = ran.json();
    assert_eq!((ran.code, &summary["blocks"], &summary["properties"]), (0, &json!(11), &json!(2)));
    assert_eq!((&summary["lookups"], &summary["errors"]), (&json!(0), &clean()));
    assert!(!ran.stderr.contains("indexing the whole file"), "{}", ran.stderr);
}

#[test]
fn reports_a_block_whose_bytes_were_altered() {
    let scratch = Scratch::new();
    let ids = schemas(&scratch);
    let county = build(&scratch.path("county.car"), &ids, Tweaks::default());
    let mut bytes = std::fs::read(scratch.path("county.car")).unwrap();
    let at = bytes.windows(8).position(|window| window == b"parcel-a").unwrap();
    bytes[at + 7] = b'z';
    std::fs::write(scratch.path("county.car"), bytes).unwrap();
    let (code, summary) = validate(&scratch);
    assert_eq!((code, &summary["errors"]["integrity"], &summary["errors"]["orphans"]), (1, &json!(1), &json!(0)));
    let rows = scratch.rows("errors.csv");
    assert_eq!(rows.iter().map(|row| row[2].clone()).collect::<Vec<_>>(), [county.blocks[2].cid.to_string()]);
}

#[test]
fn reports_a_link_that_does_not_resolve_inside_the_car() {
    let scratch = Scratch::new();
    let ids = schemas(&scratch);
    let county = build(&scratch.path("county.car"), &ids, Tweaks { dangling: true, ..Tweaks::default() });
    let ran = scratch.run(&["--json", "validate", "county.car", "--output-csv", "errors.csv"]);
    assert_eq!((ran.code, &ran.json()["errors"]), (1, &errors(&[("graph", 1)])));
    // a missing block must not cost an index of the whole file
    assert!(!ran.stderr.contains("indexing the whole file"), "{}", ran.stderr);
    let rows = scratch.rows("errors.csv");
    assert_eq!(rows[0][2], county.blocks[7].cid.to_string());
    assert_eq!(rows[0][3], "graph");
    assert!(rows[0][4].contains(&county.nowhere.to_string()));
}

#[test]
fn reports_a_block_unreachable_from_the_root_as_an_orphan() {
    let (scratch, county, _, code, summary) = check(Tweaks { extra: true, ..Tweaks::default() });
    assert_eq!((code, &summary["blocks"], &summary["errors"]), (1, &json!(11), &errors(&[("orphans", 1)])));
    let rows = scratch.rows("errors.csv");
    assert_eq!(rows.iter().map(|row| row[2].clone()).collect::<Vec<_>>(), [county.blocks[10].cid.to_string()]);
}

#[test]
fn reports_every_other_block_as_an_orphan_when_the_index_lists_no_shards() {
    let (_, _, _, code, summary) = check(Tweaks { unlisted: true, ..Tweaks::default() });
    assert_eq!((code, &summary["properties"], &summary["data_groups"]), (1, &json!(0), &json!(0)));
    assert_eq!(summary["errors"], errors(&[("index", 1), ("orphans", 9)]));
}

#[test]
fn reads_a_shard_once_for_each_time_the_index_lists_it() {
    let (scratch, county, _, code, summary) = check(Tweaks { twice: true, ..Tweaks::default() });
    assert_eq!((code, &summary["properties"], &summary["data_groups"]), (1, &json!(4), &json!(4)));
    assert_eq!(summary["errors"], errors(&[("index", 1)]));
    let rows = scratch.rows("errors.csv");
    assert_eq!(
        rows.iter().map(|row| (row[2].as_str(), row[4].as_str())).collect::<Vec<_>>(),
        [(county.root.to_string().as_str(), "index declares 2 properties but shards hold 4")]
    );
}

#[test]
fn reports_a_listed_shard_that_is_not_in_the_car() {
    let scratch = Scratch::new();
    let ids = schemas(&scratch);
    let county = build(&scratch.path("county.car"), &ids, Tweaks { gone: true, ..Tweaks::default() });
    let ran = scratch.run(&["--json", "validate", "county.car", "--output-csv", "errors.csv"]);
    let summary = ran.json();
    assert_eq!((ran.code, &summary["properties"], &summary["data_groups"]), (1, &json!(1), &json!(1)));
    assert_eq!(summary["errors"], errors(&[("index", 2), ("orphans", 4)]));
    assert!(!ran.stderr.contains("indexing the whole file"), "{}", ran.stderr);
    let rows = scratch.rows("errors.csv");
    let found: Vec<_> = rows.iter().filter(|row| row[3] == "index").collect();
    assert_eq!(found.iter().map(|row| row[2].clone()).collect::<Vec<_>>(), [county.root.to_string(), county.root.to_string()]);
    assert!(found[0][4].contains("is not in the car"));
    assert_eq!(found[1][4], "index declares 2 properties but shards hold 1");
}

#[test]
fn fails_lexicon_on_a_pointer_missing_from_the_car() {
    let (scratch, county, _, code, summary) = check(Tweaks { lost: true, ..Tweaks::default() });
    assert_eq!(code, 1);
    assert_eq!(summary["errors"], errors(&[("graph", 1), ("lexicon", 1), ("orphans", 3)]));
    let rows = scratch.rows("errors.csv");
    let row = rows.iter().find(|row| row[3] == "root").expect("a lexicon row filed under root");
    assert_eq!(row[0], county.blocks[4].cid.to_string());
    assert!(row[4].contains(&format!("block {} is not in the car", county.nowhere)), "{}", row[4]);
}

#[test]
fn rejects_a_path_that_is_not_a_readable_file() {
    let scratch = Scratch::new();
    let ran = scratch.run(&["validate", "missing.car", "--output-csv", "errors.csv"]);
    assert_eq!(ran.code, 2);
    assert!(ran.stderr.contains("is not a readable file"), "{}", ran.stderr);
    assert!(!scratch.path("errors.csv").exists());
}

#[test]
fn reports_a_data_group_root_that_fails_its_schema() {
    let (scratch, county, ids, code, summary) = check(Tweaks { bad: true, ..Tweaks::default() });
    assert_eq!((code, &summary["data_groups"], &summary["errors"]), (1, &json!(2), &errors(&[("lexicon", 1)])));
    let rows = scratch.rows("errors.csv");
    assert_eq!((rows[0][0].clone(), rows[0][1].clone()), (county.blocks[4].cid.to_string(), ids.group));
    assert!(rows[0][3].contains("parcel_identifier"), "{}", rows[0][3]);
}

#[test]
fn accepts_a_block_written_twice_under_one_shard() {
    let (scratch, _, _, code, summary) = check(Tweaks { doubled: true, ..Tweaks::default() });
    assert_eq!((code, &summary["blocks"], &summary["errors"]), (0, &json!(11), &clean()));
    assert!(scratch.rows("errors.csv").is_empty());
}

#[test]
fn reports_a_missing_data_group_under_index_even_when_an_earlier_block_links_to_it() {
    let (scratch, county, ids, code, summary) = check(Tweaks { claimed: true, ..Tweaks::default() });
    assert_eq!((code, &summary["blocks"]), (1, &json!(11)));
    assert_eq!(summary["errors"], errors(&[("index", 1), ("lexicon", 1)]));
    let rows = scratch.rows("errors.csv");
    let found = rows.iter().find(|row| row[3] == "index").expect("an index row");
    // the row names the property, the data group and the shard, not the earlier block
    assert_eq!(found[..3], [county.blocks[5].cid.to_string(), ids.seed, county.blocks[9].cid.to_string()]);
    assert!(found[4].contains(&county.nowhere.to_string()));
}

#[test]
fn prints_a_text_report_and_exits_by_the_result() {
    let scratch = Scratch::new();
    let ids = schemas(&scratch);
    build(&scratch.path("county.car"), &ids, Tweaks::default());
    // the invocation atlas uses: `validate <file> --output-csv <csv>`, exit status 0 when clean
    let ran = scratch.run(&["validate", "county.car", "--output-csv", "errors.csv"]);
    assert_eq!(ran.code, 0);
    assert!(ran.stdout.contains("Blocks:                 10"), "{}", ran.stdout);
    assert!(ran.stdout.contains("orphans errors:         0"), "{}", ran.stdout);
    assert!(ran.stdout.contains("CAR passed every check"), "{}", ran.stdout);
    build(&scratch.path("county.car"), &ids, Tweaks { extra: true, ..Tweaks::default() });
    let ran = scratch.run(&["validate", "county.car", "--output-csv", "errors.csv"]);
    assert_eq!(ran.code, 1);
    assert!(ran.stdout.contains("orphans errors:         1"), "{}", ran.stdout);
    assert!(ran.stdout.contains("1 errors found. Check errors.csv for details."), "{}", ran.stdout);
}

#[test]
fn writes_the_findings_to_stdout_when_asked() {
    let scratch = Scratch::new();
    let ids = schemas(&scratch);
    let county = build(&scratch.path("county.car"), &ids, Tweaks { extra: true, ..Tweaks::default() });
    let ran = scratch.run(&["validate", "county.car", "--output-csv", "-"]);
    assert_eq!(ran.code, 1);
    let lines: Vec<&str> = ran.stdout.lines().collect();
    assert_eq!(lines[0], "property_cid,data_group_cid,file_path,error_path,error_message,currentValue,timestamp");
    assert!(lines[1].starts_with(&format!(",,{},orphans,block is not reachable from the root,,", county.blocks[10].cid)));
    assert_eq!(lines.len(), 2);
    // the report moves to stderr so stdout stays a clean CSV
    assert!(ran.stderr.contains("orphans errors:         1"), "{}", ran.stderr);
}
