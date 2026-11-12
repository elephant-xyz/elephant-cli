//! `validate <property>`: check one property's data groups against the
//! lexicon, or every property of a batch directory.
//!
//! A data-group root is a JSON file holding exactly `label` and
//! `relationships`; the manifest maps its label to a schema CID. Everything a
//! root links to (`{"/": "./file.json"}`) is validated through it. A JSON
//! file no root reaches is reported as unused.

use crate::lexicon::{self, Group, Lexicon};
use crate::property::Property;
use crate::report::Row;
use crate::schemas::Schemas;
use cid::Cid;
use serde_json::Value;
use std::borrow::Cow;
use std::collections::{BTreeMap, HashSet};
use std::path::PathBuf;
use std::sync::Mutex;

/// What every property of a run shares: compiled schemas and where they come from.
pub struct Shared {
    pub lexicon: Lexicon,
    pub schemas: Schemas,
}

pub struct Checked {
    /// Data groups found in the property.
    pub groups: usize,
    /// Findings, after the same filter every `validate` path applies.
    pub rows: Vec<Row>,
}

/// The files of a property a data group may link to that are exempt from the unused check.
const SEEDS: [&str; 3] = ["parcel.json", "property_seed.json", "unnormalized_address.json"];

/// The file a pointer `{"/": "./name"}` names.
fn target(value: &Value) -> Option<&str> {
    value.get("/")?.as_str()?.strip_prefix("./")
}

/// A data-group root: an object holding exactly a string `label` and `relationships`.
fn root(value: &Value) -> Option<&str> {
    let fields = value.as_object().filter(|fields| fields.len() == 2)?;
    fields.get("relationships").filter(|links| links.is_object() || links.is_array())?;
    fields.get("label")?.as_str()
}

/// The JSON files of a property and which of them are data-group roots.
pub struct Scan {
    /// Every `.json` file directly in the property, in byte order.
    pub names: Vec<String>,
    /// Those that parse.
    pub parsed: BTreeMap<String, Value>,
    /// Data-group roots the manifest knows: file name and schema CID.
    pub roots: Vec<(String, String)>,
}

/// Find a property's data-group roots. `Err` means it has none to work on.
pub fn scan(property: &Property, shared: &Mutex<Shared>) -> Result<Scan, String> {
    let names: Vec<String> = property.names().into_iter().filter(|name| name.ends_with(".json")).collect();
    if names.is_empty() {
        return Err("No data group JSON files found in the property directory".to_string());
    }
    let parsed: BTreeMap<String, Value> = names
        .iter()
        .filter_map(|name| Some((name.clone(), serde_json::from_slice(&property.read(name)?).ok()?)))
        .collect();
    let mut roots = Vec::new();
    for (name, value) in &parsed {
        let Some(label) = root(value) else {
            continue;
        };
        if let Some(cid) = shared.lock().expect("shared state").schemas.group(label)? {
            roots.push((name.clone(), cid));
        }
    }
    if roots.is_empty() {
        return Err("No files found to validate".to_string());
    }
    Ok(Scan { names, parsed, roots })
}

/// Validate one property. `Err` means it could not be checked at all.
pub fn property(property: &Property, shared: &Mutex<Shared>) -> Result<Checked, String> {
    let Scan { names, parsed, roots } = scan(property, shared)?;
    let roots: Vec<(&str, &Value, &String)> =
        roots.iter().map(|(name, cid)| (name.as_str(), &parsed[name], cid)).collect();

    // Files reached from a root: its relationship files and the two entities each one links.
    let mut used: HashSet<&str> = roots.iter().map(|root| root.0).collect();
    for (_, value, _) in &roots {
        let links = value["relationships"].as_object().into_iter().flat_map(|links| links.values());
        let listed = links.flat_map(|link| link.as_array().map_or(std::slice::from_ref(link), Vec::as_slice));
        for name in listed.filter_map(target) {
            let Some((name, relation)) = parsed.get_key_value(name) else {
                continue;
            };
            used.insert(name.as_str());
            used.extend([&relation["from"], &relation["to"]].into_iter().filter_map(target));
        }
    }
    let mut rows = Vec::new();
    for name in &names {
        let relation = parsed
            .get(name.as_str())
            .is_some_and(|value| target(&value["from"]).is_some() && target(&value["to"]).is_some());
        if used.contains(name.as_str()) || SEEDS.contains(&name.as_str()) || relation {
            continue;
        }
        rows.push(Row {
            file: property.path(name),
            path: "root".to_string(),
            message: format!(
                "Unused data JSON file detected: {name} is not referenced by any relationship included in the datagroup."
            ),
            ..Row::default()
        });
    }

    let source = |pointer: &str| -> Result<Cow<'_, Value>, String> {
        let bytes = match Cid::try_from(pointer) {
            Ok(_) => shared.lock().expect("shared state").schemas.fetch(pointer)?,
            Err(_) => property
                .read(pointer)
                .ok_or_else(|| {
                    format!("Failed to resolve pointer - not a valid CID or accessible file path: {pointer}")
                })?
                .into_owned(),
        };
        Ok(Cow::Owned(
            serde_json::from_slice(&bytes)
                .unwrap_or_else(|_| Value::String(String::from_utf8_lossy(&bytes).into_owned())),
        ))
    };
    for (name, value, cid) in &roots {
        let group = {
            let mut guard = shared.lock().expect("shared state");
            let Shared { lexicon, schemas } = &mut *guard;
            lexicon.group(cid, schemas)
        };
        let row = |path: &str, message: String| Row {
            property: property.name.clone(),
            group: (*cid).clone(),
            file: property.path(name),
            path: path.to_string(),
            message,
            ..Row::default()
        };
        match (&*group, group.validate(value, &source)) {
            (_, Some(errors)) => {
                rows.extend(errors.into_iter().map(|error| Row { value: error.value, ..row(&error.path, error.message) }));
            }
            (Group::Missing(reason), _) => rows.push(row("root", format!("Processing error: {reason}"))),
            _ => rows.push(row(
                "root",
                format!("Schema CID {cid} is not a valid data group schema. Data group schemas must describe an object with exactly two properties: \"label\" and \"relationships\". For valid data group schemas, please visit https://lexicon.elephant.xyz"),
            )),
        }
    }
    Ok(Checked { groups: roots.len(), rows: lexicon::filter(rows) })
}

/// Validate every property of a batch on `threads` cores, in the order given.
pub fn batch(children: &[PathBuf], shared: &Mutex<Shared>, threads: usize) -> Vec<Result<Checked, String>> {
    std::thread::scope(|scope| {
        let workers: Vec<_> = children
            .chunks(children.len().div_ceil(threads).max(1))
            .map(|chunk| {
                scope.spawn(move || {
                    let check = |child: &PathBuf| Property::open(child).and_then(|opened| property(&opened, shared));
                    chunk.iter().map(check).collect::<Vec<_>>()
                })
            })
            .collect();
        workers.into_iter().flat_map(|worker| worker.join().expect("worker thread")).collect()
    })
}

impl Shared {
    pub fn new(schemas: Schemas) -> Mutex<Shared> {
        Mutex::new(Shared { lexicon: Lexicon::new(), schemas })
    }
}
