//! `transform`: turn what `prepare` captured for one parcel into lexicon
//! data-group files, ready for `validate` and `hash`.
//!
//! Three modes, chosen by the options given:
//! - **seed** (`--input-zip` only): a `seed.csv` row becomes the seed records.
//! - **scripts** (`--scripts-zip`): the five county scripts run on QuickJS;
//!   the CLI stamps request metadata on what they wrote, links entities to
//!   the property, and builds the County and Seed data-group roots.
//! - **handler** (`--transform-zip`): a Transform v2 handler package writes
//!   entities and relationships through a small API, and the CLI builds the
//!   data-group root from the relationships it was given.

use crate::canonical::stringify;
use crate::js::{self, Sandbox, Start};
use crate::property::{load, names, unzip, Work};
use crate::schemas::Schemas;
use crate::Fail;
use serde_json::{json, Map, Value};
use std::collections::BTreeMap;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

const MAPPERS: [&str; 4] = ["ownerMapping.js", "structureMapping.js", "layoutMapping.js", "utilityMapping.js"];
const SEEDS: [&str; 4] = ["address.json", "parcel.json", "unnormalized_address.json", "property_seed.json"];

pub struct Options<'a> {
    pub input: &'a Path,
    pub output: &'a Path,
    pub scripts: Option<&'a Path>,
    pub package: Option<&'a Path>,
    pub group: Option<&'a str>,
}

pub struct Done {
    pub mode: &'static str,
    /// The files written under `data/` in the output ZIP.
    pub files: Vec<String>,
}

/// Write a value the way 1.x did: compact, as `JSON.stringify` prints it.
fn save(file: &Path, value: &Value) -> Result<(), Fail> {
    Ok(std::fs::write(file, stringify(value))?)
}

fn link(name: &str) -> Value {
    json!({ "/": format!("./{name}") })
}

/// Pack the files of `data/` as the output ZIP, each under `data/`.
fn pack(data: &Path, output: &Path) -> Result<Vec<String>, Fail> {
    if let Some(parent) = output.parent().filter(|parent| !parent.as_os_str().is_empty()) {
        std::fs::create_dir_all(parent)?;
    }
    let file = std::fs::File::create(output).map_err(|error| format!("cannot write {}: {error}", output.display()))?;
    let mut writer = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    let listed = names(data);
    for name in &listed {
        writer.start_file(format!("data/{name}"), options)?;
        writer.write_all(&std::fs::read(data.join(name))?)?;
    }
    writer.finish()?;
    Ok(listed)
}

/// The Seed data group: its root and the relationship from the address to the
/// parcel, when both are there. Files already present are left as they are.
fn seed(data: &Path, schemas: &mut Schemas) -> Result<(), Fail> {
    if !data.join("address.json").is_file() || !data.join("parcel.json").is_file() {
        eprintln!("warning: address.json or parcel.json is missing, so no Seed data group was written; `hash` needs one");
        return Ok(());
    }
    let cid = schemas.group("Seed")?.ok_or("Schema not found for data group type: Seed")?;
    let root = data.join(format!("{cid}.json"));
    if !root.exists() {
        save(&root, &json!({ "label": "Seed", "relationships": { "address_has_parcel": link("address_has_parcel.json") } }))?;
    }
    let relation = data.join("address_has_parcel.json");
    if !relation.exists() {
        save(&relation, &json!({ "from": link("address.json"), "to": link("parcel.json") }))?;
    }
    Ok(())
}

