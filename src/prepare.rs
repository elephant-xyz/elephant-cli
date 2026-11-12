//! `prepare`: fetch the source content for one parcel and add it to the seed
//! ZIP, ready for `transform`.
//!
//! The seed ZIP names the request (`source_http_request`) and the parcel
//! (`request_identifier`). One of these mechanisms answers it, the first that
//! applies:
//!
//! 1. a Browser Flow v2 package (`--browser-flow-zip`), which saves named captures;
//! 2. a multi-request flow (`--multi-request-flow-file`): several HTTP requests, one JSON file;
//! 3. the Orange County fetcher, for a seed whose county is `Orange`;
//! 4. a browser flow (`--browser-flow-file`, or `--browser-flow-template` with its parameters);
//! 5. a plain page load in the browser (`--use-browser`, GET only);
//! 6. a plain HTTP request.
//!
//! Browser mechanisms drive the obscura headless browser over the Chrome
//! DevTools Protocol; see `browser`.

use crate::browser::{Browser, Launch};
use crate::canonical::pretty;
use crate::flow;
use crate::js;
use crate::Fail;
use serde_json::{json, Map, Value};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::Duration;

const SEEDS: [&str; 4] = ["parcel.json", "property_seed.json", "address.json", "unnormalized_address.json"];
const ORANGE: &str = "https://ocpa-mainsite-afd-standard.azurefd.net/api";

pub struct Options<'a> {
    pub input: Option<&'a Path>,
    pub csv: Option<&'a Path>,
    pub output: &'a Path,
    pub multi: Option<&'a Path>,
    pub flow: Option<&'a Path>,
    pub template: Option<(&'a str, &'a str)>,
    pub package: Option<&'a Path>,
    pub browse: bool,
    /// Click the "Continue" notice some county sites show before the page.
    pub proceed: bool,
    pub button: Option<&'a str>,
    pub captcha: bool,
    pub launch: Launch,
}

pub struct Done {
    pub mechanism: &'static str,
    /// The files in the output ZIP.
    pub files: Vec<String>,
}

/// What a mechanism fetched: the content and whether it is HTML or JSON.
pub struct Fetched {
    pub content: String,
    pub html: bool,
    /// Where a browser flow ended, when one ran.
    pub landed: Option<String>,
}

/// A scratch directory, removed when dropped.
struct Work(PathBuf);

impl Work {
    fn new() -> Result<Work, Fail> {
        let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_nanos();
        let dir = std::env::temp_dir().join(format!("elephant-prepare-{}-{stamp:x}", std::process::id()));
        std::fs::create_dir_all(&dir)?;
        Ok(Work(dir.canonicalize()?))
    }
}

