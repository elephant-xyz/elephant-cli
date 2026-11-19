//! Packed data groups: `hash --packed` writes one block per data group, and
//! `validate` and `export-tables` read it as they read the linked layout.
//!
//! The vectors under tests/fixtures/packed (and the CIDs below) came from
//! elephant-cli 1.x plus a reference packer, not from this crate: vector 1 is
//! tests/fixtures/hash/single/property, vector 2 adds a list of two tax
//! relationships to it.

mod support;

use parquet::file::reader::{FileReader, SerializedFileReader};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use support::{entries, fixtures, link, node, write_car, zip_dir, Scratch};

const PROPERTY: &str = "baguqeeraslstwpvmi2374m2of5bczxuiq2wkblbbbnwyvxr4fgmpm5dojefq";
const SEED: &str = "bafkreibhurphpjdq33ysit57jtzmdldgngepsdbsw4vm7esawth2ezgaxu";
const COUNTY: &str = "bafkreia6tjziby3upxmidymud5iusd32urrztslgrudkwysc7ydmxoekuq";

/// Input fixture, linked County CID, packed County CID, JSON files in the linked hashed ZIP.
const VECTORS: [(&str, &str, &str, &str, usize); 2] = [
    (
        "hash/single/property",
        "packed/vector-1/packed.json",
        "baguqeerad7ribhalqwds5cm4l4mpclt7cr4qbuyrv3rxex4n5bwvga4pewja",
        "baguqeera23v62rlo33fvnrvqrdnmuikiya4l7gfqrka2ibejfvtroigtaweq",
        7,
    ),
    (
        "packed/vector-2/property",
        "packed/vector-2/packed.json",
        "baguqeerap73zkcd4lmiy2blzhbmh6hwdivicucv7nfi5kqvrh5y2kvg4z5mq",
        "baguqeeratngekt6ads2xrr7m6h5wnub7oikbjjeivydruacc2euzpxmi5uba",
        11,
    ),
];

/// Run `hash` on `property` in the scratch directory, with `extra` options; outputs go to `out/`.
fn hash(scratch: &Scratch, extra: &[&str]) -> support::Ran {
    let mut args = vec![
        "hash",
        "property",
        "--output-zip",
        "out/hashed.zip",
        "--output-csv",
        "out/hash.csv",
        "--output-car",
        "out/county.car",
    ];
    args.extend(extra);
    scratch.run(&args)
}

#[test]
fn packs_a_data_group_into_the_block_the_reference_packer_wrote() {
    for (input, packed, linked, cid, files) in VECTORS {
        let scratch = Scratch::new();
        scratch.lexicon();
        scratch.copy(input, "property");
        let golden = std::fs::read(fixtures().join(packed)).unwrap();

        let ran = hash(&scratch, &["--packed"]);
        assert_eq!(ran.code, 0, "{}", ran.stderr);
        // the Seed data group stays linked: its CID is the property CID
        let seed = [PROPERTY, SEED, PROPERTY, "seed.json", ""].map(str::to_string).to_vec();
        assert_eq!(
            scratch.rows("out/hash.csv"),
            [seed.clone(), [PROPERTY, COUNTY, cid, "county.json", ""].map(str::to_string).to_vec()]
        );
        let zipped = entries(&scratch.path("out/hashed.zip"));
        assert_eq!(zipped.len(), 5, "{input}: {:?}", zipped.keys());
        assert_eq!(zipped[&format!("{PROPERTY}/{cid}.json")], golden, "{input}");
        assert!(ran.stdout.contains("CAR written: out/county.car (7 blocks, root "), "{}", ran.stdout);
        let car = std::fs::read(scratch.path("out/county.car")).unwrap();
        assert!(car.windows(golden.len()).any(|window| window == golden), "{input}: the packed block is in the CAR");

        // without the option the layout is the linked one
        let ran = hash(&scratch, &[]);
        assert_eq!(ran.code, 0, "{}", ran.stderr);
        assert_eq!(
            scratch.rows("out/hash.csv"),
            [seed, [PROPERTY, COUNTY, linked, "county.json", ""].map(str::to_string).to_vec()]
        );
        assert_eq!(entries(&scratch.path("out/hashed.zip")).len(), files, "{input}");
        assert!(ran.stdout.contains(&format!("CAR written: out/county.car ({} blocks, root ", files + 2)), "{}", ran.stdout);
    }
}

