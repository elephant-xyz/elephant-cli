//! `elephant-cli prepare` with a browser: these tests drive the obscura
//! headless browser against a local stand-in for a county site.
//!
//! They need the obscura binary (`OBSCURA_BIN`, or `obscura` on `PATH`) and
//! are skipped, with a note, when it is not there.

mod support;

use serde_json::{json, Value};
use std::path::PathBuf;
use support::http::{serve, Reply, Request, Server};
use support::{entries, zip_of, Scratch};

fn obscura() -> Option<PathBuf> {
    let named = std::env::var_os("OBSCURA_BIN").map(PathBuf::from);
    let found = named
        .or_else(|| std::env::split_paths(&std::env::var_os("PATH")?).map(|dir| dir.join("obscura")).find(|file| file.is_file()));
    if found.is_none() {
        eprintln!("skipped: the obscura browser is not installed (set OBSCURA_BIN to run this test)");
    }
    found
}

const SEARCH: &str = r#"<!DOCTYPE html><html><head><title>Search</title><style>p { color: red }</style></head><body>
<div id="notice"><button id="agree" onclick="document.getElementById('notice').remove(); document.getElementById('form').style.display = 'block'">I agree</button></div>
<form id="form" style="display: none" action="/detail" method="get"><input id="parcel" name="parcel"><button id="go" type="submit">Search</button></form>
</body></html>"#;

const DETAIL: &str = r#"<!DOCTYPE html><html><head><title>Detail</title><link rel="stylesheet" href="/site.css"></head><body>
<h1 id="title"></h1><table class="detailsTable"><tr><td class="owner" style="font-weight: bold">JANE DOE</td></tr></table>
<script>document.getElementById('title').textContent = 'Parcel ' + new URLSearchParams(location.search).get('parcel');</script>
</body></html>"#;

/// A county site in two pages: a search form behind an "I agree" button, and a detail page filled in by script.
fn site() -> Server {
    serve(|request: &Request| -> Reply {
        let page = match request.path.split('?').next().unwrap() {
            "/search" => SEARCH,
            "/detail" => DETAIL,
            _ => return support::http::status(404),
        };
        Reply {
            status: 200,
            headers: vec![("content-type".to_string(), "text/html; charset=utf-8".to_string())],
            body: page.as_bytes().to_vec(),
        }
    })
}

/// A seed ZIP whose request is `path` on the site, for parcel 12345.
fn seed(scratch: &Scratch, site: &Server, path: &str, query: Value) -> Value {
    let mut request = json!({ "url": format!("{}{path}", site.url), "method": "GET" });
    if !query.is_null() {
        request["multiValueQueryString"] = query;
    }
    let parcel = json!({ "source_http_request": request, "request_identifier": "12345", "parcel_identifier": "12345" });
    let address = json!({ "source_http_request": request, "request_identifier": "12345", "county_name": "Lee", "unnormalized_address": "1 Main St" });
    zip_of(&[("parcel.json", &parcel.to_string()), ("address.json", &address.to_string())], &scratch.path("seed.zip"));
    request
}

/// Run `prepare seed.zip --output-zip out.zip` with obscura allowed to reach the local site.
fn prepare(scratch: &Scratch, binary: &std::path::Path, extra: &[&str]) -> support::Ran {
    let mut args = vec!["--json", "prepare", "seed.zip", "--output-zip", "out.zip"];
    args.extend(extra);
    scratch.run_with(&args, &[("OBSCURA_BIN", binary.to_str().unwrap()), ("OBSCURA_ALLOW_PRIVATE_NETWORK", "1")])
}

fn text(scratch: &Scratch, name: &str) -> String {
    String::from_utf8(entries(&scratch.path("out.zip"))[name].clone()).unwrap()
}

#[test]
fn loads_a_page_in_the_browser_and_keeps_what_scripts_rendered() {
    let Some(binary) = obscura() else { return };
    let scratch = Scratch::new();
    let site = site();
    seed(&scratch, &site, "/detail", json!({ "parcel": ["12345"] }));
    let ran = prepare(&scratch, &binary, &["--use-browser"]);
    assert_eq!((ran.code, &ran.json()["mechanism"]), (0, &json!("browser")), "{}", ran.stderr);
    let page = text(&scratch, "12345.html");
    assert!(page.contains("<h1 id=\"title\">Parcel 12345</h1>"), "{page}");
    // the page as the browser holds it: nothing is cleaned in this mode
    assert!(page.contains("<script>") && page.to_lowercase().starts_with("<!doctype html>"), "{page}");
}