/// Seed mode: the first row of `seed.csv` as the four seed records.
fn seeded(input: &Path, data: &Path) -> Result<(), Fail> {
    let text = std::fs::read(input.join("seed.csv"))
        .map_err(|_| "seed.csv is required in the input ZIP when no scripts or handler package is given")?;
    let mut reader = csv::Reader::from_reader(text.as_slice());
    let headers = reader.headers()?.clone();
    let row = reader.records().next().ok_or("seed.csv has no data row")??;
    let field =
        |name: &str| headers.iter().position(|header| header == name).and_then(|at| row.get(at)).unwrap_or("").to_string();
    let filled = |name: &str| Some(field(name)).filter(|value| !value.is_empty());
    let county = filled("county").ok_or("County field is required in seed.csv and cannot be empty")?;
    // `{'a':['b']}` is accepted as well as JSON
    let query = match filled("multiValueQueryString") {
        None => json!({}),
        Some(text) => serde_json::from_str(&text)
            .or_else(|_| serde_json::from_str::<Value>(&text.replace("\\'", "\u{0}").replace('\'', "\"").replace('\u{0}', "'")))
            .map_err(|error| format!("multiValueQueryString in seed.csv is not JSON: {error}"))?,
    };
    let mut request = Map::new();
    request.insert("url".to_string(), json!(field("url")));
    request.insert("method".to_string(), json!(field("method")));
    request.insert("multiValueQueryString".to_string(), query);
    if let Some(headers) = filled("headers") {
        request.insert(
            "headers".to_string(),
            serde_json::from_str(&headers).map_err(|error| format!("headers in seed.csv is not JSON: {error}"))?,
        );
    }
    match (filled("json"), filled("body")) {
        (Some(_), Some(_)) => {
            return Err(
                "Both json and body fields are present in seed.csv. Only one of these fields can be processed at a time.".into()
            )
        }
        (Some(text), None) => {
            let parsed: Value = serde_json::from_str(&text).map_err(|error| format!("json in seed.csv is not JSON: {error}"))?;
            let mut headers = request.get("headers").and_then(Value::as_object).cloned().unwrap_or_default();
            headers.insert("content-type".to_string(), json!("application/json"));
            request.insert("headers".to_string(), Value::Object(headers));
            request.insert("json".to_string(), parsed);
        }
        (None, Some(text)) => {
            request.insert("body".to_string(), json!(text));
        }
        (None, None) => {}
    }
    let request = Value::Object(request);
    let identifier = field("source_identifier");
    let street: Vec<String> =
        ["street_pre_directional", "street_number", "street_name", "street_suffix", "street_post_directional", "unit_identifier"]
            .iter()
            .filter_map(|name| filled(name))
            .collect();
    let zip = filled("postal_code").map(|code| match filled("plus_four_postal_code") {
        Some(plus) => format!("{code}-{plus}"),
        None => code,
    });
    let region: Vec<String> = [filled("state_code"), zip].into_iter().flatten().collect();
    let locality: Vec<String> =
        [filled("city_name"), Some(region.join(" ")).filter(|region| !region.is_empty())].into_iter().flatten().collect();
    let composed: Vec<String> = [street.join(" "), locality.join(", ")].into_iter().filter(|part| !part.is_empty()).collect();
    let address = filled("address").unwrap_or_else(|| composed.join(", "));
    let place = match (filled("longitude"), filled("latitude")) {
        (Some(longitude), Some(latitude)) => longitude.trim().parse::<f64>().ok().zip(latitude.trim().parse::<f64>().ok()),
        _ => None,
    };
    let coordinate = |at: usize| place.map_or(Value::Null, |place| json!([place.0, place.1][at]));
    save(
        &data.join("address.json"),
        &json!({
            "source_http_request": request, "request_identifier": identifier, "county_name": county,
            "unnormalized_address": address, "longitude": coordinate(0), "latitude": coordinate(1),
        }),
    )?;
    save(
        &data.join("parcel.json"),
        &json!({ "source_http_request": request, "request_identifier": identifier, "parcel_identifier": field("parcel_id") }),
    )?;
    let mut unnormalized = json!({ "source_http_request": request, "request_identifier": identifier, "full_address": address, "county_jurisdiction": county });
    if place.is_some() {
        unnormalized["longitude"] = coordinate(0);
        unnormalized["latitude"] = coordinate(1);
    }
    save(&data.join("unnormalized_address.json"), &unnormalized)?;
    save(
        &data.join("property_seed.json"),
        &json!({ "source_http_request": request, "request_identifier": identifier, "parcel_id": field("parcel_id") }),
    )?;
    Ok(())
}

/// The first file of that name anywhere under a directory.
fn find(dir: &Path, name: &str) -> Option<PathBuf> {
    let mut entries: Vec<PathBuf> = std::fs::read_dir(dir).ok()?.flatten().map(|entry| entry.path()).collect();
    entries.sort();
    for entry in &entries {
        if entry.is_file() && entry.file_name().is_some_and(|found| found == name) {
            return Some(entry.clone());
        }
    }
    entries.iter().filter(|entry| entry.is_dir()).find_map(|entry| find(entry, name))
}

/// The last lines of what a script printed.
fn tail(text: &str) -> String {
    let lines: Vec<&str> = text.trim_end().lines().collect();
    lines[lines.len().saturating_sub(60)..].join("\n")
}