#[test]
fn packs_every_property_of_a_directory() {
    let scratch = Scratch::new();
    scratch.lexicon();
    scratch.copy(VECTORS[0].0, "property/one");
    scratch.copy(VECTORS[1].0, "property/two");
    let ran = scratch.run(&[
        "hash",
        "property",
        "--packed",
        "--output-zip",
        "out",
        "--output-csv",
        "out/hash.csv",
        "--output-car",
        "out/county.car",
    ]);
    assert_eq!(ran.code, 0, "{}", ran.stderr);
    let cids: Vec<String> = scratch.rows("out/hash.csv").into_iter().map(|row| row[2].clone()).collect();
    assert_eq!(cids, [PROPERTY, VECTORS[0].3, PROPERTY, VECTORS[1].3]);
    for (name, vector) in [("one", VECTORS[0]), ("two", VECTORS[1])] {
        let zipped = entries(&scratch.path("out").join(format!("{name}.zip")));
        assert_eq!(zipped.len(), 5, "{name}");
        assert_eq!(zipped[&format!("{PROPERTY}/{}.json", vector.3)], std::fs::read(fixtures().join(vector.1)).unwrap());
    }
    // five blocks per property, the shard and the index
    assert!(ran.stdout.contains("CAR written: out/county.car (12 blocks, root "), "{}", ran.stdout);
    assert!(ran.stdout.contains("Properties processed: 2, succeeded: 2, failed: 0"), "{}", ran.stdout);
}

/// What `hash` wrote with and without `--packed`: the CSV and the county CAR.
fn both(scratch: &Scratch) -> [(String, Vec<u8>); 2] {
    [&["--packed"][..], &[]].map(|extra| {
        let ran = hash(scratch, extra);
        assert_eq!(ran.code, 0, "{}", ran.stderr);
        (scratch.text("out/hash.csv"), std::fs::read(scratch.path("out/county.car")).unwrap())
    })
}

#[test]
fn leaves_a_data_group_linked_when_an_entity_holds_a_link() {
    let scratch = Scratch::new();
    scratch.lexicon();
    scratch.copy(VECTORS[0].0, "property");
    let property = scratch.text("property/property.json").replacen('{', "{\"parcel\": {\"/\": \"./parcel.json\"},", 1);
    std::fs::write(scratch.path("property/property.json"), property).unwrap();
    let [packed, linked] = both(&scratch);
    assert!(packed == linked, "{}\n{}", packed.0, linked.0);
}

#[test]
fn leaves_a_data_group_linked_when_a_relationship_holds_another_link() {
    let scratch = Scratch::new();
    scratch.lexicon();
    scratch.copy(VECTORS[0].0, "property");
    let relation =
        "{\"from\": {\"/\": \"./property.json\"}, \"to\": {\"/\": \"./address.json\"}, \"also\": [{\"/\": \"./parcel.json\"}]}";
    std::fs::write(scratch.path("property/relationship_property_has_address.json"), relation).unwrap();
    let [packed, linked] = both(&scratch);
    assert!(packed == linked, "{}\n{}", packed.0, linked.0);
}

#[test]
fn packs_a_block_of_exactly_one_mebibyte_and_leaves_a_bigger_one_linked() {
    // vector 1 packs into 858 bytes; `"pad":"...",` adds 9 and the padding
    for (padding, packed) in [(1_048_576 - 858 - 9, true), (1_048_576 - 858 - 9 + 1, false)] {
        let scratch = Scratch::new();
        scratch.lexicon();
        scratch.copy(VECTORS[0].0, "property");
        let pad = format!("{{\"pad\": \"{}\",", "x".repeat(padding));
        std::fs::write(scratch.path("property/property.json"), scratch.text("property/property.json").replacen('{', &pad, 1))
            .unwrap();
        let ran = hash(&scratch, &["--packed"]);
        assert_eq!(ran.code, 0, "{}", ran.stderr);
        let rows = scratch.rows("out/hash.csv");
        assert_eq!(rows[0][2], PROPERTY);
        let zipped = entries(&scratch.path("out/hashed.zip"));
        let root = &zipped[&format!("{PROPERTY}/{}.json", rows[1][2])];
        assert_eq!(root.starts_with(b"{\"entities\":"), packed, "{padding}");
        if packed {
            assert_eq!((root.len(), zipped.len()), (1_048_576, 5));
            continue;
        }
        assert_eq!(zipped.len(), 7);
        let linked = hash(&scratch, &[]);
        assert_eq!((linked.code, scratch.rows("out/hash.csv")), (0, rows));
    }
}