#[test]
fn gives_a_page_without_the_known_county_markers_eight_seconds_as_1x_does() {
    let Some(binary) = obscura() else { return };
    let scratch = Scratch::new();
    let site = site();
    seed(&scratch, &site, "/search", Value::Null);
    let began = std::time::Instant::now();
    let ran = prepare(&scratch, &binary, &["--use-browser"]);
    let took = began.elapsed().as_secs_f32();
    assert_eq!(ran.code, 0, "{}", ran.stderr);
    assert!(text(&scratch, "12345.html").contains("id=\"agree\""));
    // 1.x stops waiting for the notice after 8 s and keeps the page 1 s later
    assert!((8.5..13.0).contains(&took), "took {took} s");
}

const FLOW: &str = r##"{
  "starts_at": "open",
  "states": {
    "open": { "type": "open_page", "input": { "url": "{{=it.url}}" }, "next": "choose" },
    "choose": {
      "type": "wait_for_selector_race",
      "input": { "selectors": [{ "selector": "#parcel", "label": "form" }, { "selector": "#agree", "label": "notice" }] },
      "next_map": { "form": "ready", "notice": "agree" },
      "validate_winner": { "form": { "check_selector": "#agree", "if_exists_goto": "agree" } }
    },
    "agree": { "type": "click", "input": { "selector": "#agree" }, "next": "ready" },
    "ready": { "type": "wait_for_selector", "input": { "selector": "#parcel", "visible": true, "timeout": 5000 }, "next": "fill" },
    "fill": { "type": "type", "input": { "selector": "#parcel", "value": "{{=it.request_identifier}}" }, "next": "submit" },
    "submit": { "type": "keyboard_press", "input": { "key": "Enter" }, "next": "absent" },
    "absent": {
      "type": "wait_for_selector", "input": { "selector": "#never", "timeout": 300 },
      "continue_on_timeout": true, "next_on_timeout": "result", "next": "result"
    },
    "result": { "type": "wait_for_selector", "input": { "selector": "#title", "timeout": 10000 }, "result": "found", "end": true }
  }
}"##;

#[test]
fn runs_a_browser_flow_and_points_the_seed_at_where_it_ended() {
    let Some(binary) = obscura() else { return };
    let scratch = Scratch::new();
    let site = site();
    let asked = seed(&scratch, &site, "/search", Value::Null);
    std::fs::write(scratch.path("flow.json"), FLOW).unwrap();
    let ran = prepare(&scratch, &binary, &["--browser-flow-file", "flow.json"]);
    assert_eq!((ran.code, &ran.json()["mechanism"]), (0, &json!("browser-flow")), "{}", ran.stderr);
    let page = text(&scratch, "12345.html");
    assert!(page.contains("<h1 id=\"title\">Parcel 12345</h1>"), "{page}");
    // cleaned: no scripts, no stylesheets, no inline styles
    assert!(!page.contains("<script") && !page.contains("stylesheet") && !page.contains("style="), "{page}");
    assert!(page.contains("<td class=\"owner\">JANE DOE</td>"), "{page}");
    for name in ["parcel.json", "address.json"] {
        let record: Value = serde_json::from_str(&text(&scratch, name)).unwrap();
        assert_eq!(record["entry_http_request"], asked, "{name}");
        let landed =
            json!({ "url": format!("{}/detail", site.url), "method": "GET", "multiValueQueryString": { "parcel": ["12345"] } });
        assert_eq!(record["source_http_request"], landed, "{name}");
    }
}