impl Drop for Work {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn unzip(file: &Path, into: &Path) -> Result<(), Fail> {
    let opened = std::fs::File::open(file).map_err(|error| format!("cannot read {}: {error}", file.display()))?;
    let mut archive = zip::ZipArchive::new(opened).map_err(|error| format!("{} is not a ZIP file: {error}", file.display()))?;
    for at in 0..archive.len() {
        let mut entry = archive.by_index(at)?;
        let Some(name) = entry.enclosed_name() else {
            continue;
        };
        let target = into.join(name);
        if entry.is_dir() {
            std::fs::create_dir_all(&target)?;
            continue;
        }
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let mut bytes = Vec::new();
        entry.read_to_end(&mut bytes)?;
        std::fs::write(target, bytes)?;
    }
    Ok(())
}

/// Every file under a directory, as paths relative to it with `/` separators, in byte order.
fn tree(dir: &Path, prefix: &str, into: &mut Vec<String>) {
    let mut entries: Vec<_> = std::fs::read_dir(dir).into_iter().flatten().flatten().map(|entry| entry.path()).collect();
    entries.sort();
    for entry in entries {
        let name = format!("{prefix}{}", entry.file_name().unwrap_or_default().to_string_lossy());
        match entry.is_dir() {
            true => tree(&entry, &format!("{name}/"), into),
            false => into.push(name),
        }
    }
}

fn pack(dir: &Path, output: &Path) -> Result<Vec<String>, Fail> {
    if let Some(parent) = output.parent().filter(|parent| !parent.as_os_str().is_empty()) {
        std::fs::create_dir_all(parent)?;
    }
    let file = std::fs::File::create(output).map_err(|error| format!("cannot write {}: {error}", output.display()))?;
    let mut writer = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    let mut files = Vec::new();
    tree(dir, "", &mut files);
    for name in &files {
        writer.start_file(name.as_str(), options)?;
        writer.write_all(&std::fs::read(dir.join(name))?)?;
    }
    writer.finish()?;
    Ok(files)
}

/// The URL of a request: its `multiValueQueryString`, when present, replaces the URL's own query.
pub fn address(request: &Value) -> Result<url::Url, Fail> {
    let text = request["url"].as_str().ok_or("source_http_request has no url")?;
    let mut parsed = url::Url::parse(text).map_err(|error| format!("{text} is not a URL: {error}"))?;
    let Some(query) = request["multiValueQueryString"].as_object() else {
        return Ok(parsed);
    };
    parsed.set_query(None);
    for (key, values) in query {
        for value in values.as_array().into_iter().flatten().filter_map(Value::as_str) {
            parsed.query_pairs_mut().append_pair(key, value);
        }
    }
    Ok(parsed)
}

/// A response: status, content type, body text.
struct Answer {
    status: u16,
    reason: String,
    kind: String,
    text: String,
}

fn send(method: &str, target: &str, headers: &[(String, String)], body: Option<&str>) -> Result<Answer, Fail> {
    let config = ureq::Agent::config_builder()
        .http_status_as_error(false)
        .timeout_connect(Some(Duration::from_secs(10)))
        .timeout_global(Some(Duration::from_secs(300)));
    let agent: ureq::Agent = config.build().into();
    let mut request = ureq::http::Request::builder().method(method).uri(target);
    for (name, value) in headers {
        request = request.header(name.as_str(), value.as_str());
    }
    let request = request.body(body.unwrap_or_default().to_string())?;
    let failed = |error: ureq::Error| -> Fail {
        match error {
            ureq::Error::Timeout(_) | ureq::Error::ConnectionFailed | ureq::Error::HostNotFound => format!(
                "{error} for {target}. If the site restricts by location, try from an address in its region."
            )
            .into(),
            other => format!("{other} for {target}").into(),
        }
    };
    let mut response = agent.run(request).map_err(failed)?;
    let status = response.status();
    let kind = response.headers().get("content-type").and_then(|value| value.to_str().ok()).unwrap_or_default().to_string();
    let text = response.body_mut().with_config().limit(1 << 30).read_to_string()?;
    Ok(Answer { status: status.as_u16(), reason: status.canonical_reason().unwrap_or_default().to_string(), kind, text })
}

fn refuse(answer: &Answer) -> Fail {
    format!("HTTP error {}: {}", answer.status, answer.reason).into()
}

/// Answer the seed's own request with one HTTP request.
fn plain(request: &Value) -> Result<Fetched, Fail> {
    let headers: Vec<(String, String)> = request["headers"]
        .as_object()
        .into_iter()
        .flatten()
        .filter_map(|(name, value)| Some((name.clone(), value.as_str()?.to_string())))
        .collect();
    let body = match (&request["json"], request["body"].as_str()) {
        (Value::Null, body) => body.map(str::to_string),
        (json, _) => Some(crate::canonical::stringify(json)),
    };
    let method = request["method"].as_str().unwrap_or("GET");
    let answer = send(method, address(request)?.as_str(), &headers, body.as_deref())?;
    if !(200..300).contains(&answer.status) {
        return Err(refuse(&answer));
    }
    Ok(Fetched { html: answer.kind.contains("html"), content: answer.text, landed: None })
}

/// Fill the `{{=it.request_identifier}}` templates anywhere in a value's strings.
fn fill(value: &mut Value, identifier: &str) -> Result<(), Fail> {
    fn strings<'a>(value: &'a mut Value, into: &mut Vec<&'a mut String>) {
        match value {
            Value::String(text) if text.contains("=it.") => into.push(text),
            Value::Array(items) => items.iter_mut().for_each(|item| strings(item, into)),
            Value::Object(fields) => fields.values_mut().for_each(|item| strings(item, into)),
            _ => {}
        }
    }
    let mut found = Vec::new();
    strings(value, &mut found);
    if found.is_empty() {
        return Ok(());
    }
    let templates: Vec<String> = found.iter().map(|text| text.to_string()).collect();
    let filled = js::fill(&templates, &json!({ "request_identifier": identifier }))?;
    for (text, value) in found.into_iter().zip(filled) {
        *text = value;
    }
    Ok(())
}

