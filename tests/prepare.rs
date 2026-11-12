//! `elephant-cli prepare` without a browser: one HTTP request, a
//! multi-request flow, the Orange County fetcher and CSV batches.
//!
//! The seed, the flow file and the expected outputs under
//! tests/fixtures/prepare come from runs of elephant-cli 1.58.1 against a
//! local server that echoes what it is asked; they name it as
//! `http://127.0.0.1:18765`, which each test replaces by its own server.

mod support;

use serde_json::{json, Value};
use support::http::{ok, serve, status, Reply, Request, Server};
use support::{entries, fixtures, zip_of, Scratch};

const GOLDEN: &str = "http://127.0.0.1:18765";

/// The stand-in county site of the 1.x runs: HTML under /html, a 404 under /missing, an echo elsewhere.
fn site() -> Server {
    serve(|request: &Request| -> Reply {
        if request.path.starts_with("/html") {
            let page = format!("<html><body><p id=\"url\">{}</p><script>1</script></body></html>", request.path);
            return Reply { status: 200, headers: vec![("content-type".to_string(), "text/html; charset=utf-8".to_string())], body: page.into_bytes() };
        }
        if request.path.starts_with("/missing") {
            return status(404);
        }
        let echoed = json!({
            "method": request.method,
            "url": request.path,
            "contentType": request.header("content-type"),
            "body": String::from_utf8_lossy(&request.body),
        });
        Reply { status: 200, headers: vec![("content-type".to_string(), "application/json".to_string())], body: echoed.to_string().into_bytes() }
    })
}

fn fixture(name: &str, site: &Server) -> String {
    std::fs::read_to_string(fixtures().join("prepare").join(name)).unwrap().replace(GOLDEN, &site.url)
}

/// Write the seed ZIP of the 1.x runs, pointed at this test's server.
fn seed(scratch: &Scratch, site: &Server) -> (String, String) {
    let (parcel, address) = (fixture("seed/property_seed.json", site), fixture("seed/unnormalized_address.json", site));
    zip_of(&[("property_seed.json", &parcel), ("unnormalized_address.json", &address)], &scratch.path("seed.zip"));
    (parcel, address)
}

fn text(scratch: &Scratch, name: &str) -> String {
    String::from_utf8(entries(&scratch.path("out.zip"))[name].clone()).unwrap()
}

#[test]
fn answers_the_seed_request_and_keeps_the_seed_files() {
    let scratch = Scratch::new();
    let site = site();
    let (parcel, address) = seed(&scratch, &site);
    let ran = scratch.run(&["--json", "prepare", "seed.zip", "--output-zip", "out.zip"]);
    assert_eq!((ran.code, &ran.json()["mechanism"]), (0, &json!("fetch")), "{}", ran.stderr);
    let files = entries(&scratch.path("out.zip"));
    assert_eq!(files.keys().collect::<Vec<_>>(), ["12345.html", "property_seed.json", "unnormalized_address.json"]);
    // the query of the seed replaces the URL's own; the body is kept as received
    assert_eq!(text(&scratch, "12345.html"), fixture("expected/fetch-12345.html", &site));
    assert_eq!((text(&scratch, "property_seed.json"), text(&scratch, "unnormalized_address.json")), (parcel, address));
}

#[test]
fn answers_a_multi_request_flow_as_elephant_cli_1_did() {
    let scratch = Scratch::new();
    let site = site();
    seed(&scratch, &site);
    std::fs::write(scratch.path("flow.json"), fixture("flow.json", &site)).unwrap();
    let ran = scratch.run(&["--json", "prepare", "seed.zip", "--output-zip", "out.zip", "--multi-request-flow-file", "flow.json"]);
    assert_eq!((ran.code, &ran.json()["mechanism"]), (0, &json!("multi-request")), "{}", ran.stderr);
    assert_eq!(text(&scratch, "12345.json"), fixture("expected/multi-12345.json", &site));
    // what was sent: the form body filled from the template, and the flow's query in place of the URL's
    let asked = site.requests();
    let owner = asked.iter().find(|request| request.path == "/api/owner").unwrap();
    assert_eq!((owner.method.as_str(), String::from_utf8_lossy(&owner.body).as_ref()), ("POST", "parid=12345"));
    assert!(asked.iter().any(|request| request.path == "/api/sales?year=2024&year=2025"));
}

#[test]
fn prepares_every_row_of_a_csv() {
    let scratch = Scratch::new();
    let site = site();
    std::fs::write(scratch.path("flow.json"), fixture("flow.json", &site)).unwrap();
    std::fs::write(scratch.path("parcels.csv"), "request_identifier\n12345\n\n67890\n").unwrap();
    let ran = scratch.run(&["prepare", "--input-csv", "parcels.csv", "--multi-request-flow-file", "flow.json", "--output-zip", "out.zip"]);
    assert_eq!(ran.code, 0, "{}", ran.stderr);
    assert_eq!(entries(&scratch.path("out.zip")).keys().collect::<Vec<_>>(), ["12345.json", "67890.json"]);
    assert_eq!(text(&scratch, "12345.json"), fixture("expected/multi-12345.json", &site));
    assert_eq!(text(&scratch, "67890.json"), fixture("expected/csv-67890.json", &site));
}

