//! County scripts were written for Node. These tests hold the embedded engine
//! to Node's answers for what the scripts rely on.
//!
//! Each case under tests/fixtures/transform/engine is a script that reports
//! what it observed in `data/probe.json`; `<case>.json` is what Node reported
//! for the same file (`golden.sh` there writes it).

mod support;

use serde_json::json;
use serde_json::Value;
use support::http::{self, Reply};
use support::{entries, fixtures, pack, zip_of, Scratch};

/// What Node reported for a case.
fn node(case: &str) -> Value {
    let file = fixtures().join("transform/engine").join(format!("{case}.json"));
    serde_json::from_slice::<Value>(&std::fs::read(file).unwrap()).unwrap()["checks"].clone()
}

/// Run a case as a county's `data_extractor.js`; returns what it reported.
fn engine(scratch: &Scratch, case: &str, extra: &[&str], env: &[(&str, &str)]) -> Value {
    pack("transform/scripts-mode/input", &scratch.path("prepared.zip"));
    let source = std::fs::read_to_string(fixtures().join("transform/engine").join(format!("{case}.js"))).unwrap();
    script(scratch, &source, extra, env)
}

/// Run source text as a county's `data_extractor.js` on `prepared.zip`; returns what it reported.
fn script(scratch: &Scratch, source: &str, extra: &[&str], env: &[(&str, &str)]) -> Value {
    scratch.lexicon();
    zip_of(
        &[
            ("ownerMapping.js", ""),
            ("structureMapping.js", ""),
            ("layoutMapping.js", ""),
            ("utilityMapping.js", ""),
            ("data_extractor.js", source),
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
    alike(case, &[]);
}

/// As `same`, leaving out entries of a check that are known to differ: `(check, entry)`.
fn alike(case: &str, known: &[(&str, &str)]) {
    let scratch = Scratch::new();
    let mut found = engine(&scratch, case, &[], &[]);
    let mut wanted = node(case);
    for (check, entry) in known {
        for side in [&mut found, &mut wanted] {
            assert!(side[check].as_object_mut().unwrap().remove(*entry).is_some(), "{check} has no entry {entry}");
        }
    }
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

#[test]
fn formats_numbers_for_en_us_as_node_does() {
    same("numbers");
}

#[test]
fn orders_strings_with_locale_compare_as_node_does() {
    same("collation");
}

#[test]
fn reads_and_prints_dates_as_node_does() {
    // Three texts no county prints keep the engine's own reading; V8 gives
    // Invalid Date for the first two and 1976-07-03T22:00:00Z for the third.
    alike("dates", &[("parsed", r#""Q1 2020""#), ("parsed", r#""x2020-01-05""#), ("parsed", r#""Jul 4, 1976 GMT+2""#)]);
}

#[test]
fn takes_urls_and_their_queries_apart_as_node_does() {
    same("urls");
}

#[test]
fn offers_the_node_modules_and_globals_scripts_use() {
    same("modules");
}

/// Asks the server named in `endpoint.csv` the way county scripts do and reports the answers.
const ASKS: &str = r#"
const fs = require('fs');
const http = require('http');
const base = fs.readFileSync('endpoint.csv', 'utf8').trim();
const get = (url) =>
  new Promise((resolve) => {
    http
      .get(url, (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'] || null, body }));
      })
      .on('error', (error) => resolve({ error: error.code }));
  });
(async () => {
  const checks = { https: typeof require('https').get };
  checks.get = await get(`${base}/polygon?id=12`);
  checks.missing = await get(`${base}/missing`);
  checks.moved = await get(`${base}/moved`);
  checks.refused = await get('http://127.0.0.1:1/none');
  const posted = await fetch(`${base}/echo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-County': 'volusia' },
    body: JSON.stringify({ parcel: 12 }),
  });
  checks.fetch = [posted.ok, posted.status, posted.headers.get('Content-Type'), await posted.json()];
  const absent = await fetch(`${base}/missing`);
  checks.fetch_missing = [absent.ok, absent.status, await absent.text()];
  const followed = await fetch(`${base}/moved`);
  checks.fetch_moved = [followed.status, await followed.text()];
  checks.fetch_refused = await fetch('http://127.0.0.1:1/none').then(
    () => 'answered',
    (error) => error.name
  );
  fs.mkdirSync('data', { recursive: true });
  fs.writeFileSync('data/probe.json', JSON.stringify({ checks }));
})();
"#;

/// `prepared.zip` with the seed records and `endpoint.csv`, which scripts find in their working directory.
fn prepared(scratch: &Scratch, endpoint: &str) {
    let input = fixtures().join("transform/scripts-mode/input");
    let read = |name: &str| std::fs::read_to_string(input.join(name)).unwrap();
    zip_of(
        &[
            ("12345.html", &read("12345.html")),
            ("address.json", &read("address.json")),
            ("parcel.json", &read("parcel.json")),
            ("endpoint.csv", endpoint),
        ],
        &scratch.path("prepared.zip"),
    );
}

fn county_server() -> http::Server {
    http::serve(|request| match request.path.as_str() {
        "/polygon?id=12" => Reply {
            status: 200,
            headers: vec![("Content-Type".into(), "application/json".into())],
            body: br#"{"rings":[[1,2]]}"#.to_vec(),
        },
        "/echo" => {
            let said = json!({
                "method": request.method,
                "county": request.header("x-county"),
                "type": request.header("content-type"),
                "sent": String::from_utf8_lossy(&request.body),
            });
            Reply {
                status: 200,
                headers: vec![("content-type".into(), "application/json".into())],
                body: said.to_string().into_bytes(),
            }
        }
        "/moved" => {
            Reply { status: 302, headers: vec![("Location".into(), "/polygon?id=12".into())], body: b"over there".to_vec() }
        }
        _ => Reply { status: 404, headers: Vec::new(), body: b"gone".to_vec() },
    })
}

#[test]
fn lets_a_script_ask_a_server_with_http_get_and_fetch() {
    let server = county_server();
    let scratch = Scratch::new();
    prepared(&scratch, &server.url);
    // online, with the lexicon manifest read from the cache so that only the script uses the network
    let manifest = scratch.path("schemas/manifest.json");
    let online = [("ELEPHANT_OFFLINE", "0"), ("ELEPHANT_SCHEMA_MANIFEST_URL", manifest.to_str().unwrap())];
    let found = script(&scratch, ASKS, &[], &online);
    assert_eq!(
        found,
        json!({
            "https": "function",
            "get": { "status": 200, "type": "application/json", "body": r#"{"rings":[[1,2]]}"# },
            "missing": { "status": 404, "type": null, "body": "gone" },
            // http.get hands a redirect to the script, fetch follows it: as in Node
            "moved": { "status": 302, "type": null, "body": "over there" },
            "refused": { "error": "ECONNREFUSED" },
            "fetch": [true, 200, "application/json", {
                "method": "POST", "county": "volusia", "type": "application/json", "sent": r#"{"parcel":12}"#
            }],
            "fetch_missing": [false, 404, "gone"],
            "fetch_moved": [200, r#"{"rings":[[1,2]]}"#],
            "fetch_refused": "TypeError",
        })
    );
}

#[test]
fn keeps_scripts_off_the_network_when_offline() {
    let server = county_server();
    let scratch = Scratch::new();
    prepared(&scratch, &server.url);
    let asks = r#"
const fs = require('fs');
const base = fs.readFileSync('endpoint.csv', 'utf8').trim();
require('http')
  .get(`${base}/polygon?id=12`, () => {})
  .on('error', async (error) => {
    const fetched = await fetch(`${base}/polygon?id=12`).then(() => 'answered', (failed) => [failed.name, failed.cause.code]);
    fs.mkdirSync('data', { recursive: true });
    fs.writeFileSync('data/probe.json', JSON.stringify({ checks: { get: error.code, fetched } }));
  });
"#;
    let found = script(&scratch, asks, &["--offline"], &[]);
    assert_eq!(found, json!({ "get": "EOFFLINE", "fetched": ["TypeError", "EOFFLINE"] }));
    assert!(server.requests().is_empty(), "{:?}", server.requests());
}