/// The findings of `validate` on `input`, without where the root is (`file_path`) and the timestamp.
fn findings(scratch: &Scratch, input: &str) -> (i32, Vec<Vec<String>>) {
    let ran = scratch.run(&["validate", input, "--output-csv", "errors.csv"]);
    let rows = scratch.rows("errors.csv").into_iter().map(|mut row| {
        row.pop();
        row.remove(2);
        row
    });
    (ran.code, rows.collect())
}

#[test]
fn validates_a_packed_county_car_like_the_linked_one() {
    // `validate/clean` passes the lexicon; vector 2 has findings in a single relationship and in a list
    for (input, count) in [("validate/clean", 0), (VECTORS[1].0, 7)] {
        let scratch = Scratch::new();
        scratch.lexicon();
        scratch.copy(input, "property");
        let mut found = Vec::new();
        for extra in [&["--packed"][..], &[]] {
            assert_eq!(hash(&scratch, extra).code, 0);
            found.push(findings(&scratch, "out/county.car"));
        }
        assert_eq!(found[0], found[1], "{input}");
        assert_eq!((found[0].0, found[0].1.len()), (i32::from(count > 0), count), "{input}: {:?}", found[0].1);
        // the packed archive, the one validated last but one, counts both data groups
        assert_eq!(hash(&scratch, &["--packed"]).code, 0);
        let summary = scratch.run(&["--json", "validate", "out/county.car", "--output-csv", "errors.csv"]).json();
        assert_eq!((&summary["blocks"], &summary["properties"], &summary["data_groups"]), (&json!(7), &json!(1), &json!(2)));
        assert_eq!(summary["errors"]["lexicon"], count);
    }
}

/// Vector 1's packed block with one thing wrong, and the finding that names it: path and message.
fn corrupted() -> Vec<(Value, String, String)> {
    let packed: Value = serde_json::from_slice(&std::fs::read(fixtures().join(VECTORS[0].1)).unwrap()).unwrap();
    let property = "baguqeera2vep6rq3g4gdjfxkn65fx6g3ztgqoszjbezh5afdikupr23oqzha";
    let address = "baguqeerag55b2l2jd6rdhr7xeyv4bo7skhrry6ng5tj7zm4refxtc6x7numq";
    // an entity of vector 2, under its own CID
    let tax = "baguqeera6ppe63pulpxcwz3l352jgvjooxu5cahinzupqzkob2p5xfhi3hjq";
    let mut cases = Vec::new();

    let mut listed = packed.clone();
    listed["entities"] = json!([]);
    cases.push((listed, "/entities".to_string(), "entities must be an object".to_string()));

    let mut renamed = packed.clone();
    renamed["entities"][address]["county_name"] = json!("Leon");
    // the CID of the changed entity, worked out outside this crate (sha2-256 of its sorted compact JSON, dag-json)
    cases.push((
        renamed,
        format!("/entities/{address}"),
        format!(
            "entity key {address} is not the CID of its value, baguqeeraiur6ovat3colhffjk4bl6mv4q4lb72e2xafrnaotbxybggzyadjq"
        ),
    ));

    let mut dangling = packed.clone();
    dangling["relationships"]["property_has_address"]["to"] = json!(tax);
    dangling["entities"].as_object_mut().unwrap().remove(address);
    cases.push((dangling, "/relationships/property_has_address/to".to_string(), format!("to {tax} is not a key of entities")));

    let mut spare = packed.clone();
    spare["entities"][tax] =
        json!({ "property_assessed_value_amount": 250000.5, "request_identifier": "10203040", "tax_year": 2023 });
    cases.push((spare, format!("/entities/{tax}"), format!("entity {tax} is not referenced by any relationship")));
    assert!(property != address);
    cases
}

#[test]
fn reports_a_badly_packed_root_in_a_county_car() {
    for (packed, path, message) in corrupted() {
        let scratch = Scratch::new();
        scratch.lexicon();
        let root = node(&packed);
        let entry = json!({ "property_cid": link(&root.cid), "data_groups": { COUNTY: link(&root.cid) } });
        let shard = node(&json!({ "properties": [entry] }));
        let index = node(&json!({ "label": "CountyIndex", "version": 1, "properties": 1, "shards": [link(&shard.cid)] }));
        write_car(&scratch.path("county.car"), &index.cid, &[root.clone(), shard, index.clone()]);
        let (code, rows) = findings(&scratch, "county.car");
        let wanted = [root.cid.to_string(), COUNTY.to_string(), path, message, String::new()].to_vec();
        assert_eq!(code, 1);
        assert!(rows.contains(&wanted), "{wanted:?} is not among {rows:?}");
    }
}