/// Run county scripts by name, one after the other, in the work directory.
fn scripts(work: &Path, wanted: &[&str], network: bool) -> Result<(), Fail> {
    let found: Vec<(&str, PathBuf)> = wanted
        .iter()
        .map(|name| {
            find(&work.join("scripts"), name).map(|file| (*name, file)).ok_or(format!("Required script not found: {name}"))
        })
        .collect::<Result<_, _>>()?;
    for (name, file) in found {
        let began = Instant::now();
        let sandbox = Sandbox { root: work.to_path_buf(), cwd: work.to_path_buf(), timeout: Duration::from_secs(120), network };
        let Err(failed) = js::run(Start::Script(&file), &sandbox, None) else {
            continue;
        };
        let captured = match (failed.stderr.trim().is_empty(), failed.stdout.trim().is_empty()) {
            (false, _) => format!("\n--- stderr (tail) ---\n{}", tail(&failed.stderr)),
            (true, false) => format!("\n--- stdout (tail) ---\n{}", tail(&failed.stdout)),
            (true, true) => "\n(no output captured)".to_string(),
        };
        let stopped = if failed.timed_out { " timedOut=true" } else { "" };
        return Err(format!(
            "Script failed (script={name} code={}{stopped} durationMs={}).{captured}",
            failed.code,
            began.elapsed().as_millis()
        )
        .into());
    }
    Ok(())
}

/// The County root: each relationship file filed under the key its name
/// stands for. The rules, their order and the key order are those of 1.x.
fn county(files: &[String]) -> Value {
    const SINGLE: [&str; 6] = [
        "property_has_address",
        "property_has_lot",
        "property_has_flood_storm_information",
        "address_has_geometry",
        "property_has_structure",
        "property_has_utility",
    ];
    const ORDER: [&str; 24] = [
        "person_has_mailing_address",
        "company_has_mailing_address",
        "property_has_address",
        "property_has_lot",
        "property_has_tax",
        "property_has_sales_history",
        "property_has_layout",
        "property_has_flood_storm_information",
        "parcel_has_geometry",
        "address_has_geometry",
        "layout_has_geometry",
        "property_has_file",
        "property_has_structure",
        "property_has_utility",
        "property_has_property_improvement",
        "sales_history_has_person",
        "sales_history_has_company",
        "deed_has_file",
        "sales_history_has_deed",
        "layout_has_layout",
        "layout_has_utility",
        "layout_has_structure",
        "tax_has_tax_jurisdiction",
        "tax_jurisdiction_has_tax_exemption",
    ];
    let mut filed: BTreeMap<&str, Vec<Value>> = BTreeMap::new();
    for file in files {
        let name = file.to_lowercase();
        let has = |part: &str| name.contains(part);
        let key = match () {
            _ if has("property_address") => "property_has_address",
            _ if has("property_lot") => "property_has_lot",
            _ if has("exemption") => "tax_jurisdiction_has_tax_exemption",
            _ if has("tax") && has("jurisdiction") => "tax_has_tax_jurisdiction",
            _ if has("property_tax") => "property_has_tax",
            _ if has("property_sales") => "property_has_sales_history",
            _ if has("property_layout") => "property_has_layout",
            _ if has("property_flood_storm_information") => "property_has_flood_storm_information",
            _ if has("property_has_utility") || has("property_utility") => "property_has_utility",
            _ if has("property_has_structure") || has("property_structure") => "property_has_structure",
            _ if has("parcel_geometry") || (has("parcel") && has("geometry") && !has("property")) => "parcel_has_geometry",
            _ if has("address_geometry") || (has("address") && has("geometry")) => "address_has_geometry",
            _ if has("layout_geometry") || (has("layout") && has("geometry") && !has("property")) => "layout_has_geometry",
            _ if has("property_file") => "property_has_file",
            _ if has("property_improvement") => "property_has_property_improvement",
            _ if has("relationship_sales") && has("person") => "sales_history_has_person",
            _ if has("relationship_sales") && has("company") => "sales_history_has_company",
            _ if has("relationship_deed") && has("file") => "deed_has_file",
            _ if has("relationship_sales") && has("deed") => "sales_history_has_deed",
            _ if has("person") && has("mailing_address") && has("relationship") => "person_has_mailing_address",
            _ if has("company") && has("mailing_address") && has("relationship") => "company_has_mailing_address",
            _ if has("relationship") && name.matches("layout").count() >= 2 => "layout_has_layout",
            _ if has("relationship") && has("layout") && has("utility") => "layout_has_utility",
            _ if has("relationship") && has("layout") && has("structure") => "layout_has_structure",
            _ => continue,
        };
        filed.entry(key).or_default().push(link(file));
    }
    let mut relationships = Map::new();
    for key in ORDER {
        let Some(mut links) = filed.remove(key) else {
            continue;
        };
        // a key that holds one relationship keeps the last file that claimed it
        let value = if SINGLE.contains(&key) { links.pop().unwrap_or(Value::Null) } else { Value::Array(links) };
        relationships.insert(key.to_string(), value);
    }
    json!({ "label": "County", "relationships": relationships })
}