#[test]
fn walks_the_orange_county_api_for_a_seed_in_orange() {
    let scratch = Scratch::new();
    let calls = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let searched = calls.clone();
    let api = serve(move |request: &Request| -> Reply {
        let (path, query) = request.path.split_once('?').unwrap_or((&request.path, ""));
        match path {
            // the search answers an empty list the first time, as the real one sometimes does
            "/QuickSearch/GetSearchInfoByParcel" if searched.fetch_add(1, std::sync::atomic::Ordering::SeqCst) == 0 => ok("[]"),
            "/QuickSearch/GetSearchInfoByParcel" => ok(json!([{ "parcelId": "292318000000001", "asked": query }]).to_string()),
            "/PRC/GetPRCNonAdValorem" if query.ends_with("TaxYear=0") => ok(json!([{ "taxYear": 2024, "amount": 10.5 }]).to_string()),
            "/PRC/GetPRCNonAdValorem" if query.ends_with("TaxYear=2023") => ok(json!([{ "taxYear": 2023, "amount": 9 }]).to_string()),
            "/PRC/GetPRCNonAdValorem" => ok("[]"),
            "/PRC/GetPRCTotalTaxes" if query.ends_with("TaxYear=0") => ok(json!({ "taxYear": 2024, "total": 1 }).to_string()),
            "/PRC/GetPRCTotalTaxes" => status(404),
            "/PRC/GetPRCSales" => status(404),
            other => ok(json!({ "from": other }).to_string()),
        }
    });
    let parcel = json!({ "source_http_request": { "url": "https://example.com", "method": "GET" }, "request_identifier": "29-23-18-0000-00001" });
    let address = json!({ "county_name": "Orange", "request_identifier": "29-23-18-0000-00001" });
    zip_of(&[("parcel.json", &parcel.to_string()), ("address.json", &address.to_string())], &scratch.path("seed.zip"));
    let ran = scratch.run_with(&["--json", "prepare", "seed.zip", "--output-zip", "out.zip"], &[("ELEPHANT_ORANGE_API", &api.url)]);
    assert_eq!((ran.code, &ran.json()["mechanism"]), (0, &json!("orange")), "{}", ran.stderr);
    let saved = text(&scratch, "29-23-18-0000-00001.json");
    let found: Value = serde_json::from_str(&saved).unwrap();
    // the parcel id is its digits, padded to 15
    assert_eq!(found["parcelQuickSearchSummary"][0]["asked"], "pid=292318000000001");
    assert_eq!(found["parcelNonAdValoremAssessments"], json!([{ "taxYear": 2024, "amount": 10.5 }, { "taxYear": 2023, "amount": 9 }]));
    assert_eq!(found["parcelTotalTaxesSummary"], json!([{ "taxYear": 2024, "total": 1 }]));
    assert_eq!(found["parcelGeneralProfile"], json!({ "from": "/PRC/GetPRCGeneralInfo" }));
    let keys: Vec<&String> = found.as_object().unwrap().keys().collect();
    assert_eq!(keys[..4], ["parcelQuickSearchSummary", "parcelNonAdValoremAssessments", "parcelTotalTaxesSummary", "parcelValuationStats"]);
    assert!(!keys.iter().any(|key| *key == "parcelSalesHistory"), "an endpoint that answers 404 is left out");
    assert!(saved.starts_with("{\n  \"parcelQuickSearchSummary\": [\n"), "indented as 1.x wrote it");
}

#[test]
fn says_why_it_could_not_prepare() {
    let scratch = Scratch::new();
    let site = site();
    seed(&scratch, &site);
    let missing = json!({ "source_http_request": { "url": format!("{}/missing", site.url), "method": "GET" }, "request_identifier": "1" });
    zip_of(&[("parcel.json", &missing.to_string()), ("address.json", "{}")], &scratch.path("missing.zip"));
    zip_of(&[("parcel.json", "{\"request_identifier\": \"1\"}"), ("address.json", "{}")], &scratch.path("bare.zip"));
    zip_of(&[("address.json", "{}")], &scratch.path("no-parcel.zip"));
    std::fs::write(scratch.path("bad-flow.json"), json!({ "requests": [{ "key": "A", "request": { "method": "GET", "url": "ftp://x", "body": "b" } }] }).to_string()).unwrap();
    for (args, reason) in [
        (vec!["--output-zip", "out.zip"], "Either provide an input ZIP or use --input-csv"),
        (vec!["missing.zip", "--output-zip", "out.zip"], "HTTP error 404: Not Found"),
        (vec!["bare.zip", "--output-zip", "out.zip"], "parcel.json missing source_http_request"),
        (vec!["no-parcel.zip", "--output-zip", "out.zip"], "Neither parcel.json nor property_seed.json found in input zip"),
        (vec!["seed.zip", "--output-zip", "out.zip", "--continue-button", "#go"], "--continue-button requires --use-browser to be enabled"),
        (vec!["seed.zip", "--output-zip", "out.zip", "--multi-request-flow-file", "bad-flow.json"], "requests.0: GET requests cannot have body or json fields"),
        (vec!["seed.zip", "--output-zip", "out.zip", "--browser-flow-version", "2"], "--browser-flow-zip is required for browser flow v2"),
    ] {
        let mut all = vec!["prepare"];
        all.extend(args);
        let ran = scratch.run(&all);
        assert_eq!(ran.code, 2, "{all:?}");
        assert!(ran.stderr.contains(reason), "{all:?}: {}", ran.stderr);
        assert!(!scratch.path("out.zip").exists(), "{all:?}");
    }
}

#[test]
fn says_how_to_get_the_browser_when_it_is_missing() {
    let scratch = Scratch::new();
    let site = site();
    seed(&scratch, &site);
    let ran = scratch.run_with(&["prepare", "seed.zip", "--output-zip", "out.zip", "--use-browser"], &[("OBSCURA_BIN", "/nonexistent/obscura")]);
    assert_eq!(ran.code, 2);
    assert!(ran.stderr.contains("the obscura browser was not found") && ran.stderr.contains("--cdp-url"), "{}", ran.stderr);
}
