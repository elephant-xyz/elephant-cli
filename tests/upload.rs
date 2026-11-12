//! `elephant-cli upload`: a county CAR or a tables directory to a Kubo RPC
//! node, checked against a stand-in node that records what it is sent.

mod support;

use cid::multihash::Multihash;
use cid::Cid;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use support::http::{ok, serve, status, Reply, Request, Server};
use support::Scratch;

const COUNTY: &str = "baguqeerai2wamycgxkpzd7wyncncl4srp4ykab4aw62bcb3mvcrlkknzo57a";

#[derive(Clone, Copy, PartialEq)]
enum Fault {
    None,
    /// The node says it imported some other root.
    OtherRoot,
    /// The gateway serves bytes that are not the root block.
    WrongBytes,
    /// The gateway never has the root.
    NotServed,
    /// The node computes another CID for every part.
    OtherPart,
}

fn raw(bytes: &[u8]) -> Cid {
    Cid::new_v1(0x55, Multihash::<64>::wrap(0x12, &Sha256::digest(bytes)).unwrap())
}

/// The file inside a one-field multipart body.
fn file(request: &Request) -> Vec<u8> {
    let boundary = request.header("content-type").unwrap().split("boundary=").nth(1).unwrap();
    let start = request.body.windows(4).position(|window| window == b"\r\n\r\n").unwrap() + 4;
    let end = request.body.len() - format!("\r\n--{boundary}--\r\n").len();
    request.body[start..end].to_vec()
}

/// The root a CAR's header names and its blocks.
fn blocks(car: &[u8]) -> (Cid, Vec<(Cid, Vec<u8>)>) {
    let varint = |at: &mut usize| {
        let mut value = 0usize;
        let mut shift = 0;
        loop {
            let byte = car[*at];
            *at += 1;
            value |= usize::from(byte & 0x7f) << shift;
            shift += 7;
            if byte & 0x80 == 0 {
                return value;
            }
        }
    };
    let mut at = 0;
    let header = varint(&mut at);
    let tag = car[at..at + header].windows(3).position(|window| window == [0xd8, 0x2a, 0x58]).unwrap() + at;
    let root = Cid::try_from(&car[tag + 5..tag + 4 + usize::from(car[tag + 3])]).unwrap();
    at += header;
    let mut found = Vec::new();
    while at < car.len() {
        let length = varint(&mut at);
        let mut section = &car[at..at + length];
        let cid = Cid::read_bytes(&mut section).unwrap();
        found.push((cid, section.to_vec()));
        at += length;
    }
    (root, found)
}

/// A stand-in for a Kubo node and its gateway.
fn node(fault: Fault) -> Server {
    let stored: Arc<Mutex<HashMap<String, Vec<u8>>>> = Arc::new(Mutex::new(HashMap::new()));
    serve(move |request| -> Reply {
        let mut stored = stored.lock().unwrap();
        let path = request.path.split('?').next().unwrap();
        if request.method == "POST" && path == "/api/v0/dag/import" {
            let (root, found) = blocks(&file(request));
            let block = found.iter().find(|(cid, _)| *cid == root).unwrap().1.clone();
            stored.insert(root.to_string(), block);
            let named = if fault == Fault::OtherRoot { raw(b"other").to_string() } else { root.to_string() };
            return ok(format!(
                "{}\n{}\n",
                json!({ "Root": { "Cid": { "/": named }, "PinErrorMsg": "" } }),
                json!({ "Stats": { "BlockCount": found.len(), "BlockBytesCount": 1 } })
            ));
        }
        if request.method == "POST" && path == "/api/v0/add" {
            let bytes = file(request);
            let cid = if fault == Fault::OtherPart { raw(b"other") } else { raw(&bytes) };
            stored.insert(cid.to_string(), bytes);
            return ok(format!("{}\n", json!({ "Name": "part", "Hash": cid.to_string(), "Size": "1" })));
        }
        let parts: Vec<&str> = path.trim_start_matches("/ipfs/").split('/').collect();
        let Some(block) = stored.get(parts[0]).filter(|_| fault != Fault::NotServed) else {
            return status(404);
        };
        if parts.len() == 1 {
            return ok(if fault == Fault::WrongBytes { b"not the block".to_vec() } else { block.clone() });
        }
        // <tables root>/tables/<table>/parts/<n>/cid: the size of that part, as a one-byte range
        let document: Value = serde_json::from_slice(block).unwrap();
        let cid = document["tables"][parts[2]]["parts"][parts[4].parse::<usize>().unwrap()]["cid"]["/"].as_str().unwrap();
        let total = stored[cid].len();
        Reply { status: 206, headers: vec![("content-range".to_string(), format!("bytes 0-0/{total}"))], body: b"P".to_vec() }
    })
}