/// Scripts mode, after the scripts ran: stamp, link, and build the County root.
fn finish(work: &Path, schemas: &mut Schemas) -> Result<(), Fail> {
    let data = work.join("data");
    if !data.is_dir() {
        return Err("The scripts wrote no data/ directory".into());
    }
    let written = names(&data);
    let seed = [work.join("address.json"), work.join("unnormalized_address.json")].into_iter().find(|file| file.is_file());
    let seed = seed.map(|file| load(&file)).transpose()?.unwrap_or(Value::Null);
    // Seed records travel with the output; only a script's own address.json is kept.
    for name in SEEDS {
        let kept = name == "address.json" && data.join(name).exists();
        if work.join(name).is_file() && !kept {
            std::fs::copy(work.join(name), data.join(name))?;
        }
    }
    let mut relations = Vec::new();
    for name in &written {
        if !name.ends_with(".json") || name.starts_with("relationship") || name.ends_with("data.json") {
            continue;
        }
        let file = data.join(name);
        let mut entity = load(&file)?;
        let Some(fields) = entity.as_object_mut() else {
            continue;
        };
        let given = fields.get("source_http_request");
        let empty = given.is_none_or(|given| match given {
            Value::Null | Value::Bool(false) => true,
            Value::Object(inner) => inner.is_empty(),
            Value::String(text) => text.is_empty(),
            Value::Number(number) => number.as_f64() == Some(0.0),
            _ => false,
        });
        if empty {
            fields.insert("source_http_request".to_string(), seed["source_http_request"].clone());
        }
        fields.insert("request_identifier".to_string(), seed["request_identifier"].clone());
        save(&file, &entity)?;
        // These are linked by relationships the scripts write themselves.
        let own = name.ends_with("property.json")
            || ["person", "company", "structure", "utility", "mailing_address"].iter().any(|prefix| name.starts_with(prefix))
            || name.contains("exemption")
            || name.contains("jurisdiction");
        if !own {
            let relation = format!("relationship_property_{name}");
            save(&data.join(&relation), &json!({ "from": link("property.json"), "to": link(name) }))?;
            relations.push(relation);
        }
    }
    for name in names(&data) {
        if name.starts_with("relationship_") && name.ends_with(".json") && !relations.contains(&name) {
            relations.push(name);
        }
    }
    let cid = schemas.group("County")?.ok_or("Schema not found for data group type: County")?;
    save(&data.join(format!("{cid}.json")), &county(&relations))?;
    self::seed(&data, schemas)
}

/// What a Transform v2 handler is given, built around `call` into the CLI.
const HANDLER: &str = r#"(async (module, call) => {
  const exported = module.handler ? module : module.default || {};
  if (typeof exported.handler !== 'function') throw new Error('Transform v2 package must export a handler function');
  const limit = (exported.config || module.config || {}).timeoutMs;
  globalThis.__host.limit(call('limit', limit === undefined ? null : limit));
  const input = call('input');
  const readCapture = async (name) => call('readCapture', name);
  const writeJson = async (name, value) => {
    const record = { ...value, source_http_request: value.source_http_request ?? input.source_http_request, request_identifier: input.request_identifier };
    call('writeJson', name, JSON.stringify(record, null, 2));
  };
  const writeRelationship = async (relationship) => void call('writeRelationship', relationship);
  const logger = Object.fromEntries(['info', 'success', 'error', 'warn', 'log', 'debug', 'technical', 'progress'].map((level) => [level, (...args) => console.log(...args)]));
  await exported.handler({ input: { ...input, readCapture }, readCapture, writeJson, writeRelationship, logger });
})"#;