/// Read a multi-request flow file and check it the way 1.x did.
fn flow_file(file: &Path) -> Result<Vec<(String, Value)>, Fail> {
    let text = std::fs::read(file).map_err(|error| format!("Failed to read multi-request flow file: {error}"))?;
    let flow: Value = serde_json::from_slice(&text).map_err(|error| format!("Failed to parse multi-request flow JSON: {error}"))?;
    if !flow.is_object() {
        return Err("Multi-request flow must be a JSON object".into());
    }
    let mut problems = Vec::new();
    let mut requests = Vec::new();
    let listed = flow["requests"].as_array().cloned().unwrap_or_default();
    if listed.is_empty() {
        problems.push("requests: At least one request is required".to_string());
    }
    for (at, entry) in listed.iter().enumerate() {
        let mut problem = |message: &str| problems.push(format!("requests.{at}: {message}"));
        let key = entry["key"].as_str().unwrap_or_default();
        let request = &entry["request"];
        let method = request["method"].as_str().unwrap_or_default();
        let kind = request["headers"]["content-type"].as_str();
        let (json, body) = (!request["json"].is_null(), !request["body"].is_null());
        if key.is_empty() {
            problem("key must be a non-empty string");
        }
        if requests.iter().any(|(known, _): &(String, Value)| known == key) {
            problem(&format!("Duplicate request key: \"{key}\""));
        }
        if !["GET", "POST", "PUT", "PATCH"].contains(&method) {
            problem("method must be GET, POST, PUT or PATCH");
        }
        if !request["url"].as_str().is_some_and(|url| url.starts_with("http://") || url.starts_with("https://")) {
            problem("url must start with http:// or https://");
        }
        if method == "GET" && (json || body) {
            problem("GET requests cannot have body or json fields");
        }
        if json && body {
            problem("Cannot have both json and body fields");
        }
        if json && kind != Some("application/json") {
            problem("json body requires content-type: application/json");
        }
        if body && kind.is_none_or(|kind| kind == "application/json") {
            problem("body field requires content-type header to be set (and not application/json)");
        }
        if method != "GET" && kind == Some("application/json") && !json {
            problem("POST/PUT/PATCH with content-type: application/json requires json field");
        }
        if method != "GET" && kind.is_some_and(|kind| kind != "application/json") && !body {
            problem("POST/PUT/PATCH with non-json content-type requires body field");
        }
        requests.push((key.to_string(), request.clone()));
    }
    if !problems.is_empty() {
        return Err(format!("Multi-request flow validation failed:\n  - {}", problems.join("\n  - ")).into());
    }
    Ok(requests)
}

/// Send every request of a multi-request flow and gather the answers under their keys.
fn multi(requests: &[(String, Value)], identifier: &str) -> Result<Fetched, Fail> {
    let mut output = Map::new();
    for (key, request) in requests {
        let mut request = request.clone();
        fill(&mut request, identifier)?;
        let target = address(&request)?;
        let method = request["method"].as_str().unwrap_or("GET");
        let mut headers: Vec<(String, String)> = request["headers"]
            .as_object()
            .into_iter()
            .flatten()
            .filter_map(|(name, value)| Some((name.clone(), value.as_str()?.to_string())))
            .collect();
        let body = match (method, &request["json"], request["body"].as_str()) {
            ("GET", _, _) => None,
            (_, Value::Null, body) => body.map(str::to_string),
            (_, json, _) => {
                if !headers.iter().any(|(name, _)| name.eq_ignore_ascii_case("content-type")) {
                    headers.push(("content-type".to_string(), "application/json".to_string()));
                }
                Some(crate::canonical::stringify(json))
            }
        };
        let answer = send(method, target.as_str(), &headers, body.as_deref())?;
        if !(200..300).contains(&answer.status) {
            return Err(refuse(&answer));
        }
        // An object or a list is kept as JSON; anything else as the text received.
        let response = match serde_json::from_str::<Value>(&answer.text) {
            Ok(parsed) if parsed.is_object() || parsed.is_array() => parsed,
            _ => Value::String(answer.text),
        };
        // What was asked, with the query of the URL and of the flow gathered per key.
        let written = url::Url::parse(request["url"].as_str().unwrap_or_default())?;
        let mut query: Map<String, Value> = Map::new();
        let mut note = |key: &str, value: &str| {
            let values = query.entry(key.to_string()).or_insert_with(|| json!([]));
            values.as_array_mut().expect("a list").push(json!(value));
        };
        for (key, value) in written.query_pairs() {
            note(&key, &value);
        }
        for (key, values) in request["multiValueQueryString"].as_object().into_iter().flatten() {
            for value in values.as_array().into_iter().flatten().filter_map(Value::as_str) {
                note(key, value);
            }
        }
        let mut asked = Map::new();
        asked.insert("method".to_string(), json!(method));
        asked.insert("url".to_string(), json!(format!("{}{}", written.origin().ascii_serialization(), written.path())));
        for field in ["headers", "json", "body"] {
            if !request[field].is_null() {
                asked.insert(field.to_string(), request[field].clone());
            }
        }
        if !query.is_empty() {
            asked.insert("multiValueQueryString".to_string(), Value::Object(query));
        }
        output.insert(key.clone(), json!({ "source_http_request": asked, "response": response }));
    }
    Ok(Fetched { content: pretty(&Value::Object(output)), html: false, landed: None })
}