fn county(scratch: &Scratch) {
    scratch.copy("export-tables", "in");
}

#[test]
fn imports_a_car_and_reads_its_root_back() {
    let scratch = Scratch::new();
    county(&scratch);
    let node = node(Fault::None);
    let ran = scratch.run(&[
        "--json", "upload", "in/county.car", "--api", &format!("{}/", node.url), "--gateway", &node.url,
        "--token", "secret", "--output-json", "upload.json",
    ]);
    assert_eq!(ran.code, 0, "{}", ran.stderr);
    let summary = ran.json();
    assert_eq!((&summary["api"], &summary["root"], &summary["blocks"]), (&json!(node.url), &json!(COUNTY), &json!(22)));
    assert_eq!(summary["gatewayUrl"], format!("{}/ipfs/{COUNTY}", node.url));
    assert_eq!(serde_json::from_str::<Value>(&scratch.text("upload.json")).unwrap(), summary);
    let asked = node.requests();
    assert_eq!(asked[0].path, "/api/v0/dag/import?pin-roots=true&stats=true");
    assert_eq!(asked[0].header("authorization"), Some("Bearer secret"));
    assert_eq!(file(&asked[0]), std::fs::read(scratch.path("in/county.car")).unwrap());
    assert!(String::from_utf8_lossy(&asked[0].body).contains("name=\"file\"; filename=\"county.car\""));
    assert_eq!((asked[1].method.as_str(), asked[1].path.as_str()), ("GET", format!("/ipfs/{COUNTY}?format=raw").as_str()));
    assert_eq!(asked[1].header("authorization"), None, "the gateway gets no token");
}

#[test]
fn adds_every_part_of_a_tables_directory_and_checks_each_cid() {
    let scratch = Scratch::new();
    scratch.lexicon();
    county(&scratch);
    let exported = scratch.run(&["--json", "export-tables", "in/county.car", "--output", "tables"]).json();
    let node = node(Fault::None);
    let api = node.url.as_str();
    let ran = scratch.run_with(&["--json", "upload", "tables"], &[("IPFS_API", api), ("ELEPHANT_CAR_GATEWAY", api)]);
    assert_eq!(ran.code, 0, "{}", ran.stderr);
    let summary = ran.json();
    assert_eq!((&summary["root"], &summary["countyRoot"], &summary["parts"]), (&exported["root"], &json!(COUNTY), &json!(8)));
    let asked = node.requests();
    let adds: Vec<&Request> = asked.iter().filter(|request| request.path.starts_with("/api/v0/add")).collect();
    assert_eq!(adds.len(), 8);
    assert!(adds.iter().all(|add| add.path == "/api/v0/add?pin=true&cid-version=1&raw-leaves=true&chunker=size-262144"));
    // parts first, then tables.car, then the root and the first part read back
    let order: Vec<&str> = asked[8..].iter().map(|request| request.path.as_str()).collect();
    let root = exported["root"].as_str().unwrap();
    assert_eq!(order[0], "/api/v0/dag/import?pin-roots=true&stats=true");
    assert_eq!(order[1], format!("/ipfs/{root}?format=raw"));
    assert_eq!(order[2], format!("/ipfs/{root}/tables/address/parts/0/cid"));
    assert_eq!(asked[10].header("range"), Some("bytes=0-0"));
}