/// A snake_case stem: `property`, `tax_2024`.
fn stem(name: &str) -> bool {
    let part = |part: &str| !part.is_empty() && part.bytes().all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit());
    name.starts_with(|first: char| first.is_ascii_lowercase()) && name.split('_').all(part)
}

/// Handler mode: run the package's handler and build the data-group root from the relationships it wrote.
fn handled(work: &Path, label: &str, schemas: &mut Schemas) -> Result<(), Fail> {
    let (input, data) = (work.join("input"), work.join("data"));
    let entry = work.join("handler").join("handler.js");
    if !entry.is_file() {
        return Err("The transform package has no handler.js at its root".into());
    }
    let captures = std::fs::read(input.join("captures.json")).map_err(|_| "captures.json is required for transform v2")?;
    let captures: Value = serde_json::from_slice(&captures).map_err(|_| "captures.json is invalid JSON")?;
    let address = load(&input.join("address.json"))?;
    let parcel = load(&input.join("parcel.json"))?;
    for key in ["source_http_request", "request_identifier"] {
        if parcel.get(key).is_none_or(Value::is_null) {
            return Err(format!("parcel.json missing {key}").into());
        }
    }
    std::fs::create_dir_all(&data)?;
    let mut written: Vec<String> = Vec::new();
    let mut entities: Vec<String> = Vec::new();
    let mut relations: Vec<(String, Vec<String>)> = Vec::new();
    let mut timeout = 120_000u64;
    let mut bridge = |name: &str, arguments: Value| -> Result<Value, String> {
        let text = |at: usize| arguments[at].as_str().unwrap_or_default().to_string();
        let mut claim = |name: String| -> Result<String, String> {
            if !stem(&name) {
                return Err(format!("Invalid output name \"{name}\". Output names must be snake_case stems."));
            }
            if written.contains(&name) {
                return Err(format!("Duplicate output name: {name}"));
            }
            written.push(name.clone());
            Ok(name)
        };
        match name {
            "limit" => {
                let asked = arguments[0].as_f64();
                if asked.is_some_and(|asked| asked.fract() != 0.0 || !(1000.0..=600_000.0).contains(&asked))
                    || !(arguments[0].is_null() || asked.is_some())
                {
                    return Err("Transform v2 timeoutMs must be between 1000ms and 600000ms".to_string());
                }
                timeout = asked.map_or(timeout, |asked| asked as u64);
                Ok(json!(timeout))
            }
            "input" => Ok(json!({
                "request_identifier": parcel["request_identifier"],
                "source_http_request": parcel["source_http_request"],
                "address": address,
                "parcel": parcel,
                "captures": captures,
            })),
            "readCapture" => {
                let wanted = text(0);
                let listed = captures["captures"].as_array().into_iter().flatten();
                let found = listed.clone().find(|capture| capture["name"] == wanted.as_str());
                let path = found.and_then(|capture| capture["path"].as_str()).ok_or(format!("Unknown capture: {wanted}"))?;
                let inside = !path.starts_with('/') && !path.split(['/', '\\']).any(|part| part == "..");
                let bytes = inside.then_some(path).and_then(|path| std::fs::read(input.join(path)).ok());
                let bytes = bytes.ok_or(format!("Invalid capture path: {path}"))?;
                Ok(json!(String::from_utf8_lossy(&bytes)))
            }
            "writeJson" => {
                let name = claim(text(0))?;
                std::fs::write(data.join(format!("{name}.json")), text(1)).map_err(|error| error.to_string())?;
                entities.push(name);
                Ok(Value::Null)
            }
            "writeRelationship" => {
                let field = |key: &str| arguments[0][key].as_str().unwrap_or_default().to_string();
                let name = claim(field("name"))?;
                let (from, to, kind) = (field("from"), field("to"), field("type"));
                if !entities.contains(&from) {
                    return Err(format!("Unknown relationship source: {from}"));
                }
                if !entities.contains(&to) {
                    return Err(format!("Unknown relationship target: {to}"));
                }
                let body = json!({ "from": link(&format!("{from}.json")), "to": link(&format!("{to}.json")) });
                let pretty = serde_json::to_string_pretty(&body).map_err(|error| error.to_string())?;
                std::fs::write(data.join(format!("{name}.json")), pretty).map_err(|error| error.to_string())?;
                match relations.iter_mut().find(|(known, _)| *known == kind) {
                    Some((_, files)) => files.push(format!("{name}.json")),
                    None => relations.push((kind, vec![format!("{name}.json")])),
                }
                Ok(Value::Null)
            }
            other => Err(format!("{other} is not part of the transform v2 API")),
        }
    };
    let sandbox = Sandbox {
        root: work.to_path_buf(),
        cwd: work.join("handler"),
        timeout: Duration::from_secs(600),
        network: !schemas.offline(),
    };
    let ran = js::run(Start::Call { file: &entry, entry: HANDLER }, &sandbox, Some(&mut bridge));
    if let Err(failed) = ran {
        if failed.timed_out {
            return Err(format!("Transform v2 timed out after {timeout}ms").into());
        }
        // the error's own line first, then whatever the handler printed
        let reason =
            failed.stderr.trim_end().rsplit("\n\n").next().unwrap_or_default().lines().next().unwrap_or("the handler failed");
        return Err(format!("{}\n--- stderr (tail) ---\n{}", reason.trim_start_matches("Error: "), tail(&failed.stderr)).into());
    }
    if relations.is_empty() {
        return Ok(());
    }
    let cid = schemas.group(label)?.ok_or(format!("Schema not found for data group type: {label}"))?;
    let schema = schemas.get(&cid)?;
    let mut relationships = Map::new();
    for (kind, files) in relations {
        let declared = &schema["properties"]["relationships"]["properties"][&kind];
        if !declared.is_object() {
            return Err(format!("Relationship type \"{kind}\" is not valid for {label}").into());
        }
        let many = declared["type"] == "array"
            || declared["type"].as_array().is_some_and(|kinds| kinds.iter().any(|kind| kind == "array"));
        if !many && files.len() > 1 {
            return Err(format!("Relationship type \"{kind}\" only allows one relationship").into());
        }
        let links: Vec<Value> = files.iter().map(|file| link(file)).collect();
        relationships.insert(kind, if many { Value::Array(links) } else { links[0].clone() });
    }
    let root = json!({ "label": label, "relationships": relationships });
    Ok(std::fs::write(data.join(format!("{cid}.json")), serde_json::to_string_pretty(&root)?)?)
}