/// Orange County, Florida: the property appraiser's API, walked by parcel id.
fn orange(identifier: &str) -> Result<Fetched, Fail> {
    let base = std::env::var("ELEPHANT_ORANGE_API").unwrap_or_else(|_| ORANGE.to_string());
    let get = |path: &str| send("GET", &format!("{base}{path}"), &[], None);
    let parsed = |answer: &Answer| serde_json::from_str::<Value>(&answer.text).unwrap_or(Value::Null);
    let digits: String = identifier.chars().filter(char::is_ascii_digit).collect();
    if digits.len() > 15 {
        return Err(format!("Orange County parcel id \"{identifier}\" cleaned to {} digits (> 15); cannot resolve", digits.len()).into());
    }
    let padded = format!("{digits:0>15}");
    // The search sometimes answers an empty list for a parcel it knows.
    let mut summary = Value::Null;
    for attempt in 1..=4u64 {
        let answer = get(&format!("/QuickSearch/GetSearchInfoByParcel?pid={padded}"))?;
        if !(200..300).contains(&answer.status) {
            return Err(format!("Quick search for parcel {padded} failed with status {}", answer.status).into());
        }
        summary = parsed(&answer);
        let Some(found) = summary.as_array() else {
            return Err(format!("Quick search for parcel {padded} returned unexpected format (attempt {attempt})").into());
        };
        if !found.is_empty() {
            break;
        }
        if attempt == 4 {
            return Err(format!("Quick search for parcel {padded} returned empty after 4 attempts").into());
        }
        std::thread::sleep(Duration::from_millis(300 * attempt));
    }
    let parcel = match &summary[0]["parcelId"] {
        Value::String(text) => text.clone(),
        Value::Number(number) => number.to_string(),
        _ => return Err("Failed to retrieve parcelId from quick search response".into()),
    };
    // Two series by tax year, newest first, until the API has no earlier year.
    let years = |path: &str, listed: bool| -> Result<Vec<Value>, Fail> {
        let mut kept = Vec::new();
        let mut year = 0.0;
        loop {
            let target = format!("/PRC/{path}?PID={parcel}&TaxYear={year}");
            let answer = get(&target)?;
            if answer.status == 404 {
                return Ok(kept);
            }
            if !(200..300).contains(&answer.status) {
                return Err(format!("API request to {base}{target} failed with status {}", answer.status).into());
            }
            let data = parsed(&answer);
            let row = if listed { data.get(0).cloned().unwrap_or(Value::Null) } else { data };
            let found = row["taxYear"].as_f64().filter(|found| *found != 0.0);
            let Some(found) = found.filter(|_| row.is_object()) else {
                return Ok(kept);
            };
            kept.push(row);
            year = found - 1.0;
        }
    };
    let mut output = Map::new();
    output.insert("parcelQuickSearchSummary".to_string(), summary.clone());
    output.insert("parcelNonAdValoremAssessments".to_string(), Value::Array(years("GetPRCNonAdValorem", true)?));
    output.insert("parcelTotalTaxesSummary".to_string(), Value::Array(years("GetPRCTotalTaxes", false)?));
    for (key, path) in [
        ("parcelValuationStats", format!("/PRC/GetPRCStats?PID={parcel}")),
        ("parcelGeneralProfile", format!("/PRC/GetPRCGeneralInfo?pid={parcel}")),
        ("parcelPropertyValuesByYear", format!("/PRC/GetPRCPropertyValues?PID={parcel}&TaxYear=0&ShowAllFlag=1")),
        ("parcelCertifiedTaxesByAuthority", format!("/PRC/GetPRCCertifiedTaxes?PID={parcel}&TaxYear=0")),
        ("parcelLandFeatures", format!("/PRC/GetPRCPropFeatLand?pid={parcel}")),
        ("parcelLegalDescription", format!("/PRC/GetPRCPropFeatLegal?pid={parcel}")),
        ("parcelBuildingFeatures", format!("/PRC/GetPRCPropFeatBldg?pid={parcel}")),
        ("parcelExtraFeatures", format!("/PRC/GetPRCPropFeatXfob?pid={parcel}")),
        ("parcelLandAreaSummary", format!("/PRC/GetPRCPropFeatLandArea?pid={parcel}")),
        ("parcelSalesHistory", format!("/PRC/GetPRCSales?pid={parcel}")),
    ] {
        let answer = get(&path)?;
        if answer.status == 404 {
            continue;
        }
        if !(200..300).contains(&answer.status) {
            return Err(format!("API request to {base}{path} failed with status {}", answer.status).into());
        }
        output.insert(key.to_string(), parsed(&answer));
    }
    Ok(Fetched { content: pretty(&Value::Object(output)), html: false, landed: None })
}