/// A property whose County data group is the packed root `county`, next to vector 1's linked Seed data group.
fn property(scratch: &Scratch, county: &[u8]) {
    scratch.copy(VECTORS[0].0, "property");
    for name in ["property.json", "relationship_property_has_address.json"] {
        std::fs::remove_file(scratch.path("property").join(name)).unwrap();
    }
    std::fs::write(scratch.path("property/county.json"), county).unwrap();
}

#[test]
fn validates_a_packed_root_in_a_property_like_the_linked_one() {
    let scratch = Scratch::new();
    scratch.lexicon();
    // the linked property, its list of relationships in the order the hashed root has
    scratch.copy(VECTORS[1].0, "property");
    let county = scratch.text("property/county.json");
    let (first, second) = (county.find("2024").unwrap(), county.find("2023").unwrap());
    let swapped = format!("{}2023{}2024{}", &county[..first], &county[first + 4..second], &county[second + 4..]);
    std::fs::write(scratch.path("property/county.json"), swapped).unwrap();
    // without the value: a file prints as it was written, a packed entity in canonical form
    let found = |input: &str| -> (i32, Vec<Vec<String>>) {
        let (code, rows) = findings(&scratch, input);
        (code, rows.into_iter().map(|row| row[..4].to_vec()).collect())
    };
    let linked = found("property");
    assert_eq!((linked.0, linked.1.len()), (1, 7), "{:?}", linked.1);

    std::fs::remove_dir_all(scratch.path("property")).unwrap();
    property(&scratch, &std::fs::read(fixtures().join(VECTORS[1].1)).unwrap());
    assert_eq!(found("property"), linked);
    zip_dir(&scratch.path("property"), &scratch.path("property.zip"));
    std::fs::remove_dir_all(scratch.path("property")).unwrap();
    assert_eq!(found("property.zip"), linked);
}

#[test]
fn reports_a_badly_packed_root_in_a_property() {
    for (packed, path, message) in corrupted() {
        let scratch = Scratch::new();
        scratch.lexicon();
        property(&scratch, &serde_json::to_vec(&packed).unwrap());
        zip_dir(&scratch.path("property"), &scratch.path("property.zip"));
        let wanted = ["property".to_string(), COUNTY.to_string(), path, message, String::new()].to_vec();
        for input in ["property", "property.zip"] {
            let (code, rows) = findings(&scratch, input);
            assert_eq!(code, 1);
            assert!(rows.contains(&wanted), "{input}: {wanted:?} is not among {rows:?}");
        }
    }
}

/// Every table of a tables directory: its column names and its rows as JSON, over all parts in order.
fn tables(dir: &std::path::Path) -> BTreeMap<String, (Vec<String>, Vec<Value>)> {
    let mut found = BTreeMap::new();
    for entry in std::fs::read_dir(dir).unwrap().map(|entry| entry.unwrap()).filter(|entry| entry.path().is_dir()) {
        let mut parts: Vec<_> = std::fs::read_dir(entry.path()).unwrap().map(|part| part.unwrap().path()).collect();
        parts.sort();
        let mut columns = Vec::new();
        let mut rows = Vec::new();
        for part in parts {
            let reader = SerializedFileReader::new(std::fs::File::open(part).unwrap()).unwrap();
            let schema = reader.metadata().file_metadata().schema_descr();
            columns = schema.columns().iter().map(|column| column.name().to_string()).collect();
            rows.extend(reader.get_row_iter(None).unwrap().map(|row| row.unwrap().to_json_value()));
        }
        found.insert(entry.file_name().to_string_lossy().into_owned(), (columns, rows));
    }
    found
}