pub fn run(options: &Options, schemas: &mut Schemas) -> Result<Done, Fail> {
    if !options.input.is_file() {
        return Err(format!("input-zip not found: {}", options.input.display()).into());
    }
    if options.scripts.is_some() && options.package.is_some() {
        return Err("--scripts-zip cannot be used with --transform-zip".into());
    }
    let work = Work::new("transform")?;
    let (input, data) = (work.0.join("input"), work.0.join("data"));
    unzip(options.input, &input)?;
    let mode = match (options.scripts, options.package) {
        (_, Some(package)) => {
            unzip(package, &work.0.join("handler"))?;
            handled(&work.0, options.group.unwrap_or("County"), schemas)?;
            "handler"
        }
        (Some(bundle), None) => {
            unzip(bundle, &work.0.join("scripts"))?;
            // What the scripts expect in their working directory: the seed
            // records, one source document, and any CSV.
            let listed = names(&input);
            for name in listed.iter().filter(|name| SEEDS.contains(&name.as_str()) || name.ends_with(".csv")) {
                std::fs::copy(input.join(name), work.0.join(name))?;
            }
            let page = listed.iter().find(|name| name.to_lowercase().ends_with(".html") || name.to_lowercase().ends_with(".htm"));
            let record = listed.iter().find(|name| name.ends_with(".json") && !SEEDS.contains(&name.as_str()));
            match (page, record) {
                (Some(page), _) => std::fs::copy(input.join(page), work.0.join("input.html")).map(|_| ())?,
                (None, Some(record)) => std::fs::copy(input.join(record), work.0.join("input.json")).map(|_| ())?,
                (None, None) => {}
            }
            scripts(&work.0, &MAPPERS, !schemas.offline())?;
            scripts(&work.0, &["data_extractor.js"], !schemas.offline())?;
            finish(&work.0, schemas)?;
            "scripts"
        }
        (None, None) => {
            std::fs::create_dir_all(&data)?;
            seeded(&input, &data)?;
            seed(&data, schemas)?;
            "seed"
        }
    };
    Ok(Done { mode, files: pack(&data, options.output)? })
}