fn load(file: &Path) -> Result<Value, Fail> {
    let bytes = std::fs::read(file).map_err(|error| format!("cannot read {}: {error}", file.display()))?;
    Ok(serde_json::from_slice(&bytes).map_err(|error| format!("{}: {error}", file.display()))?)
}

/// Where a browser flow ended, as the request a later run would start from.
fn landing(landed: &str) -> Result<Value, Fail> {
    let parsed = url::Url::parse(landed)?;
    let mut query: Map<String, Value> = Map::new();
    for (key, value) in parsed.query_pairs() {
        let values = query.entry(key.to_string()).or_insert_with(|| json!([]));
        values.as_array_mut().expect("a list").push(json!(value));
    }
    let path = parsed.path().strip_suffix('/').unwrap_or(parsed.path());
    Ok(json!({
        "url": format!("{}{path}", parsed.origin().ascii_serialization()),
        "method": "GET",
        "multiValueQueryString": query,
    }))
}

/// `--input-csv`: one output file per `request_identifier` row.
fn rows(options: &Options, work: &Path) -> Result<&'static str, Fail> {
    let file = options.csv.expect("checked by the caller");
    let text = std::fs::read(file).map_err(|error| format!("cannot read {}: {error}", file.display()))?;
    let mut reader = csv::Reader::from_reader(text.as_slice());
    let column = reader.headers()?.iter().position(|header| header == "request_identifier");
    let column = column.ok_or("CSV file must have a request_identifier column")?;
    let identifiers: Vec<String> = reader
        .records()
        .map(|row| row.map(|row| row.get(column).unwrap_or_default().trim().to_string()))
        .collect::<Result<_, _>>()?;
    if identifiers.is_empty() {
        return Err("CSV file is empty or has no valid rows".into());
    }
    let requests = options.multi.map(flow_file).transpose()?;
    let workflow = match (&requests, options.flow) {
        (None, Some(file)) => Some(flow::load(file)?),
        (None, None) => return Err("--multi-request-flow-file or --browser-flow-file is required when using --input-csv".into()),
        _ => None,
    };
    let mut browser = None;
    for identifier in identifiers.iter().filter(|identifier| !identifier.is_empty()) {
        let fetched = match (&requests, &workflow) {
            (Some(requests), _) => multi(requests, identifier)?,
            (None, Some(workflow)) => {
                if browser.is_none() {
                    browser = Some(Browser::start(&options.launch)?);
                }
                let start = flow::origin(workflow, identifier);
                flow::run(browser.as_mut().expect("just started"), workflow, identifier, start.as_deref())?
            }
            (None, None) => unreachable!("checked above"),
        };
        std::fs::write(work.join(format!("{identifier}.{}", if fetched.html { "html" } else { "json" })), fetched.content)?;
    }
    Ok(if requests.is_some() { "multi-request" } else { "browser-flow" })
}