#[test]
fn fails_when_the_node_or_the_gateway_disagrees() {
    let scratch = Scratch::new();
    county(&scratch);
    for (fault, reason) in [
        (Fault::OtherRoot, format!("but the CAR root is {COUNTY}")),
        (Fault::WrongBytes, format!("Gateway bytes for {COUNTY} hash to ")),
        (Fault::NotServed, format!("/ipfs/{COUNTY} to resolve")),
    ] {
        let node = node(fault);
        let ran = scratch.run(&["--json", "upload", "in/county.car", "--api", &node.url, "--gateway", &node.url, "--timeout", "0.2"]);
        assert_eq!(ran.code, 2);
        assert!(ran.stderr.contains(&reason), "{}", ran.stderr);
        assert!(ran.json()["error"].as_str().unwrap().starts_with("Upload failed: "));
    }
}

#[test]
fn refuses_a_part_the_node_gives_another_cid() {
    let scratch = Scratch::new();
    scratch.lexicon();
    county(&scratch);
    scratch.run(&["export-tables", "in/county.car", "--output", "tables"]);
    let node = node(Fault::OtherPart);
    let ran = scratch.run(&["upload", "tables", "--api", &node.url, "--gateway", &node.url]);
    assert_eq!(ran.code, 2);
    assert!(ran.stderr.contains("but the index records bafkrei"), "{}", ran.stderr);
    assert_eq!(node.requests().len(), 1, "the first mismatch stops the upload");
}

#[test]
fn checks_parts_on_disk_before_sending_anything() {
    let scratch = Scratch::new();
    scratch.lexicon();
    county(&scratch);
    scratch.run(&["export-tables", "in/county.car", "--output", "tables"]);
    std::fs::write(scratch.path("tables/tax/part-00000.parquet"), b"cut short").unwrap();
    let node = node(Fault::None);
    let ran = scratch.run(&["upload", "tables", "--api", &node.url, "--gateway", &node.url]);
    assert_eq!(ran.code, 2);
    assert!(ran.stderr.contains("part-00000.parquet is 9 bytes but"), "{}", ran.stderr);
    assert!(node.requests().is_empty());
}

#[test]
fn builds_the_filebase_token_from_its_three_variables() {
    let scratch = Scratch::new();
    county(&scratch);
    let node = node(Fault::None);
    let env = [
        ("IPFS_API", node.url.as_str()),
        ("ELEPHANT_CAR_GATEWAY", node.url.as_str()),
        ("FILEBASE_ACCESS_KEY", "ak"),
        ("FILEBASE_SECRET_KEY", "sk"),
        ("FILEBASE_BUCKET", "bucket"),
    ];
    let ran = scratch.run_with(&["upload", "in/county.car"], &env);
    assert_eq!(ran.code, 0, "{}", ran.stderr);
    // base64 of "ak:sk:bucket"
    assert_eq!(node.requests()[0].header("authorization"), Some("Bearer YWs6c2s6YnVja2V0"));
    assert!(ran.stdout.starts_with("Upload completed\n  api: http://127.0.0.1"), "{}", ran.stdout);
}

#[test]
fn refuses_inputs_and_options_it_cannot_use() {
    let scratch = Scratch::new();
    county(&scratch);
    for (args, reason) in [
        (vec!["upload", "in"], "is neither a .car file nor a tables directory written by export-tables"),
        (vec!["upload", "in/county.car", "--timeout", "5m"], "--timeout must be a number of seconds greater than zero, got 5m"),
        (vec!["upload", "in/county.car", "--api", "localhost:5001/"], "--api must be a URL with a scheme, got localhost:5001"),
    ] {
        let ran = scratch.run(&args);
        assert_eq!(ran.code, 2, "{args:?}");
        assert!(ran.stderr.contains(reason), "{args:?}: {}", ran.stderr);
    }
}