const HANDLER: &str = r#"export async function handler({ page, input, saveHtml, saveSourceUrl }) {
  const response = await page.goto(input.url, { waitUntil: 'domcontentloaded' });
  if (!response.ok()) throw new Error('search page answered ' + response.status());
  await page.click('#agree');
  await page.waitForSelector('#parcel', { visible: true });
  await page.type('#parcel', input.request_identifier);
  await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }), page.keyboard.press('Enter')]);
  await page.waitForSelector('#title');
  const owner = await page.$eval('.owner', (cell) => cell.textContent);
  const cells = await page.$$eval('td', (found, suffix) => found.length + suffix, ' cells');
  if (owner !== 'JANE DOE' || cells !== '1 cells') throw new Error(`unexpected page: ${owner}, ${cells}`);
  await saveSourceUrl(page.url());
  await saveHtml({ name: 'property-detail' });
}
"#;

#[test]
fn runs_a_browser_flow_package_whose_captures_a_transform_handler_reads() {
    let Some(binary) = obscura() else { return };
    let scratch = Scratch::new();
    scratch.lexicon();
    let site = site();
    seed(&scratch, &site, "/search", Value::Null);
    zip_of(&[("handler.js", HANDLER)], &scratch.path("flow.zip"));
    let ran = prepare(&scratch, &binary, &["--browser-flow-zip", "flow.zip"]);
    assert_eq!((ran.code, &ran.json()["mechanism"]), (0, &json!("browser-flow-v2")), "{}", ran.stderr);
    let manifest: Value = serde_json::from_str(&text(&scratch, "captures.json")).unwrap();
    assert_eq!(
        manifest,
        json!({
            "version": 2,
            "request_identifier": "12345",
            "sourceUrl": format!("{}/detail?parcel=12345", site.url),
            "captures": [{ "name": "property-detail", "path": "captures/property-detail.html", "type": "html" }],
        })
    );
    let capture = text(&scratch, "captures/property-detail.html");
    assert!(capture.contains("<h1 id=\"title\">Parcel 12345</h1>") && !capture.contains("<script"), "{capture}");
    // the prepared ZIP is what a Transform v2 handler package takes
    let transform = "import * as cheerio from 'cheerio';\n\
        export async function handler({ readCapture, writeJson }) {\n\
          const $ = cheerio.load(await readCapture('property-detail'));\n\
          await writeJson('person', { name: $('.owner').text() });\n\
        }\n";
    zip_of(&[("handler.js", transform)], &scratch.path("transform.zip"));
    let ran =
        scratch.run(&["transform", "--input-zip", "out.zip", "--transform-zip", "transform.zip", "--output-zip", "data.zip"]);
    assert_eq!(ran.code, 0, "{}", ran.stderr);
    let person: Value = serde_json::from_slice(&entries(&scratch.path("data.zip"))["data/person.json"]).unwrap();
    assert_eq!((&person["name"], &person["request_identifier"]), (&json!("JANE DOE"), &json!("12345")));
}

#[test]
fn says_what_a_flow_handler_did_wrong() {
    let Some(binary) = obscura() else { return };
    for (body, reason) in [
        (
            "await saveHtml({ name: 'Bad Name', html: '<p></p>' });",
            "Invalid capture name \"Bad Name\". Capture names must be kebab-case.",
        ),
        ("await saveHtml({ name: 'a', html: '<p></p>' });", "Browser flow v2 handler must call saveSourceUrl"),
        ("await saveSourceUrl('https://x');", "Browser flow v2 handler must save at least one capture"),
        (
            "await page.goto(input.url); await page.waitForSelector('#never', { timeout: 300 });",
            "Waiting for selector `#never` failed: 300ms exceeded",
        ),
        // `page` is the part of Puppeteer's Page the README lists, and no more
        (
            "throw new Error('page has ' + Object.keys(page).sort().join(' '));",
            "page has $ $$ $$eval $eval click content evaluate goto keyboard select type url waitForFunction waitForNavigation waitForSelector\n",
        ),
    ] {
        let scratch = Scratch::new();
        let site = site();
        seed(&scratch, &site, "/search", Value::Null);
        zip_of(
            &[(
                "handler.js",
                &format!("export async function handler({{ page, input, saveHtml, saveSourceUrl }}) {{ {body} }}\n"),
            )],
            &scratch.path("flow.zip"),
        );
        let ran = prepare(&scratch, &binary, &["--browser-flow-zip", "flow.zip"]);
        assert_eq!(ran.code, 2, "{body}");
        assert!(ran.stderr.contains(reason), "{body}: {}", ran.stderr);
    }
}