pub fn run(options: &Options) -> Result<Done, Fail> {
    let work = Work::new()?;
    if options.csv.is_some() && options.input.is_some() {
        return Err("Cannot use both input ZIP and --input-csv at the same time".into());
    }
    if options.button.is_some() && !options.browse {
        return Err("--continue-button requires --use-browser to be enabled".into());
    }
    if options.csv.is_some() {
        let mechanism = rows(options, &work.0)?;
        return Ok(Done { mechanism, files: pack(&work.0, options.output)? });
    }
    let input = options.input.ok_or("Either provide an input ZIP or use --input-csv")?;
    unzip(input, &work.0)?;
    let exists = |name: &str| work.0.join(name).is_file();
    let parcel = ["parcel.json", "property_seed.json"].into_iter().find(|name| exists(name));
    let parcel = parcel.ok_or("Neither parcel.json nor property_seed.json found in input zip")?;
    let located = ["address.json", "unnormalized_address.json"].into_iter().filter(|name| exists(name));
    let address = located.clone().find_map(|name| load(&work.0.join(name)).ok());
    if located.count() == 0 {
        return Err("Neither address.json nor unnormalized_address.json found in input zip".into());
    }
    let address = address.unwrap_or(Value::Null);
    let seed = load(&work.0.join(parcel))?;
    let request = &seed["source_http_request"];
    if !request.is_object() {
        return Err(format!("{parcel} missing source_http_request").into());
    }
    let identifier = seed["request_identifier"].as_str().ok_or(format!("{parcel} missing request_identifier"))?;
    let county = |key: &str| address[key] == "Orange";

    if let Some(package) = options.package {
        let mut browser = Browser::start(&options.launch)?;
        let input = json!({
            "request_identifier": identifier,
            "url": self::address(request)?.as_str(),
            "source_http_request": request,
            "parcel": seed,
            "address": address,
        });
        flow::package(&mut browser, package, &work.0, &input)?;
        return Ok(Done { mechanism: "browser-flow-v2", files: pack(&work.0, options.output)? });
    }
    let workflow = match (options.flow, options.template) {
        (Some(file), _) => Some(flow::load(file)?),
        (None, Some((name, parameters))) => Some(flow::template(name, parameters, self::address(request)?.as_str())?),
        (None, None) => None,
    };
    let (mechanism, fetched) = match (options.multi, workflow) {
        (Some(file), _) => ("multi-request", multi(&flow_file(file)?, identifier)?),
        _ if county("county_name") || county("county_jurisdiction") => ("orange", orange(identifier)?),
        (None, Some(workflow)) => {
            let mut browser = Browser::start(&options.launch)?;
            let start = self::address(request)?;
            ("browser-flow", flow::run(&mut browser, &workflow, identifier, Some(start.as_str()))?)
        }
        (None, None) if options.browse && request["method"].as_str().unwrap_or("GET") == "GET" => {
            let mut browser = Browser::start(&options.launch)?;
            let target = self::address(request)?;
            ("browser", flow::visit(&mut browser, target.as_str(), options.proceed, options.button, options.captcha)?)
        }
        (None, None) => ("fetch", plain(request)?),
    };
    std::fs::write(work.0.join(format!("{identifier}.{}", if fetched.html { "html" } else { "json" })), &fetched.content)?;
    // After a browser flow, the seed points at the page it ended on and keeps where it started.
    if let Some(landed) = fetched.landed.as_deref().filter(|_| mechanism == "browser-flow") {
        let request = landing(landed)?;
        for name in SEEDS.into_iter().filter(|name| exists(name)) {
            let mut record = load(&work.0.join(name))?;
            let had = record.get("source_http_request").cloned();
            if let Some(fields) = record.as_object_mut().filter(|_| had.is_some() || name == parcel || name == "property_seed.json" || name == "parcel.json") {
                fields.insert("entry_http_request".to_string(), had.unwrap_or(Value::Null));
                fields.insert("source_http_request".to_string(), request.clone());
            }
            std::fs::write(work.0.join(name), pretty(&record))?;
        }
    }
    Ok(Done { mechanism, files: pack(&work.0, options.output)? })
}