#[test]
fn exports_the_same_tables_from_a_packed_county_car() {
    for (input, _, linked, packed, _) in VECTORS {
        let scratch = Scratch::new();
        scratch.lexicon();
        scratch.copy(input, "property");
        let mut exported = Vec::new();
        for extra in [&[][..], &["--packed"]] {
            assert_eq!(hash(&scratch, extra).code, 0);
            let output = format!("tables{}", extra.len());
            let ran = scratch.run(&["export-tables", "out/county.car", "--output", &output]);
            assert_eq!(ran.code, 0, "{input}: {}", ran.stderr);
            exported.push(tables(&scratch.path(&output)));
        }
        let [mut from_linked, mut from_packed] = <[_; 2]>::try_from(exported).unwrap();
        // the index names each property's data groups: the County root is the one block that differs
        let row = |county: &str| json!({ "property_cid": PROPERTY, SEED: PROPERTY, COUNTY: county });
        assert_eq!(from_linked.remove("properties").unwrap().1, [row(linked)], "{input}");
        assert_eq!(from_packed.remove("properties").unwrap().1, [row(packed)], "{input}");
        assert!(from_linked.contains_key("property_has_address") && from_linked.contains_key("property"), "{input}");
        assert_eq!(from_packed, from_linked, "{input}");
    }
}

#[test]
fn hashes_a_property_that_holds_a_packed_root_to_the_same_cid() {
    let scratch = Scratch::new();
    scratch.lexicon();
    property(&scratch, &std::fs::read(fixtures().join(VECTORS[0].1)).unwrap());
    for extra in [&[][..], &["--packed"]] {
        let ran = hash(&scratch, extra);
        assert_eq!(ran.code, 0, "{}", ran.stderr);
        let cids: Vec<String> = scratch.rows("out/hash.csv").into_iter().map(|row| row[2].clone()).collect();
        assert_eq!(cids, [PROPERTY, VECTORS[0].3]);
    }
}

#[test]
fn validates_a_packed_root_whose_json_dag_json_refuses_like_the_linked_one() {
    // 1.x gives a block with a key every JavaScript object inherits a raw CID; so does the block that packs it
    let scratch = Scratch::new();
    scratch.lexicon();
    scratch.copy(VECTORS[0].0, "property");
    let address = scratch.text("property/address.json").replace("\"folio\"", "\"constructor\": [\"x\"], \"folio\"");
    std::fs::write(scratch.path("property/address.json"), address).unwrap();
    let mut found = Vec::new();
    for extra in [&[][..], &["--packed"]] {
        assert_eq!(hash(&scratch, extra).code, 0);
        let summary = scratch.run(&["--json", "validate", "out/county.car", "--output-csv", "errors.csv"]).json();
        found.push((findings(&scratch, "out/county.car"), summary["data_groups"].clone()));
    }
    let county = scratch.rows("out/hash.csv")[1][2].clone();
    assert!(county.starts_with("bafkrei"), "{county}");
    assert_eq!(found[1], found[0]);
    assert_eq!(found[1].1, 2);
}

#[test]
fn says_which_data_groups_it_packed_and_which_it_could_not() {
    let scratch = Scratch::new();
    scratch.lexicon();
    scratch.copy(VECTORS[0].0, "property");
    let run = |extra: &[&str]| {
        let mut args = vec!["--json", "hash", "property", "--output-zip", "out/hashed.zip", "--output-csv", "out/hash.csv"];
        args.extend(extra);
        scratch.run(&args)
    };
    let ran = run(&["--packed"]);
    assert_eq!((&ran.json()["packed"], &ran.json()["not_packed"]), (&json!(1), &json!([])), "{}", ran.stdout);
    assert!(ran.stderr.is_empty(), "{}", ran.stderr);
    let ran = run(&[]);
    assert_eq!((&ran.json()["packed"], &ran.json()["not_packed"]), (&json!(0), &json!([])), "{}", ran.stdout);

    // an entity that links a file: the data group stays linked, and the run says so
    let property = scratch.text("property/property.json").replacen('{', "{\"parcel\": {\"/\": \"./parcel.json\"},", 1);
    std::fs::write(scratch.path("property/property.json"), property).unwrap();
    let ran = run(&["--packed"]);
    assert_eq!(ran.code, 0, "{}", ran.stderr);
    assert_eq!((&ran.json()["packed"], &ran.json()["not_packed"]), (&json!(0), &json!(["property: county.json"])));
    assert_eq!(ran.stderr, "warning: 1 data groups could not be packed and stay linked: property: county.json\n");
    let ran = scratch.run(&["hash", "property", "--packed", "--output-zip", "out/hashed.zip", "--output-csv", "out/hash.csv"]);
    assert!(ran.stdout.contains("  Data groups packed:  0\n"), "{}", ran.stdout);
}
